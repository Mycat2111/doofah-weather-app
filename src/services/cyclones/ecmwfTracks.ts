/**
 * ECMWF's tropical cyclone tracks (BUFR, from its open data) as the storms
 * /api/cyclones sends.
 *
 * ECMWF writes one message per storm and one subset per ensemble member
 * (the high-resolution forecast and the control are members too, told apart
 * by their forecast type). Each subset has the warning centre's observed
 * position, the member's analysis (time 0), then every 6 hours the storm's
 * centre, its central pressure and the strongest 10 m wind near it.
 *
 * Only storms a warning centre has observed are kept: ECMWF's file also
 * follows storms the model expects to form (numbered 70 and up, with no
 * observed position), which are not active cyclones yet.
 */

import {
  basinOf,
  buildCone,
  unwrap,
  type Cyclone,
  type MemberPath,
  type TimedPoint,
  type TrackPoint,
} from "@/lib/cyclones";
import { decodeBufr, type BufrMessage, type BufrValue } from "./bufr";

const HOUR_MS = 3_600_000;
/** Hours after the run kept: the map and the alert look 5 days ahead of a run that may be half a day old. */
export const MAX_HOURS = 144;

/** Code table 008005. */
const STORM_CENTRE = 1;
const ANALYSIS_CENTRE = 4;
/** Code table 001092. */
const HIGH_RESOLUTION = 0;
const CONTROL = 1;

interface Point {
  h: number;
  lat: number | null;
  lon: number | null;
  pressure: number | null;
  wind: number | null;
}

interface Member {
  number: number | null;
  type: number | null;
  observed: { lat: number; lon: number } | null;
  points: Point[];
}

interface Storm {
  id: string;
  name: string;
  run: number | null;
  members: Member[];
}

const num = (v: BufrValue["value"]) => (typeof v === "number" ? v : null);

/** One member's track from its subset, read by what each value means rather than where it sits. */
function readMember(values: BufrValue[]): { member: Member; id: string; name: string; time: number[] } {
  const member: Member = { number: null, type: null, observed: null, points: [] };
  const time: number[] = [];
  let id = "";
  let name = "";
  let significance: number | null = null;
  // Undefined at the analysis, before any period; null for a period the member doesn't reach.
  let period: number | null | undefined = undefined;
  let lat: number | null = null;
  const point = (h: number) => {
    let p = member.points.find((x) => x.h === h);
    if (!p) {
      p = { h, lat: null, lon: null, pressure: null, wind: null };
      member.points.push(p);
    }
    return p;
  };

  for (const { code, value } of values) {
    switch (code) {
      case 1025:
        id = typeof value === "string" ? value : id;
        break;
      case 1027:
        name = typeof value === "string" ? value : name;
        break;
      case 1091:
        member.number = num(value);
        break;
      case 1092:
        member.type = num(value);
        break;
      case 4001:
      case 4002:
      case 4003:
      case 4004:
      case 4005:
        // The run's date and time, the first time they appear.
        if (time.length < 5) time.push(num(value) ?? 0);
        break;
      case 8005:
        significance = num(value);
        break;
      case 4024:
        period = num(value);
        break;
      case 5001:
      case 5002:
        lat = num(value);
        break;
      case 6001:
      case 6002: {
        const lon = num(value);
        if (lat !== null && lon !== null) {
          if (significance === STORM_CENTRE && period === undefined) member.observed = { lat, lon };
          else if (significance === ANALYSIS_CENTRE) Object.assign(point(0), { lat, lon });
          else if (significance === STORM_CENTRE && typeof period === "number")
            Object.assign(point(period), { lat, lon });
        }
        lat = null;
        break;
      }
      case 10051: {
        // Pascals; the centre's pressure at the analysis or the period being read.
        const pa = num(value);
        if (period !== null) point(period ?? 0).pressure = pa === null ? null : pa / 100;
        break;
      }
      case 11012:
        if (period !== null) point(period ?? 0).wind = num(value);
        break;
    }
  }
  return { member, id: id.trim(), name: name.trim(), time };
}

function readStorm(message: BufrMessage): Storm | null {
  let id = "";
  let name = "";
  let run: number | null = null;
  const members: Member[] = [];
  for (const subset of message.subsets) {
    const read = readMember(subset);
    id ||= read.id;
    name ||= read.name;
    if (run === null && read.time.length === 5) {
      const [y, mo, d, h, mi] = read.time;
      run = Date.UTC(y, mo - 1, d, h, mi);
    }
    members.push(read.member);
  }
  if (!id) return null;
  return { id, name, run: run ?? Date.parse(message.typicalTime), members };
}

/** A member's points with a position, in time order, with continuous longitudes. */
function cleanPoints(points: Point[], near: number | null): (Point & { lat: number; lon: number })[] {
  const out: (Point & { lat: number; lon: number })[] = [];
  for (const p of [...points].sort((a, b) => a.h - b.h)) {
    if (p.lat === null || p.lon === null || p.h < 0 || p.h > MAX_HOURS) continue;
    const ref = out.length ? out[out.length - 1].lon : near;
    out.push({ ...p, lat: p.lat, lon: ref === null ? p.lon : unwrap(p.lon, ref) });
  }
  return out;
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const median = (values: number[]) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** A storm name worth showing: not blank, and not just the storm's number again. */
function stormName(name: string, id: string): string | null {
  const n = name.trim();
  if (!n || n === id || /^\d+[A-Z]?$/.test(n)) return null;
  return n;
}

function toCyclone(storm: Storm): Cyclone | null {
  const observed = storm.members.find((m) => m.observed)?.observed ?? null;
  if (!observed) return null;
  const run = storm.run!;
  const tracks = storm.members.map((m) => ({ member: m, points: cleanPoints(m.points, observed.lon) }));
  const usable = tracks.filter((t) => t.points.length > 0);
  if (!usable.length) return null;

  const timed = usable.map((t) =>
    t.points.map((p): TimedPoint => ({ t: run + p.h * HOUR_MS, lat: p.lat, lon: p.lon })),
  );
  const cone = buildCone(timed);

  const hres = usable.find((t) => t.member.type === HIGH_RESOLUTION && t.points.length > 1);
  const control = usable.find((t) => t.member.type === CONTROL && t.points.length > 1);
  const main = hres ?? control;
  let track: TrackPoint[];
  if (main) {
    track = main.points.map((p) => ({
      time: new Date(run + p.h * HOUR_MS).toISOString(),
      lat: round(p.lat, 2),
      lon: round(p.lon, 2),
      pressure_hpa: p.pressure === null ? null : Math.round(p.pressure),
      wind_kmh: p.wind === null ? null : Math.round(p.wind * 3.6),
    }));
  } else {
    // No single forecast to follow: the middle of the ensemble, with its typical pressure and wind.
    track = cone.map((c) => {
      const h = (Date.parse(c.time) - run) / HOUR_MS;
      const at = usable.map((t) => t.points.find((p) => p.h === h)).filter((p) => !!p);
      const pressure = median(at.map((p) => p!.pressure).filter((v): v is number => v !== null));
      const wind = median(at.map((p) => p!.wind).filter((v): v is number => v !== null));
      return {
        time: c.time,
        lat: c.lat,
        lon: c.lon,
        pressure_hpa: pressure === null ? null : Math.round(pressure),
        wind_kmh: wind === null ? null : Math.round(wind * 3.6),
      };
    });
  }
  if (!track.length) return null;

  const members: MemberPath[] = usable.map((t) => t.points.flatMap((p) => [p.h, round(p.lat, 2), round(p.lon, 2)]));
  return {
    id: storm.id,
    name: stormName(storm.name, storm.id),
    basin: basinOf(storm.id, observed),
    track,
    track_from: hres ? "hres" : control ? "control" : "mean",
    cone,
    members,
  };
}

/** The active storms in an ECMWF track file, and the run they are from (ISO; null when the file has none). */
export function cyclonesFromBufr(bytes: Uint8Array): { run: string | null; storms: Cyclone[] } {
  const storms = decodeBufr(bytes)
    .map(readStorm)
    .filter((s): s is Storm => s !== null);
  const runs = storms.map((s) => s.run).filter((r): r is number => r !== null);
  return {
    run: runs.length ? new Date(Math.max(...runs)).toISOString() : null,
    storms: storms
      .map(toCyclone)
      .filter((c): c is Cyclone => c !== null)
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
