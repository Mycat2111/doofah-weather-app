/**
 * Server side of the storm alert routes the page and the service worker call:
 *
 * - `POST /api/push/subscribe`: turn alerts on, or send this phone's places,
 *   language and time zone again (the page does this when they change, and
 *   at least once a day so the record's 60 days start again).
 * - `PUT /api/push/subscribe`: the browser renewed the subscription (Firefox
 *   tells the service worker); the record moves to the new push address.
 * - `DELETE /api/push/subscribe`: turn alerts off; the record is deleted.
 * - `POST /api/push/test`: one test notification to this phone, at most once
 *   a minute.
 *
 * Only DooFah's own pages may call them (browsers say where a request comes
 * from), each visitor may write 30 times an hour per server instance, and
 * nothing is kept unless it passes the checks in subscription.ts.
 *
 * - `POST /api/push/send`: the storm alert job, called every 30 minutes by
 *   GitHub Actions (.github/workflows/storm-push.yml) with
 *   `Authorization: Bearer <CRON_SECRET>`, like the health check.
 *
 * Without the VAPID keys or Redis they all answer 503.
 */

import { MESSAGES } from "@/i18n/messages";
import type { CycloneFeed } from "@/lib/cyclones";
import { BufrError } from "../cyclones/bufr";
import { CycloneSourceError, fetchCyclones } from "../cyclones/openData";
import { allowed } from "../ops/auth";
import { reportAfterReply, type Report } from "../ops/report";
import { isGone, pushStatus, sendPush, sendStormAlerts, webPushSender, type Sender } from "./send";
import { redisStore, type PushStore } from "./store";
import { readRecord, readSubscription, subscriptionId } from "./subscription";
import { vapidFrom, type Vapid } from "./vapid";

/** Bigger than any real request: a subscription and 10 places are under 2 KB. */
const MAX_BODY = 8192;
const MAX_ENDPOINT = 1024;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 3_600_000;
/** A test push is worth nothing after a minute. */
const TEST_TTL_S = 60;

export interface PushDeps {
  store: PushStore | null;
  vapid: Vapid | null;
  now: () => number;
  report: Report;
  send: Sender;
  /** CRON_SECRET: the send job's callers must present it. */
  secret: string | undefined;
  /** ECMWF's active storms, as /api/cyclones reads them. */
  cyclones: (now: number, onFallback: (reason: string) => void) => Promise<CycloneFeed>;
}

export interface PushServer {
  subscribe(request: Request): Promise<Response>;
  test(request: Request): Promise<Response>;
  sendStorms(request: Request): Promise<Response>;
}

const reply = (status: number, body?: unknown) =>
  body === undefined
    ? new Response(null, { status, headers: { "Cache-Control": "no-store" } })
    : Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const refuse = (status: number, reason: string) => reply(status, { error: true, reason });

/**
 * A store error without the command it was running: Upstash's errors quote the
 * whole command, which would put a push address and places in logs and Discord.
 */
export const storeProblem = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split(", command was:")[0].slice(0, 200);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function pushServer(deps: Partial<PushDeps> = {}): PushServer {
  const { store, vapid, now, report, send, secret, cyclones }: PushDeps = {
    store: deps.store === undefined ? redisStore() : deps.store,
    vapid: deps.vapid === undefined ? vapidFrom() : deps.vapid,
    now: deps.now ?? Date.now,
    report: deps.report ?? reportAfterReply,
    send: deps.send ?? webPushSender,
    secret: "secret" in deps ? deps.secret : process.env.CRON_SECRET?.trim(),
    cyclones: deps.cyclones ?? ((at, onFallback) => fetchCyclones(at, fetch, onFallback)),
  };
  const visitors = new Map<string, number[]>();

  /** One more write for this visitor, or false when they have had their share this hour. */
  function allow(request: Request): boolean {
    const visitor = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const since = now() - RATE_WINDOW_MS;
    const recent = (visitors.get(visitor) ?? []).filter((t) => t > since);
    if (recent.length >= RATE_LIMIT) return false;
    recent.push(now());
    visitors.set(visitor, recent);
    if (visitors.size > 5000) for (const [key, times] of visitors) if (times.at(-1)! <= since) visitors.delete(key);
    return true;
  }

  /** The checks every route shares, then the JSON body, or the answer that stops here. */
  async function open(request: Request, api: string): Promise<{ body: unknown } | { stop: Response }> {
    if (!store || !vapid) return { stop: refuse(503, "Storm alerts are not set up") };
    // The page and the service worker are both same-origin; nobody else may write here.
    if (request.headers.get("sec-fetch-site") !== "same-origin")
      return { stop: refuse(403, "Only DooFah can use this") };
    if (!allow(request)) return { stop: refuse(429, "Too many requests, try again later") };
    if (Number(request.headers.get("content-length")) > MAX_BODY) return { stop: refuse(413, "Too large") };
    const text = await request.text();
    if (text.length > MAX_BODY) return { stop: refuse(413, "Too large") };
    try {
      return { body: JSON.parse(text) };
    } catch {
      return { stop: refuse(400, `${api}: not JSON`) };
    }
  }

  function failed(api: string, error: unknown): Response {
    const problem = storeProblem(error);
    report({ kind: "error", api, message: `500: ${problem}` });
    return refuse(500, "Storm alerts are unavailable, try again later");
  }

  return {
    async subscribe(request) {
      const api = "/api/push/subscribe";
      const opened = await open(request, api);
      if ("stop" in opened) return opened.stop;
      const { body } = opened;
      try {
        if (request.method === "POST") {
          const record = readRecord(body, now());
          if (typeof record === "string") return refuse(400, record);
          await store!.save(subscriptionId(record.subscription.endpoint), record);
          return reply(204);
        }
        if (request.method === "PUT") {
          if (!isObject(body)) return refuse(400, "Not JSON");
          const subscription = readSubscription(body.subscription);
          if (typeof subscription === "string") return refuse(400, subscription);
          const old = body.oldEndpoint;
          if (typeof old !== "string" || !old || old.length > MAX_ENDPOINT) return reply(204);
          // Nothing to move without the old record: the page sends everything again when it next opens.
          const oldId = subscriptionId(old);
          const record = await store!.get(oldId);
          if (!record) return reply(204);
          const newId = subscriptionId(subscription.endpoint);
          await store!.save(newId, { ...record, subscription, savedAt: new Date(now()).toISOString() });
          if (newId !== oldId) await store!.remove(oldId);
          return reply(204);
        }
        if (request.method === "DELETE") {
          if (!isObject(body) || typeof body.endpoint !== "string" || body.endpoint.length > MAX_ENDPOINT) {
            return refuse(400, "No push address");
          }
          await store!.remove(subscriptionId(body.endpoint));
          return reply(204);
        }
        return refuse(405, "Not allowed");
      } catch (error) {
        return failed(api, error);
      }
    },

    async test(request) {
      const api = "/api/push/test";
      const opened = await open(request, api);
      if ("stop" in opened) return opened.stop;
      const { body } = opened;
      if (!isObject(body) || typeof body.endpoint !== "string" || body.endpoint.length > MAX_ENDPOINT) {
        return refuse(400, "No push address");
      }
      const id = subscriptionId(body.endpoint);
      let record;
      try {
        record = await store!.get(id);
        if (!record) return refuse(404, "Storm alerts are not on for this device");
        if (!(await store!.claimTest(id))) return refuse(429, "One test a minute");
      } catch (error) {
        return failed(api, error);
      }
      const m = MESSAGES[record.lang];
      try {
        await sendPush(
          record.subscription,
          {
            title: m.push.testTitle,
            body: m.push.testBody,
            tag: "doofah-test",
            level: "warning",
            lang: record.lang,
            url: "/",
          },
          vapid!,
          { ttl: TEST_TTL_S, urgency: "high" },
          send,
        );
        return reply(204);
      } catch (error) {
        const status = pushStatus(error);
        if (isGone(status)) {
          // The browser dropped this subscription: forget it, and the page shows alerts as off.
          await store!.remove(id).catch(() => undefined);
          return refuse(410, "This device's subscription has ended");
        }
        report({ kind: "error", api, message: `502: the push service answered ${status || "nothing"}` });
        return refuse(502, "The push service did not take the test");
      }
    },

    async sendStorms(request) {
      const api = "/api/push/send";
      if (!allowed(request.headers.get("authorization"), secret)) return refuse(401, "Not allowed");
      if (!store || !vapid) return refuse(503, "Storm alerts are not set up");
      const started = now();
      try {
        // A run started by hand while the scheduled one is going would send the same alerts twice.
        if (!(await store.claimRun())) return refuse(409, "Already running");
      } catch (error) {
        return failed(api, error);
      }
      try {
        let feed: CycloneFeed;
        try {
          feed = await cyclones(started, (reason) => report({ kind: "fallback", api, message: reason }));
        } catch (error) {
          if (!(error instanceof CycloneSourceError || error instanceof BufrError)) throw error;
          // Both of ECMWF's sources failed: nothing is sent, and the next run tries again.
          report({ kind: "error", api, message: `502, ${error.message}` });
          return refuse(502, error.message);
        }
        const summary = await sendStormAlerts(feed, store, vapid, started, report, send);
        await store.setLastRun(started);
        return reply(200, { ok: true, run: feed.run, ...summary });
      } catch (error) {
        return failed(api, error);
      } finally {
        await store.releaseRun().catch(() => undefined);
      }
    },
  };
}
