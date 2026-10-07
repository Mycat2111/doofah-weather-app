/**
 * Server side of /api/health: asks each source the way the routes do, past
 * Vercel's edge cache (a cached answer would hide an outage), says how each
 * one is (and, once storm alerts are set up, when their job last ran), and
 * sends an alert when one isn't ok. Called every 15 minutes by
 * GitHub Actions (.github/workflows/health.yml), which tells Discord itself
 * when DooFah doesn't answer at all.
 *
 * Only a caller with `Authorization: Bearer <CRON_SECRET>` is answered, so no
 * one else can spend DooFah's free Open-Meteo calls.
 */

import type { CycloneFeed } from "@/lib/cyclones";
import { fetchCyclones } from "../cyclones/openData";
import type { UnifiedForecast } from "../forecast/types";
import { getUnifiedForecast } from "../forecast/unified";
import { wxStore, type WxSourceStatus } from "../wx/store";
import { redisStore } from "../push/store";
import { alertTargets, sendAlert } from "./alert";
import { allowed } from "./auth";
import { reportAfterReply, type Report } from "./report";

export type Status = "ok" | "degraded" | "down";

export interface Check {
  name: string;
  status: Status;
  /** How long it took, ms. */
  ms: number;
  detail: string;
}

/** What is checked; tests pass their own. */
export interface Probes {
  forecast: (now: number) => Promise<UnifiedForecast>;
  cyclones: (now: number, onFallback: (reason: string) => void) => Promise<CycloneFeed>;
  /** The v2 forecast store's runs (wx_status); absent while Supabase isn't set up. */
  forecastStore?: () => Promise<WxSourceStatus[]>;
  /** When the storm alert job last finished (null before its first run); absent while push isn't set up. */
  pushRun?: () => Promise<number | null>;
}

/** A place in Thailand, so both models are checked: Bangkok. */
const PROBE = { lat: 13.75, lon: 100.5 };
/** ECMWF's 15 days are 360 hours; fewer than this means its run came back short. */
const MIN_HOURS = 300;
/** A check that hasn't answered in this long is down, so the route answers before Vercel stops it (maxDuration). */
export const CHECK_TIMEOUT_MS = 40_000;
/**
 * ECMWF runs every 6 hours and reaches Open-Meteo about 7 hours after it starts, so the newest run is
 * 7 to 13 hours old while the ingest job keeps up; older than this, it has missed at least one run.
 */
export const WX_STALE_MS = 18 * 3_600_000;
/** The storm alert job runs every 30 minutes; this long without a run means its schedule stopped. */
export const PUSH_STALE_MS = 2 * 3_600_000;

const forecastStore = wxStore();
const pushStore = redisStore();

const defaultProbes: Probes = {
  // About 2 Open-Meteo calls and 1 TMD call: 192 of the 10,000 free calls a day at every 15 minutes.
  forecast: (now) => getUnifiedForecast(PROBE.lat, PROBE.lon, now),
  cyclones: (now, onFallback) => fetchCyclones(now, fetch, onFallback),
  forecastStore: forecastStore ? () => forecastStore.status() : undefined,
  pushRun: pushStore ? () => pushStore.lastRun() : undefined,
};

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function timed(
  name: string,
  run: () => Promise<{ status: Status; detail: string }>,
  timeoutMs: number,
): Promise<Check> {
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${timeoutMs / 1000} s`)), timeoutMs);
  });
  try {
    return { name, ...(await Promise.race([run(), late])), ms: Date.now() - start };
  } catch (error) {
    return { name, status: "down", detail: reasonOf(error), ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

/** Each source's state: ok, degraded (it answered, but not fully or not from the first source) or down. */
export function runChecks(
  now: number = Date.now(),
  probes: Probes = defaultProbes,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<Check[]> {
  const { pushRun } = probes;
  return Promise.all([
    timed(
      "Forecast (ECMWF + WRF, Bangkok)",
      async () => {
        const f = await probes.forecast(now);
        if (f.hours.length < MIN_HOURS)
          return { status: "degraded", detail: `ECMWF sent only ${f.hours.length} hours` };
        if (f.wrf_missing) {
          return { status: "degraded", detail: `ECMWF ok; WRF missing: ${f.wrf_reason ?? f.wrf_missing}` };
        }
        return { status: "ok", detail: `ECMWF and WRF, ${f.days.length} days` };
      },
      timeoutMs,
    ),
    timed(
      "Cyclone tracks (ECMWF open data)",
      async () => {
        const fellBack: string[] = [];
        const feed = await probes.cyclones(now, (reason) => fellBack.push(reason));
        const detail = `${feed.storms.length} storms, run ${feed.run ?? "none found"}`;
        return fellBack.length ? { status: "degraded", detail: `${detail}; ${fellBack[0]}` } : { status: "ok", detail };
      },
      timeoutMs,
    ),
    ...(probes.forecastStore ? [forecastStoreCheck(now, probes.forecastStore, timeoutMs)] : []),
    // GitHub pauses a public repo's schedules after 60 days without commits; this says so before anyone misses an alert.
    ...(pushRun
      ? [
          timed(
            "Storm alerts (push job)",
            async () => {
              const last = await pushRun();
              if (last === null) return { status: "ok" as const, detail: "no run yet" };
              const minutes = Math.round((now - last) / 60_000);
              return now - last > PUSH_STALE_MS
                ? { status: "degraded" as const, detail: `last ran ${minutes} min ago; is its schedule paused?` }
                : { status: "ok" as const, detail: `last ran ${minutes} min ago` };
            },
            timeoutMs,
          ),
        ]
      : []),
  ]);
}

/** v2's forecast store: the newest ECMWF run users see, and whether the ingest job (pipeline/) keeps it fresh. */
function forecastStoreCheck(now: number, status: () => Promise<WxSourceStatus[]>, timeoutMs: number) {
  return timed(
    "Forecast store (v2, ECMWF 9 km)",
    async () => {
      const ecmwf = (await status()).find((s) => s.source === "ecmwf_hres");
      if (!ecmwf?.ready) {
        const why = ecmwf?.newest?.error ? `; the last try failed: ${ecmwf.newest.error}` : "";
        return { status: "degraded" as const, detail: `no ECMWF run loaded yet${why}` };
      }
      const { runTime, steps } = ecmwf.ready;
      const hours = Math.round(((now - Date.parse(runTime)) / 3_600_000) * 10) / 10;
      const detail = `run ${runTime.slice(0, 16).replace("T", " ")} (+07), ${hours} h old, ${steps} steps`;
      if (ecmwf.newest && ecmwf.newest.status === "failed") {
        const error = ecmwf.newest.error ?? "no reason saved";
        return { status: "degraded" as const, detail: `${detail}; the next run failed to load: ${error}` };
      }
      if (now - Date.parse(runTime) > WX_STALE_MS) {
        return { status: "degraded" as const, detail: `${detail}; is the ECMWF ingest workflow running?` };
      }
      return { status: "ok" as const, detail };
    },
    timeoutMs,
  );
}

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * 200 when every source is ok or degraded, 503 when one is down, with each
 * check's state; anything but ok sends an alert. `?test` only sends a test
 * alert, to show the channel works.
 */
export async function healthResponse(
  request: Request,
  env: Record<string, string | undefined> = process.env,
  probes: Probes = defaultProbes,
  now: number = Date.now(),
  report: Report = reportAfterReply,
): Promise<Response> {
  if (!allowed(request.headers.get("authorization"), env.CRON_SECRET?.trim())) {
    return reply({ error: true, reason: "Not allowed" }, 401);
  }
  if (new URL(request.url).searchParams.has("test")) {
    const sent = await sendAlert(
      { kind: "health", api: "/api/health?test", message: "Test alert: DooFah can reach this channel." },
      alertTargets(env),
      now,
    );
    return reply({ test: sent });
  }

  const checks = await runChecks(now, probes);
  const bad = checks.filter((c) => c.status !== "ok");
  if (bad.length) {
    const message = bad.map((c) => `${c.status.toUpperCase()} ${c.name}: ${c.detail}`).join("\n");
    report({ kind: "health", api: "/api/health", message });
  }
  const down = checks.some((c) => c.status === "down");
  return reply({ ok: !down, checked_at: new Date(now).toISOString(), checks }, down ? 503 : 200);
}
