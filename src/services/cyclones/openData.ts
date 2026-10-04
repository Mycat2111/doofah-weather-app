/**
 * Finds and reads the newest tropical cyclone track file in ECMWF's open
 * data (CC BY 4.0): on the copy ECMWF keeps on Google Cloud, which has the
 * same folders and files as ECMWF's portal, data.ecmwf.int, and no limit on
 * how much each server may ask; or on the portal when Google Cloud fails.
 *
 * The ensemble runs four times a day. A run's files land together about
 * 7.5 hours after it starts, and its tracks a minute later, as a file like
 * 20261002000000-360h-enfo-tf.bufr (144h for the 06 and 18 UTC runs). The
 * newest run whose folder lists one is used, looking back one run for that
 * minute. When two runs in a row have none, there are no storms to follow,
 * and an older run's storms would be out of date.
 */

import type { CycloneFeed } from "@/lib/cyclones";
import { BufrError } from "./bufr";
import { cyclonesFromBufr } from "./ecmwfTracks";

export const OPEN_DATA_URL = "https://data.ecmwf.int/forecasts";
export const MIRROR_URL = "https://storage.googleapis.com/ecmwf-open-data";
const HOUR_MS = 3_600_000;
const RUN_MS = 6 * HOUR_MS;
/** Runs looked at for a folder, newest first: a day's worth and the one being made. */
const RUNS_LOOKED_AT = 5;
const TIMEOUT_MS = 20_000;
/** A run's tracks never change, so one read is kept in the server's memory this long. */
const KEEP_MS = 12 * HOUR_MS;

export class CycloneSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CycloneSourceError";
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Where the ensemble run starting at `run` (ms) keeps its files, from the top of the open data. */
function runPath(run: number): string {
  const d = new Date(run);
  const day = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  return `${day}/${pad(d.getUTCHours())}z/ifs/0p25/enfo/`;
}

/** The portal folder of the ensemble run starting at `run` (ms). */
export const runFolder = (run: number) => `${OPEN_DATA_URL}/${runPath(run)}`;

/** The Google Cloud folder of the same run. */
export const mirrorFolder = (run: number) => `${MIRROR_URL}/${runPath(run)}`;

/** The track file named in a run folder's listing, for that run. */
export function trackFileIn(listing: string, run: number): string | null {
  const d = new Date(run);
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}0000`;
  const match = listing.match(new RegExp(`${stamp}-\\d+h-enfo-tf\\.bufr`));
  return match ? match[0] : null;
}

export const latestRun = (now: number) => Math.floor(now / RUN_MS) * RUN_MS;

async function get(url: string, fetcher: typeof fetch, from = "ECMWF"): Promise<Response> {
  try {
    return await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new CycloneSourceError(`${from} could not be reached (${(error as Error).message})`);
  }
}

/** A reply's body; one cut off or timed out part way is the source failing, like a refusal. */
async function body<T>(read: () => Promise<T>, from: string): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new CycloneSourceError(`${from} stopped answering (${(error as Error).message})`);
  }
}

/** A place that publishes ECMWF's open data: a run's folder, and the text listing its files (null when not there). */
export interface OpenDataSource {
  name: string;
  folder: (run: number) => string;
  list: (run: number, fetcher: typeof fetch) => Promise<string | null>;
}

/** ECMWF's own portal: a folder's address lists its files, and a missing folder is 404. */
export const PORTAL: OpenDataSource = {
  name: "ECMWF",
  folder: runFolder,
  async list(run, fetcher) {
    const res = await get(runFolder(run), fetcher);
    if (res.status === 404) return null;
    if (!res.ok) throw new CycloneSourceError(`ECMWF answered ${res.status} for ${runFolder(run)}`);
    return body(() => res.text(), "ECMWF");
  },
};

/** ECMWF's copy on Google Cloud: the bucket lists the names under a folder, none when it isn't there. */
export const MIRROR: OpenDataSource = {
  name: "Google Cloud",
  folder: mirrorFolder,
  async list(run, fetcher) {
    const url = `${MIRROR_URL}?${new URLSearchParams({ prefix: runPath(run), delimiter: "/" })}`;
    const res = await get(url, fetcher, "Google Cloud");
    if (!res.ok) throw new CycloneSourceError(`Google Cloud answered ${res.status} for ${mirrorFolder(run)}`);
    const text = await body(() => res.text(), "Google Cloud");
    return text.includes("<Key>") ? text : null;
  },
};

/** The newest run with tracks: its start (ms) and file; null when the two newest runs have none. */
export async function findTrackFile(
  now: number,
  fetcher: typeof fetch,
  source: OpenDataSource = PORTAL,
): Promise<{ run: number; url: string } | null> {
  let found = 0;
  for (let k = 0; k < RUNS_LOOKED_AT; k++) {
    const run = latestRun(now) - k * RUN_MS;
    const listing = await source.list(run, fetcher);
    // Not there yet (the run being made, or a gap in the open data).
    if (listing === null) continue;
    found += 1;
    const file = trackFileIn(listing, run);
    if (file) return { run, url: source.folder(run) + file };
    if (found === 2) return null;
  }
  if (found === 0) throw new CycloneSourceError(`No ECMWF run of the last day could be found on ${source.name}`);
  return null;
}

const kept = new Map<string, { at: number; feed: Promise<CycloneFeed> }>();

async function readTrackFile(url: string, run: number, source: OpenDataSource, fetcher: typeof fetch) {
  const res = await get(url, fetcher, source.name);
  if (!res.ok) throw new CycloneSourceError(`${source.name} answered ${res.status} for ${url}`);
  const { run: inFile, storms } = cyclonesFromBufr(new Uint8Array(await body(() => res.arrayBuffer(), source.name)));
  return { run: inFile ?? new Date(run).toISOString(), storms };
}

/** Where the tracks are read from, in turn: Google Cloud first, as the portal limits how much each server may ask. */
export const SOURCES: OpenDataSource[] = [MIRROR, PORTAL];

/** Why a source failed (refused, stopped answering, or handed over a file that isn't tracks); null for DooFah's own bugs. */
function failure(error: unknown, source: OpenDataSource): string | null {
  if (error instanceof CycloneSourceError) return error.message;
  if (error instanceof BufrError) return `${source.name}'s track file could not be read: ${error.message}`;
  return null;
}

/** The storms of the newest ECMWF run with tracks, from Google Cloud, or the portal when Google Cloud fails. */
export async function fetchCyclones(now: number = Date.now(), fetcher: typeof fetch = fetch): Promise<CycloneFeed> {
  const reasons: string[] = [];
  for (const source of SOURCES) {
    try {
      return await fetchFrom(source, now, fetcher);
    } catch (error) {
      const reason = failure(error, source);
      if (reason === null) throw error;
      reasons.push(reason);
    }
  }
  throw new CycloneSourceError(reasons.join("; "));
}

async function fetchFrom(source: OpenDataSource, now: number, fetcher: typeof fetch): Promise<CycloneFeed> {
  const file = await findTrackFile(now, fetcher, source);
  if (!file) return { run: null, storms: [] };
  for (const [url, entry] of kept) if (now - entry.at > KEEP_MS) kept.delete(url);
  let entry = kept.get(file.url);
  if (!entry) {
    entry = { at: now, feed: readTrackFile(file.url, file.run, source, fetcher) };
    kept.set(file.url, entry);
    // A failed read is tried again next time, not kept.
    entry.feed.catch(() => kept.delete(file.url));
  }
  return entry.feed;
}
