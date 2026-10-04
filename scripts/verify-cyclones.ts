/**
 * Checks for tropical cyclone tracks (step 6): the BUFR reader against
 * values ecCodes reads from the same ECMWF files, ECMWF's tracks as storms,
 * the cone and its drawing, how close a path comes to a place, the strength
 * names, the storm alert for the place and favorites, finding the newest run
 * on ECMWF's portal and its Google Cloud copy, /api/cyclones, and the sample
 * storm. Uses ECMWF sample files and made-up portal replies, so it needs no
 * network.
 * Run with: npm run verify:cyclones
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demoCyclones } from "../src/lib/cycloneDemo";
import {
  ALERT_KM,
  basinOf,
  buildCone,
  categoryOf,
  closestApproach,
  coneRings,
  cycloneAlerts,
  distanceKm,
  inRegion,
  memberPath,
  nearShare,
  pathAt,
  SOON_HOURS,
  STORM_KMH,
  stormAt,
  trackAhead,
  trackPath,
  TYPHOON_KMH,
  unwrap,
  type CycloneFeed,
} from "../src/lib/cyclones";
import { BufrError, decodeBufr, type BufrValue } from "../src/services/cyclones/bufr";
import { cyclonesFromBufr, MAX_HOURS } from "../src/services/cyclones/ecmwfTracks";
import { cyclonesResponse, FRESH_SECONDS } from "../src/services/cyclones/http";
import type { Alert } from "../src/services/ops/alert";
import {
  CycloneSourceError,
  fetchCyclones,
  findTrackFile,
  MIRROR,
  MIRROR_URL,
  mirrorFolder,
  OPEN_DATA_URL,
  runFolder,
  trackFileIn,
} from "../src/services/cyclones/openData";

const HOUR = 3_600_000;
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));
const TRACKS = fixture("ecmwf-tc-tracks-2015-11-18.bufr");
const UNCOMPRESSED = fixture("ecmwf-ens-uncompressed.bufr");
/** One storm (33W CHOI-WAN) from ECMWF's track file of 3 October 2026 00 UTC, in today's 3-16-082 layout. */
const TODAY = fixture("ecmwf-tc-tracks-2026-10-03-33W.bufr");

const BANGKOK = { lat: 13.75, lon: 100.5 };
const NOW = Date.UTC(2026, 9, 3, 18, 0); // 4 Oct 2026, 01:00 in Bangkok

const valueOf = (values: BufrValue[], code: number, nth = 1) => values.filter((v) => v.code === code)[nth - 1]?.value;
const near = (a: number, b: number, tolerance: number, what: string) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} is not within ${tolerance} of ${b}`);

async function main() {
  /* ---------------- BUFR: compressed, as ECMWF writes tracks ---------------- */
  const messages = decodeBufr(TRACKS);
  assert.equal(messages.length, 3, "one message per storm");
  assert.deepEqual(
    messages.map((m) => m.subsets.length),
    [52, 52, 37],
    "one subset per ensemble member",
  );
  assert.ok(
    messages.every((m) => m.compressed && m.edition === 4 && m.centre === 98),
    "ECMWF, edition 4, compressed",
  );
  assert.equal(messages[0].typicalTime, "2015-11-18T00:00:00.000Z", "a 2-digit year in section 1 is read as 2015");
  assert.equal(messages[0].subsets[0].length, 425, "every value of a subset, replication counts included");

  // Values ecCodes 2.49 reads from the same file.
  const hres = messages[0].subsets[51];
  assert.equal(valueOf(hres, 1025), "27W");
  assert.equal(valueOf(hres, 1027), "IN-FA");
  assert.equal(valueOf(hres, 1091), 52);
  assert.equal(valueOf(hres, 1092), 0, "the high-resolution forecast");
  assert.equal(valueOf(messages[0].subsets[50], 1092), 1, "the control");
  assert.equal(valueOf(messages[0].subsets[0], 1092), null, "a perturbed member has no type (missing)");
  assert.equal(valueOf(hres, 31001), 40, "40 six-hourly steps");
  assert.deepEqual(
    [valueOf(hres, 5002), valueOf(hres, 6002), valueOf(hres, 5002, 2), valueOf(hres, 6002, 2)],
    [5.5, 157.2, 5.4, 156.9],
    "observed and analysed centres",
  );
  assert.deepEqual(
    [1, 2, 7].map((i) => [
      valueOf(hres, 4024, i),
      valueOf(hres, 5002, 2 * i + 2),
      valueOf(hres, 6002, 2 * i + 2),
      valueOf(hres, 10051, i + 1),
      valueOf(hres, 11012, i + 1),
    ]),
    [
      [6, 6.1, 155.9, 99700, 21.6],
      [12, 6.5, 154.8, 99700, 22.6],
      [42, 9.2, 150, 98800, 26.2],
    ],
    "HRES track: hours, centre, pressure (Pa), strongest wind (m/s)",
  );
  const first = messages[0].subsets[0];
  assert.deepEqual(
    [
      valueOf(first, 4024),
      valueOf(first, 5002, 4),
      valueOf(first, 6002, 4),
      valueOf(first, 10051, 2),
      valueOf(first, 11012, 2),
    ],
    [6, 6, 156, 99800, 20.1],
    "member 1 at 6 hours",
  );
  assert.equal(valueOf(messages[1].subsets[0], 5002), null, "70E has no observed centre (missing in every subset)");

  /* ---------------- BUFR: uncompressed subsets ---------------- */
  const [ens] = decodeBufr(UNCOMPRESSED);
  assert.equal(ens.compressed, false);
  assert.equal(ens.subsets.length, 51);
  assert.equal(valueOf(ens.subsets[0], 5195), 0, "ECMWF's own member number");
  assert.equal(valueOf(ens.subsets[50], 5195), 50);
  assert.deepEqual([valueOf(ens.subsets[0], 5001), valueOf(ens.subsets[0], 6001)], [51.52, 0.97]);
  assert.deepEqual([valueOf(ens.subsets[0], 12004), valueOf(ens.subsets[0], 12004, 2)], [292.7, 291.6]);
  assert.deepEqual([valueOf(ens.subsets[50], 12004), valueOf(ens.subsets[50], 12004, 2)], [292.7, 291.7]);

  /* ---------------- BUFR: today's layout (sequence 3-16-082) ---------------- */
  const [today] = decodeBufr(TODAY);
  assert.equal(today.masterTablesVersion, 35);
  assert.deepEqual(today.descriptors, [316082], "the whole message is one tropical cyclone sequence");
  assert.equal(today.subsets.length, 51, "50 perturbed members and the high-resolution forecast");
  // Values ecCodes 2.49 reads from the same message.
  const todayHres = today.subsets[50];
  assert.equal(todayHres.length, 1142);
  assert.deepEqual(
    [1090, 1091, 1092, 31001].map((code) => valueOf(todayHres, code)),
    [2, 51, 0, 22],
    "high-resolution, 22 six-hourly steps",
  );
  assert.deepEqual(
    [8005, 5002, 6002].map((code) => valueOf(todayHres, code, 2)),
    [5, 18.5, 145.5],
    "the high-resolution analysis is significance 5 (members use 4)",
  );
  assert.equal(valueOf(today.subsets[0], 8005, 2), 4);
  assert.deepEqual(
    [1, 2, 3].map((i) => valueOf(todayHres, 19003, i)),
    [18, 26, 33],
    "wind radii thresholds (m/s)",
  );
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((i) => valueOf(todayHres, 19004, i)),
    [337100, 616700, 540800, 296300, 79600, 96300],
    "wind radii (m): 2-01-131 makes 0-19-004 3 bits wider, so 616.7 km fits",
  );

  /* ---------------- BUFR: what it refuses ---------------- */
  assert.throws(() => decodeBufr(TRACKS.slice(0, 5000)), BufrError, "a cut-short file");
  const u24 = (bytes: Uint8Array, at: number) => (bytes[at] << 16) | (bytes[at + 1] << 8) | bytes[at + 2];
  const odd = TRACKS.slice(0, u24(TRACKS, 4));
  const s2 = 8 + u24(odd, 8);
  const s3 = odd[17] & 0x80 ? s2 + u24(odd, s2) : s2;
  // Section 3's first descriptor becomes 0-13-241, which DooFah's tables don't have.
  odd[s3 + 7] = 13;
  odd[s3 + 8] = 241;
  assert.throws(() => decodeBufr(odd), /not in DooFah's tables/, "an element it doesn't know");

  /* ---------------- ECMWF's tracks as storms ---------------- */
  const feed = cyclonesFromBufr(TRACKS);
  assert.throws(
    () => cyclonesFromBufr(new TextEncoder().encode("<html>Too many requests</html>")),
    BufrError,
    "a page instead of a track file is an error, not a quiet day",
  );
  assert.equal(feed.run, "2015-11-18T00:00:00.000Z");
  assert.deepEqual(
    feed.storms.map((s) => s.id),
    ["27W"],
    "only observed storms: 70E and 71W are storms the model expects, not active ones",
  );
  const infa = feed.storms[0];
  assert.equal(infa.name, "IN-FA");
  assert.equal(infa.basin, "typhoon");
  assert.equal(infa.track_from, "hres");
  assert.equal(infa.members.length, 52);
  assert.deepEqual(
    infa.track.slice(0, 2),
    [
      { time: "2015-11-18T00:00:00.000Z", lat: 5.4, lon: 156.9, pressure_hpa: 1000, wind_kmh: 65 },
      { time: "2015-11-18T06:00:00.000Z", lat: 6.1, lon: 155.9, pressure_hpa: 997, wind_kmh: 78 },
    ],
    "the analysis, then every 6 hours: hPa and km/h",
  );
  assert.equal(infa.track.length, MAX_HOURS / 6 + 1, "kept to MAX_HOURS after the run");
  assert.deepEqual(infa.members[50].slice(0, 6), [0, 5.4, 156.9, 6, 6, 156], "the control's path");
  const cone = infa.cone;
  assert.equal(cone[0].time, infa.track[0].time);
  assert.ok(cone[0].radius_km >= 30 && cone[cone.length - 1].radius_km > cone[0].radius_km * 5, "the cone widens");
  // Two in three of the members sit inside the cone at each time.
  const run = Date.parse(feed.run!);
  const paths = infa.members.map((m) => memberPath(m, run));
  for (const c of cone) {
    const t = Date.parse(c.time);
    const here = paths.map((p) => p.find((q) => q.t === t)).filter((p) => !!p);
    const inside = here.filter((p) => distanceKm(p!, c) <= c.radius_km).length;
    assert.ok(inside / here.length >= 2 / 3 - 1e-9, `${c.time}: ${inside} of ${here.length} inside`);
  }
  assert.deepEqual(buildCone([]), [], "no members, no cone");

  const choiWan = cyclonesFromBufr(TODAY);
  assert.equal(choiWan.run, "2026-10-03T00:00:00.000Z");
  const [cw] = choiWan.storms;
  assert.deepEqual(
    [cw.id, cw.name, cw.basin, cw.track_from, cw.members.length],
    ["33W", "CHOI-WAN", "typhoon", "hres", 51],
  );
  assert.deepEqual(
    cw.track.slice(0, 2),
    [
      { time: "2026-10-03T00:00:00.000Z", lat: 18.5, lon: 145.5, pressure_hpa: 968, wind_kmh: 141 },
      { time: "2026-10-03T06:00:00.000Z", lat: 19.3, lon: 145.8, pressure_hpa: 962, wind_kmh: 107 },
    ],
    "today's layout: the path starts at the analysis",
  );
  assert.ok(cw.cone.length > 10);

  /* ---------------- Strength and names ---------------- */
  assert.equal(categoryOf(null, "typhoon"), "depression");
  assert.equal(categoryOf(62, "typhoon"), "depression", "under 34 knots");
  assert.equal(categoryOf(Math.ceil(STORM_KMH), "typhoon"), "storm");
  assert.equal(categoryOf(118, "typhoon"), "storm", "under 64 knots");
  assert.equal(categoryOf(Math.ceil(TYPHOON_KMH), "typhoon"), "typhoon");
  assert.equal(categoryOf(150, "hurricane"), "hurricane");
  assert.equal(basinOf("27W", BANGKOK), "typhoon");
  assert.equal(basinOf("09L", BANGKOK), "hurricane");
  assert.equal(basinOf("02B", BANGKOK), "cyclone", "Bay of Bengal");
  assert.equal(basinOf("99", { lat: 15, lon: 125 }), "typhoon", "no letter: by where it is");
  assert.equal(basinOf("99", { lat: -15, lon: 125 }), "cyclone");
  assert.equal(basinOf("99", { lat: 20, lon: -60 }), "hurricane");

  /* ---------------- Geometry ---------------- */
  near(distanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 111.2, 0.1, "a degree of latitude");
  assert.equal(unwrap(-179, 179), 181, "continuous over the date line");
  const line = [
    { t: 0, lat: 10, lon: 100 },
    { t: 10 * HOUR, lat: 10, lon: 110 },
  ];
  assert.deepEqual(pathAt(line, 5 * HOUR), { lat: 10, lon: 105, i: 0, f: 0.5 });
  assert.equal(pathAt(line, 11 * HOUR), null, "after the path ends");
  const closest = closestApproach(line, { lat: 12, lon: 105 }, 0, 10 * HOUR)!;
  near(closest.km, 222.4, 1, "closest approach");
  assert.equal(closest.time, 5 * HOUR);
  assert.equal(closestApproach(line, { lat: 12, lon: 105 }, 11 * HOUR, 12 * HOUR), null, "nothing in the window");
  const mid = stormAt(infa, Date.parse("2015-11-18T03:00:00Z"))!;
  assert.deepEqual(
    [mid.lat, mid.lon, mid.pressure_hpa, mid.wind_kmh],
    [5.75, 156.4, 998.5, 71.5],
    "halfway between points",
  );

  const rings = coneRings(cone);
  assert.equal(rings.length, cone.length * 2 - 1, "a circle at each time and a band to the next");
  for (const ring of rings) {
    const twiceArea = ring.reduce((s, [lat, lon], i) => {
      const [lat2, lon2] = ring[(i + 1) % ring.length];
      return s + lon * lat2 - lon2 * lat;
    }, 0);
    assert.ok(twiceArea > 0, "every ring turns the same way, so they fill as one shape");
  }

  /* ---------------- The alert ---------------- */
  const demo = demoCyclones(BANGKOK, NOW);
  const storm = demo.storms[0];
  assert.equal(demo.demo, true);
  assert.equal(storm.members.length, 51);
  assert.ok(Date.parse(demo.run!) <= NOW && storm.cone.length > 10, "a past run with a cone");
  assert.ok(inRegion(storm, BANGKOK, NOW), "near Bangkok");
  assert.ok(!inRegion(storm, { lat: 35.7, lon: 139.7 }, NOW), "not near Tokyo");
  assert.ok(trackAhead(storm.track, NOW).every((p) => Date.parse(p.time) <= NOW + 126 * HOUR));

  const bangkok = { id: "bangkok", name: "Bangkok", point: BANGKOK };
  const home = { id: "home", name: "Home", point: { lat: 14.35, lon: 100.57 } }; // Ayutthaya
  const phuket = { id: "phuket", name: "Phuket", point: { lat: 7.88, lon: 98.39 } };
  const tokyo = { id: "tokyo", name: "Tokyo", point: { lat: 35.68, lon: 139.69 } };
  const [alert, ...rest] = cycloneAlerts(demo, bangkok, [home, phuket], NOW);
  assert.equal(rest.length, 0, "one alert per storm");
  assert.equal(alert.level, "severe", "within 500 km in the next 48 hours");
  assert.equal(alert.place, "Bangkok");
  assert.equal(alert.category, "typhoon");
  near(alert.km, 160, 10, "closest distance");
  near(Date.parse(alert.at!) - NOW, 30 * HOUR, HOUR, "closest 30 hours from now");
  assert.equal(alert.windKmh, 165);
  assert.ok(alert.chance !== null && alert.chance >= 90, "nearly every member passes within 500 km");
  assert.deepEqual(alert.also, ["Home"], "favorites within 500 km, not Phuket");
  assert.deepEqual(cycloneAlerts(demo, tokyo, [], NOW), [], "too far: no alert");
  const [forHome] = cycloneAlerts(demo, tokyo, [phuket, home], NOW);
  assert.equal(forHome.place, "Home", "the nearest favorite when the place itself is clear");

  // Further along the path, the storm comes later: a heads-up, not urgent.
  const pointAfter = (hours: number) => storm.track.find((p) => Date.parse(p.time) >= NOW + hours * HOUR)!;
  const [headsUp] = cycloneAlerts(demo, { id: "later", name: "Later", point: pointAfter(90) }, [], NOW);
  assert.equal(headsUp.level, "warning");
  assert.ok(Date.parse(headsUp.at!) > NOW + SOON_HOURS * HOUR);
  // Within 500 km inside 48 hours, though closest after: severe all the same.
  const [early] = cycloneAlerts(demo, { id: "early", name: "Early", point: pointAfter(60) }, [], NOW);
  assert.ok(Date.parse(early.at!) > NOW + SOON_HOURS * HOUR, "comes closest after 48 hours");
  assert.equal(early.level, "severe", "but is within 500 km before then");
  const already = cycloneAlerts(demo, { id: "x", name: "Sea", point: stormAt(storm, NOW)! }, [], NOW)[0];
  assert.equal(already.at, null, "already that close");
  assert.equal(already.km, 0);
  assert.equal(nearShare({ ...storm, members: [] }, NOW, BANGKOK, NOW, NOW + HOUR), null, "no members, no chance");
  assert.ok(
    trackPath(storm.track).every((p, i, all) => i === 0 || p.t - all[i - 1].t === 6 * HOUR),
    "6-hourly track",
  );
  assert.equal(ALERT_KM, 500);

  /* ---------------- ECMWF's portal ---------------- */
  const run0 = Date.UTC(2026, 9, 2, 0);
  assert.equal(runFolder(run0), "https://data.ecmwf.int/forecasts/20261002/00z/ifs/0p25/enfo/");
  const listing = (run: number, extra = "") => {
    const stamp = new Date(run).toISOString().replace(/\D/g, "").slice(0, 10) + "0000";
    return `<html><a href="${runFolder(run)}${stamp}-0h-enfo-ef.grib2">x</a>${extra}</html>`;
  };
  const tf = (run: number, step: number) =>
    `<a href="${runFolder(run)}${new Date(run).toISOString().replace(/\D/g, "").slice(0, 10)}0000-${step}h-enfo-tf.bufr">tf</a>`;
  assert.equal(trackFileIn(listing(run0, tf(run0, 360)), run0), "20261002000000-360h-enfo-tf.bufr");
  assert.equal(trackFileIn(listing(run0, tf(run0 - 6 * HOUR, 144)), run0), null, "another run's file");

  /** A made-up portal: folders by run, and files by name. */
  const portal = (folders: Record<number, string | number>, files: Record<string, Uint8Array> = {}) => {
    const asked: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      asked.push(url);
      const file = Object.entries(files).find(([name]) => url.endsWith(name));
      if (file) return new Response(new Blob([new Uint8Array(file[1])]));
      const run = Object.keys(folders)
        .map(Number)
        .find((r) => runFolder(r) === url);
      if (run === undefined) return new Response("not found", { status: 404 });
      const body = folders[run];
      return typeof body === "number" ? new Response("busy", { status: body }) : new Response(body);
    }) as typeof fetch;
    return { fetcher, asked };
  };
  const at = Date.UTC(2026, 9, 3, 15, 20); // the 12 UTC run is being made
  const r12 = Date.UTC(2026, 9, 3, 12);
  const r06 = Date.UTC(2026, 9, 3, 6);
  const r00 = Date.UTC(2026, 9, 3, 0);
  const newest = portal({ [r12]: listing(r12), [r06]: listing(r06, tf(r06, 144)), [r00]: listing(r00, tf(r00, 360)) });
  assert.deepEqual(await findTrackFile(at, newest.fetcher), {
    run: r06,
    url: `${runFolder(r06)}20261003060000-144h-enfo-tf.bufr`,
  });
  assert.equal(newest.asked.length, 2, "stops at the newest run with tracks");
  assert.equal(await findTrackFile(at, portal({ [r12]: listing(r12), [r06]: listing(r06) }).fetcher), null);
  const stale = portal({ [r12]: listing(r12), [r06]: listing(r06), [r00]: listing(r00, tf(r00, 360)) });
  assert.equal(await findTrackFile(at, stale.fetcher), null, "two runs without tracks: no storms, not the 00 UTC ones");
  assert.equal(stale.asked.length, 2);
  const gap = portal({ [r06]: listing(r06), [r00]: listing(r00, tf(r00, 360)) });
  assert.equal(
    (await findTrackFile(at, gap.fetcher))?.run,
    r00,
    "the 12 UTC run isn't out yet, so 06 and 00 UTC are the two newest",
  );
  await assert.rejects(findTrackFile(at, portal({}).fetcher), CycloneSourceError, "no runs at all: the portal moved?");
  await assert.rejects(findTrackFile(at, portal({ [r12]: 503 }).fetcher), /503/);
  assert.deepEqual(await fetchCyclones(at, portal({ [r06]: listing(r06) }).fetcher), { run: null, storms: [] });
  const withFile = portal({ [r00]: listing(r00, tf(r00, 360)) }, { "20261003000000-360h-enfo-tf.bufr": TRACKS });
  const fetched = await fetchCyclones(at, withFile.fetcher);
  assert.deepEqual(
    fetched.storms.map((s) => s.name),
    ["IN-FA"],
    "Google Cloud answers 404 here, so the file comes from the portal",
  );
  assert.ok(withFile.asked[0].startsWith(MIRROR_URL), "Google Cloud is asked first");
  await fetchCyclones(at + 60_000, withFile.fetcher);
  assert.equal(withFile.asked.filter((u) => u.endsWith(".bufr")).length, 1, "a run's file is read once and kept");

  /* ---------------- ECMWF's copy on Google Cloud ---------------- */
  assert.equal(mirrorFolder(r06), "https://storage.googleapis.com/ecmwf-open-data/20261003/06z/ifs/0p25/enfo/");
  /** A made-up bucket listing, as Google Cloud answers ?prefix=…&delimiter=/ (no <Contents> for a missing folder). */
  const bucket = (run: number, names: string[]) =>
    `<?xml version='1.0' encoding='UTF-8'?><ListBucketResult><Prefix>${mirrorFolder(run).slice(MIRROR_URL.length + 1)}</Prefix>` +
    names
      .map(
        (name) =>
          `<Contents><Key>${mirrorFolder(run).slice(MIRROR_URL.length + 1)}${name}</Key><Size>1</Size></Contents>`,
      )
      .join("") +
    "</ListBucketResult>";
  /** The portal answering every request with this status, and Google Cloud's bucket with these folders and files. */
  const mirrored = (
    portalStatus: number,
    folders: Record<number, string[] | number>,
    files: Record<string, Uint8Array>,
  ) => {
    const asked: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      asked.push(url);
      if (url.startsWith(OPEN_DATA_URL)) return new Response("slow down", { status: portalStatus });
      const file = Object.entries(files).find(([name]) => url.endsWith(name));
      if (file && url.startsWith(MIRROR_URL + "/")) return new Response(new Blob([new Uint8Array(file[1])]));
      const prefix = new URL(url).searchParams.get("prefix");
      const run = Object.keys(folders)
        .map(Number)
        .find((r) => mirrorFolder(r) === `${MIRROR_URL}/${prefix}`);
      const body = run === undefined ? [] : folders[run];
      return typeof body === "number" ? new Response("busy", { status: body }) : new Response(bucket(run!, body));
    }) as typeof fetch;
    return { fetcher, asked };
  };
  const names = (run: number, step?: number) => {
    const stamp = new Date(run).toISOString().replace(/\D/g, "").slice(0, 10) + "0000";
    return [`${stamp}-0h-enfo-ef.grib2`, ...(step ? [`${stamp}-${step}h-enfo-tf.bufr`] : [])];
  };
  assert.equal(await MIRROR.list(r12, mirrored(429, {}, {}).fetcher), null, "a folder with no files isn't there");
  const viaMirror = mirrored(
    429,
    { [r06]: names(r06), [r00]: names(r00, 360) },
    {
      "20261003000000-360h-enfo-tf.bufr": TRACKS,
    },
  );
  assert.deepEqual(await findTrackFile(at, viaMirror.fetcher, MIRROR), {
    run: r00,
    url: `${mirrorFolder(r00)}20261003000000-360h-enfo-tf.bufr`,
  });
  const before = viaMirror.asked.length;
  const fromMirror = await fetchCyclones(at + 2 * HOUR, viaMirror.fetcher);
  const asked = viaMirror.asked.slice(before);
  assert.deepEqual(
    fromMirror.storms.map((s) => s.name),
    ["IN-FA"],
    "the file comes from Google Cloud",
  );
  assert.ok(
    asked.every((u) => u.startsWith(MIRROR_URL)),
    "the portal isn't asked when Google Cloud has the file",
  );
  assert.equal(asked.at(-1), `${mirrorFolder(r00)}20261003000000-360h-enfo-tf.bufr`);
  const noTracks = mirrored(403, { [r12]: names(r12), [r06]: names(r06) }, {});
  assert.deepEqual(await fetchCyclones(at, noTracks.fetcher), { run: null, storms: [] }, "no tracks: no storms");
  assert.ok(!noTracks.asked.some((u) => u.startsWith(OPEN_DATA_URL)), "Google Cloud's answer is enough");
  const bothFail = mirrored(403, { [r12]: 503 }, {});
  await assert.rejects(
    fetchCyclones(at, bothFail.fetcher),
    (error: Error) =>
      error instanceof CycloneSourceError &&
      /Google Cloud answered 503/.test(error.message) &&
      /ECMWF answered 403/.test(error.message),
    "both fail: the error names both",
  );
  assert.deepEqual(
    bothFail.asked.map((u) => (u.startsWith(MIRROR_URL) ? "Google Cloud" : "ECMWF")),
    ["Google Cloud", "Google Cloud", "ECMWF"],
    "a 503 is asked again once, a 403 never",
  );

  // Google Cloud failing once: asked again, and no fallback. Failing for good: the portal, and a fallback reported.
  let busyOnce = 1;
  const flaky = (async (input: string | URL | Request, init?: RequestInit) =>
    String(input).startsWith(`${MIRROR_URL}?`) && busyOnce-- > 0
      ? new Response("busy", { status: 503 })
      : viaMirror.fetcher(input, init)) as typeof fetch;
  const fellBack: string[] = [];
  assert.deepEqual(
    (await fetchCyclones(at + 2 * HOUR, flaky, (reason) => fellBack.push(reason))).storms.map((s) => s.name),
    ["IN-FA"],
    "Google Cloud answers the second time",
  );
  assert.ok(busyOnce < 0, "Google Cloud is asked again after its 503");
  assert.equal(fellBack.length, 0, "a retry that works isn't a fallback");

  // Google Cloud handing over something that isn't tracks, or a file cut off part way: the portal's file is read.
  const at2 = at + 24 * HOUR;
  const r00b = r00 + 24 * HOUR;
  const fileB = "20261004000000-360h-enfo-tf.bufr";
  const goodPortal = portal({ [r00b]: listing(r00b, tf(r00b, 360)) }, { [fileB]: TRACKS });
  const split = (copy: typeof fetch) =>
    (async (input: string | URL | Request, init?: RequestInit) =>
      String(input).startsWith(MIRROR_URL) ? copy(input, init) : goodPortal.fetcher(input, init)) as typeof fetch;
  const garbled = mirrored(
    403,
    { [r00b]: names(r00b, 360) },
    { [fileB]: new TextEncoder().encode("<html>busy</html>") },
  );
  const garbledAsked = garbled.asked.length;
  assert.deepEqual(
    (await fetchCyclones(at2, split(garbled.fetcher), (reason) => fellBack.push(reason))).storms.map((s) => s.name),
    ["IN-FA"],
    "a file from Google Cloud that isn't BUFR: the portal's is read",
  );
  assert.equal(
    garbled.asked.slice(garbledAsked).filter((u) => u.endsWith(".bufr")).length,
    1,
    "a file that isn't tracks isn't asked for again",
  );
  assert.equal(fellBack.length, 1, "reading from the portal is a fallback");
  assert.match(fellBack[0], /^ECMWF answered after: Google Cloud's track file could not be read/);
  assert.ok(goodPortal.asked.some((u) => u === runFolder(r00b) + fileB));
  const cutOff = (async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).endsWith(".bufr")) return garbled.fetcher(input, init);
    return new Response(new ReadableStream({ start: (c) => c.error(new Error("connection reset")) }));
  }) as typeof fetch;
  assert.deepEqual(
    (await fetchCyclones(at2, split(cutOff))).storms.map((s) => s.name),
    ["IN-FA"],
    "a file from Google Cloud cut off part way: a failed source, so the portal's is read",
  );
  await assert.rejects(
    fetchCyclones(at2, mirrored(403, { [r00b]: names(r00b, 360) }, { [fileB]: new Uint8Array([1, 2, 3]) }).fetcher),
    (error: Error) =>
      error instanceof CycloneSourceError &&
      /Google Cloud's track file could not be read/.test(error.message) &&
      /ECMWF answered 403/.test(error.message),
    "a bad file and a refusal: the error names both",
  );

  /* ---------------- /api/cyclones ---------------- */
  const request = (headers: Record<string, string> = {}) =>
    new Request("https://doofah.test/api/cyclones", { headers });
  const alerts: Alert[] = [];
  const report = (alert: Alert) => alerts.push(alert);
  const ok = await cyclonesResponse(request({ "sec-fetch-site": "same-origin" }), async () => feed, NOW, report);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "public, max-age=300", "the browser keeps it 5 minutes");
  assert.equal(
    ok.headers.get("vercel-cdn-cache-control"),
    `max-age=${FRESH_SECONDS}, stale-while-revalidate=${6 * 3600}, stale-if-error=${12 * 3600}`,
    "the edge keeps it half an hour, and serves it up to 12 hours while ECMWF fails",
  );
  const body = (await ok.json()) as CycloneFeed;
  assert.equal(body.storms[0].name, "IN-FA");
  assert.equal(alerts.length, 0, "no alert when Google Cloud answers");
  const other = await cyclonesResponse(request({ "sec-fetch-site": "cross-site" }), async () => feed, NOW, report);
  assert.equal(other.status, 403);
  const viaPortal = await cyclonesResponse(
    request(),
    async (_, onFallback) => {
      onFallback("ECMWF answered after: Google Cloud answered 503 for …");
      return feed;
    },
    NOW,
    report,
  );
  assert.equal(viaPortal.status, 200, "the portal's answer is served as usual");
  assert.deepEqual(alerts.splice(0), [
    { kind: "fallback", api: "/api/cyclones", message: "ECMWF answered after: Google Cloud answered 503 for …" },
  ]);
  const failed = await cyclonesResponse(
    request(),
    async () => {
      throw new CycloneSourceError("Google Cloud answered 503; ECMWF answered 503");
    },
    NOW,
    report,
  );
  assert.equal(failed.status, 502);
  assert.equal(
    failed.headers.get("cache-control"),
    "no-store",
    "a failure isn't kept, so the edge serves the last answer",
  );
  assert.equal(failed.headers.get("vercel-cdn-cache-control"), null);
  assert.deepEqual(alerts.splice(0), [
    { kind: "error", api: "/api/cyclones", message: "502, Google Cloud answered 503; ECMWF answered 503" },
  ]);
  const unreadable = await cyclonesResponse(
    request(),
    async () => {
      throw new BufrError("Element 013241 is not in DooFah's tables");
    },
    NOW,
    report,
  );
  assert.equal(unreadable.status, 502);
  assert.match(alerts.splice(0)[0].message, /^502, ECMWF's track file could not be read: Element 013241/);
  const logged = console.error;
  console.error = () => {};
  const broken = await cyclonesResponse(
    request(),
    async () => {
      throw new TypeError("storms is undefined");
    },
    NOW,
    report,
  ).finally(() => (console.error = logged));
  assert.equal(broken.status, 500);
  assert.deepEqual(alerts.splice(0), [{ kind: "error", api: "/api/cyclones", message: "500: storms is undefined" }]);

  console.log(
    `verify:cyclones ok · ${messages.length} BUFR messages, ${feed.storms.length} active storm (${infa.name}), ` +
      `${cone.length}-step cone, alert at ${alert.km} km`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
