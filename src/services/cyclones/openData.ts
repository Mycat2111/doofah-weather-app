/**
 * Finds and reads the newest tropical cyclone track file on ECMWF's open
 * data portal (data.ecmwf.int, CC BY 4.0).
 *
 * The ensemble runs four times a day. A run's files land together about
 * 7.5 hours after it starts, and its tracks a minute later, as a file like
 * 20261002000000-360h-enfo-tf.bufr (144h for the 06 and 18 UTC runs). The
 * newest run whose folder lists one is used, looking back one run for that
 * minute. When two runs in a row have none, there are no storms to follow,
 * and an older run's storms would be out of date.
 */

import type { CycloneFeed } from "@/lib/cyclones";
import { cyclonesFromBufr } from "./ecmwfTracks";

export const OPEN_DATA_URL = "https://data.ecmwf.int/forecasts";
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

/** The folder of the ensemble run starting at `run` (ms). */
export function runFolder(run: number): string {
  const d = new Date(run);
  const day = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  return `${OPEN_DATA_URL}/${day}/${pad(d.getUTCHours())}z/ifs/0p25/enfo/`;
}

/** The track file named in a run folder's listing, for that run. */
export function trackFileIn(listing: string, run: number): string | null {
  const d = new Date(run);
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}0000`;
  const match = listing.match(new RegExp(`${stamp}-\\d+h-enfo-tf\\.bufr`));
  return match ? match[0] : null;
}

export const latestRun = (now: number) => Math.floor(now / RUN_MS) * RUN_MS;

async function get(url: string, fetcher: typeof fetch): Promise<Response> {
  try {
    return await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new CycloneSourceError(`ECMWF could not be reached (${(error as Error).message})`);
  }
}

/** The newest run with tracks: its start (ms) and file; null when the two newest runs have none. */
export async function findTrackFile(now: number, fetcher: typeof fetch): Promise<{ run: number; url: string } | null> {
  let found = 0;
  for (let k = 0; k < RUNS_LOOKED_AT; k++) {
    const run = latestRun(now) - k * RUN_MS;
    const folder = runFolder(run);
    const res = await get(folder, fetcher);
    // Not there yet (the run being made, or a gap on the portal).
    if (res.status === 404) continue;
    if (!res.ok) throw new CycloneSourceError(`ECMWF answered ${res.status} for ${folder}`);
    found += 1;
    const file = trackFileIn(await res.text(), run);
    if (file) return { run, url: folder + file };
    if (found === 2) return null;
  }
  if (found === 0) throw new CycloneSourceError("No ECMWF run of the last day could be found");
  return null;
}

const kept = new Map<string, { at: number; feed: Promise<CycloneFeed> }>();

async function readTrackFile(url: string, run: number, fetcher: typeof fetch): Promise<CycloneFeed> {
  const res = await get(url, fetcher);
  if (!res.ok) throw new CycloneSourceError(`ECMWF answered ${res.status} for ${url}`);
  const { run: inFile, storms } = cyclonesFromBufr(new Uint8Array(await res.arrayBuffer()));
  return { run: inFile ?? new Date(run).toISOString(), storms };
}

/** The storms of the newest ECMWF run with tracks. */
export async function fetchCyclones(now: number = Date.now(), fetcher: typeof fetch = fetch): Promise<CycloneFeed> {
  const file = await findTrackFile(now, fetcher);
  if (!file) return { run: null, storms: [] };
  for (const [url, entry] of kept) if (now - entry.at > KEEP_MS) kept.delete(url);
  let entry = kept.get(file.url);
  if (!entry) {
    entry = { at: now, feed: readTrackFile(file.url, file.run, fetcher) };
    kept.set(file.url, entry);
    // A failed read is tried again next time, not kept.
    entry.feed.catch(() => kept.delete(file.url));
  }
  return entry.feed;
}
