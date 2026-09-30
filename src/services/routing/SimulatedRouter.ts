import { distanceKm } from "../weathernext3/places";
import type { GeoPoint } from "../weathernext3/types";
import { ROADS, TOWNS, type RoadKind } from "./roadNetwork";
import { RouteError, type Route, type RoutePoint, type RouteRequest } from "./types";

/**
 * Router over the hand-made highway map in roadNetwork.ts. It runs on the
 * device, so it also works offline. Driving times use typical speeds for
 * each kind of road, plus stops at borders and the wait for a ferry.
 */

type Kind = RoadKind | "local";

/** Typical average speeds, km/h. */
export const SPEED_KMH: Record<Kind, number> = {
  motorway: 90,
  highway: 76,
  road: 62,
  mountain: 52,
  ferry: 22,
  /** Town streets and country lanes between you and the highway. */
  local: 40,
};
/** Real roads bend more than the line drawn between towns. */
const ROAD_FACTOR: Record<Kind, number> = {
  motorway: 1.08,
  highway: 1.14,
  road: 1.15,
  mountain: 1.22,
  ferry: 1,
  local: 1.3,
};
/** Passport checks at a border, minutes. */
export const BORDER_MIN = 40;
/** Boarding and waiting for a car ferry, minutes. */
export const FERRY_WAIT_MIN = 45;
/** Farther than this from every town on the map, there is no road the router knows, km. */
export const MAX_ACCESS_KM = 120;
/** Closer than this, drive straight there on local roads, km. */
const DIRECT_KM = 60;
/** One point on the drawn line every this many km. */
const STEP_KM = 4;

interface Edge {
  to: number;
  kind: Kind;
  border: boolean;
  minutes: number;
}

const townIndex = new Map(TOWNS.map((t, i) => [t.id, i]));

function travelMinutes(a: GeoPoint, b: GeoPoint, kind: Kind, border: boolean) {
  const km = distanceKm(a, b) * ROAD_FACTOR[kind];
  return (km / SPEED_KMH[kind]) * 60 + (border ? BORDER_MIN : 0) + (kind === "ferry" ? FERRY_WAIT_MIN : 0);
}

const network: Edge[][] = TOWNS.map(() => []);
for (const r of ROADS) {
  const a = townIndex.get(r.from);
  const b = townIndex.get(r.to);
  if (a === undefined || b === undefined) throw new Error(`Road ${r.from}–${r.to} names an unknown town`);
  const minutes = travelMinutes(TOWNS[a].point, TOWNS[b].point, r.kind, !!r.border);
  network[a].push({ to: b, kind: r.kind, border: !!r.border, minutes });
  network[b].push({ to: a, kind: r.kind, border: !!r.border, minutes });
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/**
 * The drawn line of one road: gentle bends that start and end on the towns,
 * the same shape whichever way it is driven.
 */
function roadLine(a: GeoPoint, b: GeoPoint, kind: Kind, key: string): GeoPoint[] {
  const flip = key.split("|")[0] > key.split("|")[1];
  const [p, q] = flip ? [b, a] : [a, b];
  const km = distanceKm(p, q);
  const n = Math.max(1, Math.ceil(km / STEP_KM));
  const kmPerLat = 111.32;
  const kmPerLon = 111.32 * Math.cos((((p.lat + q.lat) / 2) * Math.PI) / 180);
  // Unit vector across the road, in km.
  const dx = (q.lon - p.lon) * kmPerLon;
  const dy = (q.lat - p.lat) * kmPerLat;
  const len = Math.hypot(dx, dy) || 1;
  const [nx, ny] = [-dy / len, dx / len];
  const amplitude = kind === "ferry" ? 0 : Math.min(kind === "mountain" ? 6 : 3.5, 0.035 * km);
  const phase1 = hash(`${key}a`) * 2 * Math.PI;
  const phase2 = hash(`${key}b`) * 2 * Math.PI;
  const f1 = Math.max(1, km / 70);
  const f2 = Math.max(2, km / 25);
  const line: GeoPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bend =
      amplitude *
      Math.sin(Math.PI * t) *
      (0.65 * Math.sin(2 * Math.PI * f1 * t + phase1) + 0.35 * Math.sin(2 * Math.PI * f2 * t + phase2));
    line.push({
      lat: p.lat + (q.lat - p.lat) * t + (ny * bend) / kmPerLat,
      lon: p.lon + (q.lon - p.lon) * t + (nx * bend) / kmPerLon,
    });
  }
  return flip ? line.reverse() : line;
}

interface Leg {
  from: GeoPoint;
  to: GeoPoint;
  kind: Kind;
  border: boolean;
  key: string;
}

/** A point this close to a town is in it, km. */
const IN_TOWN_KM = 2;

/**
 * Towns a point can drive to on local roads: the nearest, and up to two more
 * that are not much farther. Keeping to towns about as near as the nearest one
 * stops the local road from crossing the sea from an island to the mainland.
 */
function accessTowns(point: GeoPoint) {
  const near = TOWNS.map((town, i) => ({ i, km: distanceKm(point, town.point) }))
    .filter((t) => t.km <= MAX_ACCESS_KM)
    .sort((a, b) => a.km - b.km);
  if (!near.length) return near;
  if (near[0].km <= IN_TOWN_KM) return near.slice(0, 1);
  return near.filter((t) => t.km <= near[0].km * 1.5 + 10).slice(0, 3);
}

/** Fastest legs from origin to destination over the network (Dijkstra). */
function fastestLegs(origin: GeoPoint, destination: GeoPoint): Leg[] {
  const n = TOWNS.length;
  const START = n;
  const END = n + 1;
  const point = (i: number) => (i === START ? origin : i === END ? destination : TOWNS[i].point);
  const edges = (i: number): Edge[] => {
    if (i === START) {
      const out = accessTowns(origin).map(({ i: to }) => ({
        to,
        kind: "local" as const,
        border: false,
        minutes: travelMinutes(origin, TOWNS[to].point, "local", false),
      }));
      if (distanceKm(origin, destination) <= DIRECT_KM)
        out.push({
          to: END,
          kind: "local",
          border: false,
          minutes: travelMinutes(origin, destination, "local", false),
        });
      return out;
    }
    const out = [...network[i]];
    if (accessTowns(destination).some((t) => t.i === i))
      out.push({
        to: END,
        kind: "local",
        border: false,
        minutes: travelMinutes(TOWNS[i].point, destination, "local", false),
      });
    return out;
  };

  const best = new Array<number>(n + 2).fill(Infinity);
  const via = new Array<{ from: number; edge: Edge } | null>(n + 2).fill(null);
  const done = new Array<boolean>(n + 2).fill(false);
  best[START] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n + 2; i++) if (!done[i] && best[i] < Infinity && (u === -1 || best[i] < best[u])) u = i;
    if (u === -1 || u === END) break;
    done[u] = true;
    for (const edge of edges(u)) {
      const t = best[u] + edge.minutes;
      if (t < best[edge.to]) {
        best[edge.to] = t;
        via[edge.to] = { from: u, edge };
      }
    }
  }
  if (best[END] === Infinity) throw new RouteError("noRoute");

  const legs: Leg[] = [];
  for (let at = END; at !== START; ) {
    const step = via[at]!;
    const idOf = (i: number) => (i === START ? "start" : i === END ? "end" : TOWNS[i].id);
    const ids = [idOf(step.from), idOf(at)].sort().join("|");
    legs.unshift({ from: point(step.from), to: point(at), kind: step.edge.kind, border: step.edge.border, key: ids });
    at = step.from;
  }
  return legs;
}

export function simulatedRoute(request: RouteRequest): Route {
  const { origin, destination, departure } = request;
  if (distanceKm(origin, destination) < 0.5) throw new RouteError("samePlace");
  const legs = fastestLegs(origin, destination);

  const path: RoutePoint[] = [{ ...origin, km: 0, min: 0 }];
  let km = 0;
  let min = 0;
  for (const leg of legs) {
    const line = roadLine(leg.from, leg.to, leg.kind, leg.key);
    // Wait at the start of the leg for the border or the ferry.
    const wait = (leg.border ? BORDER_MIN : 0) + (leg.kind === "ferry" ? FERRY_WAIT_MIN : 0);
    if (wait) {
      min += wait;
      path.push({ ...line[0], km, min });
    }
    for (let i = 1; i < line.length; i++) {
      const step = distanceKm(line[i - 1], line[i]) * ROAD_FACTOR[leg.kind];
      km += step;
      min += (step / SPEED_KMH[leg.kind]) * 60;
      path.push({ ...line[i], km, min });
    }
  }

  const start = Date.parse(departure);
  return {
    source: "simulated",
    departure: new Date(start).toISOString(),
    arrival: new Date(start + min * 60_000).toISOString(),
    distanceKm: km,
    durationMin: min,
    path,
    borders: legs.filter((l) => l.border).length,
    ferry: legs.some((l) => l.kind === "ferry"),
  };
}
