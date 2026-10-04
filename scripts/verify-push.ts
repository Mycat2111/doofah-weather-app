/**
 * Checks for storm alerts by Web Push (post-launch step 3, parts A and B): the
 * VAPID settings, what a subscription must look like before it is kept, the
 * link a notification opens, the Upstash Redis store (against a stand-in for
 * Upstash's REST API), the service worker's push, tap and renewal handlers
 * (run in a stand-in worker), the subscribe and test routes (with an
 * in-memory store and a stand-in push service), what the phone sends, and
 * the storm alert job (with made-up storms). Needs no network and sends
 * nothing. Run with: npm run verify:push
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { runInNewContext } from "node:vm";
import { Redis } from "@upstash/redis";
import webpush, { WebPushError, type RequestOptions } from "web-push";
import { createFormatters } from "../src/i18n/format";
import { MESSAGES } from "../src/i18n/messages";
import { cycloneAlerts, type CycloneAlert, type CycloneFeed } from "../src/lib/cyclones";
import * as phone from "../src/lib/push";
import { placeRef, readStormLink, stormLink } from "../src/lib/pushLink";
import { CycloneSourceError } from "../src/services/cyclones/openData";
import type { Alert } from "../src/services/ops/alert";
import { pushServer, storeProblem, type PushDeps } from "../src/services/push/http";
import { stormMessage } from "../src/services/push/message";
import { topicOf, type Sender } from "../src/services/push/send";
import {
  RECORD_TTL_S,
  RUN_LOCK_S,
  SENT_TTL_S,
  TEST_GAP_S,
  redisStore,
  storeOn,
  type PushStore,
  type StormLevel,
} from "../src/services/push/store";
import {
  MAX_NAME_LENGTH,
  MAX_PLACES,
  isPushServiceUrl,
  readRecord,
  readSubscription,
  subscriptionId,
  type PushRecord,
  type SavedSubscription,
} from "../src/services/push/subscription";
import { vapidFrom, type Vapid } from "../src/services/push/vapid";

const NOW = Date.UTC(2026, 9, 4, 15, 0);

let checks = 0;
const check = (name: string, fn: () => void | Promise<void>) => ({ name, fn });

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/dXJ-abc123:APA91bH";
// Shaped like a browser's: a 65-byte key and a 16-byte secret, base64url.
const KEYS = {
  p256dh: Buffer.alloc(65, 4).toString("base64url"),
  auth: Buffer.alloc(16, 7).toString("base64url"),
};
const body = (change: Record<string, unknown> = {}) => ({
  subscription: { endpoint: ENDPOINT, expirationTime: null, keys: KEYS },
  places: [
    { ref: "0a1b2c3d", name: "Home", lat: 13.8, lon: 100.5 },
    { ref: "9f8e7d6c", name: "Chiang Mai", lat: 18.8, lon: 99 },
  ],
  lang: "th",
  timeZone: "Asia/Bangkok",
  ...change,
});

/* ------------------------------------------------------------------ */
/* A stand-in for Upstash's REST API                                   */
/* ------------------------------------------------------------------ */

type Value = string | Set<string> | Map<string, string>;

/** Just the Redis commands the store uses, kept in memory; `ttl` records each EX / EXPIRE. */
async function fakeUpstash() {
  const data = new Map<string, Value>();
  const ttl = new Map<string, number>();
  const commands: string[][] = [];
  const set = (key: string) => (data.get(key) as Set<string>) ?? new Set<string>();
  const hash = (key: string) => (data.get(key) as Map<string, string>) ?? new Map<string, string>();

  const run = ([name, ...args]: string[]): unknown => {
    commands.push([name, ...args]);
    switch (name.toLowerCase()) {
      case "set": {
        if (args.some((a) => a.toLowerCase() === "nx") && data.has(args[0])) return null;
        data.set(args[0], args[1]);
        const ex = args.findIndex((a) => a.toLowerCase() === "ex");
        if (ex >= 0) ttl.set(args[0], Number(args[ex + 1]));
        else ttl.delete(args[0]);
        return "OK";
      }
      case "get":
        return (data.get(args[0]) as string | undefined) ?? null;
      case "mget":
        return args.map((k) => (data.get(k) as string | undefined) ?? null);
      case "del":
        return args.filter((k) => data.delete(k)).length;
      case "sadd": {
        const s = set(args[0]);
        const before = s.size;
        args.slice(1).forEach((m) => s.add(m));
        data.set(args[0], s);
        return s.size - before;
      }
      case "srem": {
        const s = set(args[0]);
        return args.slice(1).filter((m) => s.delete(m)).length;
      }
      case "smembers":
        return [...set(args[0])];
      case "hset": {
        const h = hash(args[0]);
        let added = 0;
        for (let i = 1; i < args.length; i += 2) {
          if (!h.has(args[i])) added++;
          h.set(args[i], args[i + 1]);
        }
        data.set(args[0], h);
        return added;
      }
      case "hgetall":
        return [...hash(args[0])].flat();
      case "expire":
        if (!data.has(args[0])) return 0;
        ttl.set(args[0], Number(args[1]));
        return 1;
      default:
        throw new Error(`The stand-in doesn't know ${name}`);
    }
  };
  // Upstash answers base64 when asked (the client asks by default).
  const encode = (value: unknown, base64: boolean): unknown =>
    !base64 || typeof value !== "string" || value === "OK"
      ? Array.isArray(value)
        ? value.map((v) => encode(v, base64))
        : value
      : Buffer.from(value).toString("base64");

  const server: Server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const base64 = req.headers["upstash-encoding"] === "base64";
    const auth = req.headers.authorization === "Bearer test-token";
    res.setHeader("Content-Type", "application/json");
    if (!auth) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const parsed = JSON.parse(text) as unknown[];
    const stringify = (parts: unknown[]) => parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p)));
    if (req.url === "/pipeline") {
      res.end(JSON.stringify((parsed as unknown[][]).map((c) => ({ result: encode(run(stringify(c)), base64) }))));
    } else {
      res.end(JSON.stringify({ result: encode(run(stringify(parsed)), base64) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, data, ttl, commands, close: () => new Promise((resolve) => server.close(resolve)) };
}

/* ------------------------------------------------------------------ */
/* A stand-in service worker                                           */
/* ------------------------------------------------------------------ */

const ORIGIN = "https://doofah.example";

interface FakeClient {
  url: string;
  focused: boolean;
  navigatedTo: string | null;
  focus(): Promise<FakeClient>;
  navigate(url: string): Promise<FakeClient>;
}

/** Loads public/sw.js with a fake `self`, and dispatches events to it. */
async function worker(open: FakeClient[] = []) {
  const source = await readFile("public/sw.js", "utf8");
  const handlers = new Map<string, (event: unknown) => void>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const posted: { url: string; method?: string; body: unknown }[] = [];
  const resubscribed: unknown[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn),
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }),
      pushManager: {
        subscribe: async (options: unknown) => {
          resubscribed.push(options);
          return { endpoint: `${ENDPOINT}-renewed`, toJSON: () => ({ endpoint: `${ENDPOINT}-renewed`, keys: KEYS }) };
        },
      },
    },
    clients: {
      matchAll: async () => open,
      openWindow: async (url: string) => void opened.push(url),
    },
  };
  const fetcher = async (url: string, init: RequestInit) => {
    posted.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 204 });
  };
  runInNewContext(source, { self, URL, fetch: fetcher, caches: {}, setTimeout, console });

  async function dispatch(type: string, fields: Record<string, unknown>) {
    const waits: Promise<unknown>[] = [];
    handlers.get(type)!({ ...fields, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }
  return { dispatch, shown, opened, posted, resubscribed };
}

const client = (url: string): FakeClient => ({
  url,
  focused: false,
  navigatedTo: null,
  async focus() {
    this.focused = true;
    return this;
  },
  async navigate(to: string) {
    this.navigatedTo = to;
    return this;
  },
});

/** Objects made inside the worker have its own Object prototype; compare them as data. */
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

const pushData = (value: unknown) => ({
  json: () => (typeof value === "string" ? JSON.parse(value) : value),
  text: () => (typeof value === "string" ? value : JSON.stringify(value)),
});

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* The routes, with an in-memory store and a stand-in push service     */
/* ------------------------------------------------------------------ */

const VAPID: Vapid = { subject: "https://doofah.example", ...webpush.generateVAPIDKeys() };

interface MemoryStore extends PushStore {
  records: Map<string, PushRecord>;
  marked: Map<string, Record<string, StormLevel>>;
  /** How often the phones were listed, removed, and how often sends were marked. */
  counts: { all: number; remove: number; markSent: number };
  state: { last: number | null; running: boolean };
}

function memoryStore(): MemoryStore {
  const records = new Map<string, PushRecord>();
  const marked = new Map<string, Record<string, StormLevel>>();
  const tests = new Set<string>();
  const counts = { all: 0, remove: 0, markSent: 0 };
  const state = { last: null as number | null, running: false };
  return {
    records,
    marked,
    counts,
    state,
    async save(id, record) {
      records.set(id, plain(record));
    },
    async get(id) {
      return records.get(id) ?? null;
    },
    async remove(id) {
      counts.remove++;
      records.delete(id);
    },
    async all() {
      counts.all++;
      return [...records];
    },
    async sent(stormId) {
      return { ...marked.get(stormId) };
    },
    async markSent(stormId, levels) {
      counts.markSent++;
      marked.set(stormId, { ...marked.get(stormId), ...levels });
    },
    async lastRun() {
      return state.last;
    },
    async setLastRun(time) {
      state.last = time;
    },
    async claimTest(id) {
      if (tests.has(id)) return false;
      tests.add(id);
      return true;
    },
    async claimRun() {
      if (state.running) return false;
      state.running = true;
      return true;
    },
    async releaseRun() {
      state.running = false;
    },
  };
}

interface Sent {
  subscription: SavedSubscription;
  payload: Record<string, unknown>;
  options: RequestOptions;
}

const SECRET = "cron-secret";

/**
 * A push server on a memory store; `sent` collects pushes, `failWith` makes
 * the push service refuse them (`failFor` for one push address), and
 * `world.feed` is what ECMWF has (`world.error` when it can't be reached).
 */
function routes(change: Partial<PushDeps> = {}) {
  const store = memoryStore();
  const sent: Sent[] = [];
  const alerts: Alert[] = [];
  const clock = { now: NOW };
  const push = {
    failWith: null as Error | null,
    failFor: new Map<string, Error>(),
    tried: 0,
    inFlight: 0,
    mostInFlight: 0,
  };
  const world = { feed: { run: null, storms: [] } as CycloneFeed, error: null as Error | null };
  const send: Sender = async (subscription, payload, options) => {
    push.tried++;
    push.inFlight++;
    push.mostInFlight = Math.max(push.mostInFlight, push.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    push.inFlight--;
    const fail = push.failFor.get(subscription.endpoint) ?? push.failWith;
    if (fail) throw fail;
    sent.push({ subscription, payload: JSON.parse(payload), options });
  };
  const server = pushServer({
    store,
    vapid: VAPID,
    now: () => clock.now,
    report: (alert) => alerts.push(alert),
    send,
    secret: SECRET,
    cyclones: async () => {
      if (world.error) throw world.error;
      return world.feed;
    },
    ...change,
  });
  return { server, store, sent, alerts, clock, push, world };
}

/* ------------------------------------------------------------------ */
/* Made-up storms for the send job                                     */
/* ------------------------------------------------------------------ */

const HOUR = 3_600_000;
/** About 20 km/h at 15°N. */
const DEG_PER_HOUR = 0.186;

/**
 * A typhoon heading due west along 15°N from 114.5°E at `start`: it comes
 * within 500 km of (14°N, 100°E) about 54 hours later (a warning until then,
 * severe from 6 hours before), closest (110 km) about 78 hours later. No
 * ensemble members, so no chance is given.
 */
function westward(start = NOW, id = "27W"): CycloneFeed {
  const track = Array.from({ length: 25 }, (_, i) => ({
    time: new Date(start + i * 6 * HOUR).toISOString(),
    lat: 15,
    lon: 114.5 - i * 6 * DEG_PER_HOUR,
    pressure_hpa: 960,
    wind_kmh: 150,
  }));
  return {
    run: new Date(start).toISOString(),
    storms: [{ id, name: "IN-FA", basin: "typhoon", track, track_from: "hres", cone: [], members: [] }],
  };
}

const APPLE_ENDPOINT = "https://web.push.apple.com/QGxJ5example";

/** Saves a phone with alerts on: its places, language and time zone. */
async function savePhone(
  store: PushStore,
  endpoint: string,
  places: { ref: string; name: string; lat: number; lon: number }[],
  lang = "th",
  timeZone = "Asia/Bangkok",
) {
  const record = readRecord(body({ subscription: { endpoint, keys: KEYS }, places, lang, timeZone }), NOW);
  assert.notEqual(typeof record, "string", String(record));
  await store.save(subscriptionId(endpoint), record as PushRecord);
  return subscriptionId(endpoint);
}

const HOME = { ref: "0a1b2c3d", name: "บ้าน", lat: 14, lon: 100 };
const FAR = { ref: "9f8e7d6c", name: "Hat Yai", lat: 7, lon: 100.5 };
const job = (token = SECRET) =>
  new Request(`${ORIGIN}/api/push/send`, { method: "POST", headers: { authorization: `Bearer ${token}` } });

/** A request as DooFah's own page sends it; `headers` can take the same-site header away. */
function call(method: string, path: string, json: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
    body: typeof json === "string" ? json : JSON.stringify(json),
  });
}

const subscribe = (method: string, json: unknown, headers?: Record<string, string>) =>
  call(method, "/api/push/subscribe", json, headers);
const test = (endpoint: string, headers?: Record<string, string>) =>
  call("POST", "/api/push/test", { endpoint }, headers);

async function answer(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const NEW_ENDPOINT = "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABnew";

/** A fake localStorage for the phone side's "Not now". */
function withStorage<T>(fn: () => T): T {
  const items = new Map<string, string>();
  const g = globalThis as { window?: unknown };
  g.window = {
    localStorage: {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    },
  };
  try {
    return fn();
  } finally {
    delete g.window;
  }
}

const CHECKS = [
  check("VAPID: all three settings are needed, and the subject must be https: or mailto:", () => {
    const env = {
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: " pub ",
      VAPID_PRIVATE_KEY: "priv",
      VAPID_SUBJECT: "https://x.example",
    };
    assert.deepEqual(vapidFrom(env), { subject: "https://x.example", publicKey: "pub", privateKey: "priv" });
    assert.equal(vapidFrom({ ...env, VAPID_PRIVATE_KEY: "" }), null);
    assert.equal(vapidFrom({ ...env, NEXT_PUBLIC_VAPID_PUBLIC_KEY: undefined }), null);
    assert.equal(vapidFrom({ ...env, VAPID_SUBJECT: "doofah.example" }), null);
    assert.equal(vapidFrom({ ...env, VAPID_SUBJECT: "<mailto:me@doofah.example>" }), null);
    assert.ok(vapidFrom({ ...env, VAPID_SUBJECT: "mailto:alerts@doofah.example" }));
  }),

  check("Push addresses: only Google's, Mozilla's, Apple's and Microsoft's push services, over https", () => {
    for (const ok of [
      ENDPOINT,
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB",
      "https://web.push.apple.com/QGuQyavXutnMH",
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB",
    ]) {
      assert.ok(isPushServiceUrl(ok), ok);
    }
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://fcm.googleapis.com.evil.example/fcm/send/x",
      "https://evilpush.apple.com.example/x",
      "https://fcm.googleapis.com:8443/fcm/send/x",
      "https://user:pass@fcm.googleapis.com/fcm/send/x",
      "https://permanently-removed.invalid/fcm/send/x",
      "https://127.0.0.1/x",
      "not a url",
    ]) {
      assert.ok(!isPushServiceUrl(bad), bad);
    }
  }),

  check("Subscriptions: kept with the keys only, refused without a push address or with malformed keys", () => {
    assert.deepEqual(readSubscription({ endpoint: ENDPOINT, expirationTime: null, keys: KEYS }), {
      endpoint: ENDPOINT,
      keys: KEYS,
    });
    assert.equal(readSubscription({ endpoint: "https://evil.example/x", keys: KEYS }), "Not a push service address");
    assert.equal(
      readSubscription({ endpoint: `${ENDPOINT}${"x".repeat(1100)}`, keys: KEYS }),
      "Not a push service address",
    );
    assert.equal(readSubscription({ endpoint: ENDPOINT }), "No keys");
    assert.equal(readSubscription({ endpoint: ENDPOINT, keys: { ...KEYS, auth: "short" } }), "Malformed keys");
    assert.equal(readSubscription({ endpoint: ENDPOINT, keys: { ...KEYS, p256dh: "<script>" } }), "Malformed keys");
    assert.equal(readSubscription(null), "No subscription");
  }),

  check("Records: places, language and time zone checked; the time saved is the server's", () => {
    const record = readRecord(body(), NOW) as PushRecord;
    assert.equal(typeof record, "object");
    assert.equal(record.subscription.endpoint, ENDPOINT);
    assert.deepEqual(
      record.places.map((p) => p.name),
      ["Home", "Chiang Mai"],
    );
    assert.equal(record.lang, "th");
    assert.equal(record.savedAt, "2026-10-04T15:00:00.000Z");
    // Whatever the phone says, the time saved is the server's.
    assert.equal((readRecord(body({ savedAt: "2001-01-01" }), NOW) as PushRecord).savedAt, record.savedAt);

    const place = { ref: "0a1b2c3d", name: "Home", lat: 13.8, lon: 100.5 };
    assert.equal(readRecord(body({ places: [] }), NOW), "Between 1 and 10 places");
    assert.equal(readRecord(body({ places: Array(11).fill(place) }), NOW), "Between 1 and 10 places");
    assert.equal(
      readRecord(body({ places: [{ ...place, lat: 13.7563 }] }), NOW),
      "Coordinates must be rounded to 0.1°",
    );
    assert.equal(readRecord(body({ places: [{ ...place, lon: 181 }] }), NOW), "Bad coordinates");
    assert.equal(readRecord(body({ places: [{ ...place, ref: "pt@13.756,100.502" }] }), NOW), "Bad place ref");
    assert.equal(readRecord(body({ places: [{ ...place, name: "x".repeat(41) }] }), NOW), "Bad place name");
    assert.equal(readRecord(body({ places: [{ ...place, name: "  " }] }), NOW), "Bad place name");
    assert.equal(readRecord(body({ lang: "fr" }), NOW), "Unknown language");
    assert.equal(readRecord(body({ timeZone: "Mars/Olympus" }), NOW), "Unknown time zone");
    assert.equal(readRecord("[]", NOW), "Not JSON");
  }),

  check("Record ids: SHA-256 of the push address, so the same phone always lands on its own record", () => {
    assert.equal(subscriptionId(ENDPOINT), createHash("sha256").update(ENDPOINT).digest("hex"));
    assert.match(subscriptionId(ENDPOINT), /^[0-9a-f]{64}$/);
    assert.notEqual(subscriptionId(ENDPOINT), subscriptionId(`${ENDPOINT}x`));
  }),

  check("Notification links: storm id and a hashed place, never the place's own id", async () => {
    const id = "pt@13.756,100.502";
    const ref = await placeRef(id);
    assert.equal(ref, createHash("sha256").update(id).digest("hex").slice(0, 8));
    assert.equal(stormLink("27W", ref), `/?storm=27W&place=${ref}`);
    assert.equal(stormLink("27W", null), "/?storm=27W");
    assert.ok(!stormLink("27W", ref).includes("13.756"));
    assert.deepEqual(readStormLink("27W", ref), { stormId: "27W", placeRef: ref });
    assert.deepEqual(readStormLink("27W", "pt@13.756"), { stormId: "27W", placeRef: null });
    assert.deepEqual(readStormLink("27W", ["a", "b"]), { stormId: "27W", placeRef: null });
    assert.equal(readStormLink("<script>", ref), undefined);
    assert.equal(readStormLink(undefined, ref), undefined);
  }),

  check("Store: not set up without Redis settings; reads Vercel's KV_ names and Upstash's own", () => {
    assert.equal(redisStore({}), null);
    assert.equal(redisStore({ KV_REST_API_URL: "https://x.upstash.io" }), null);
    assert.ok(redisStore({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" }));
    assert.ok(redisStore({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" }));
  }),

  check("Store: save, read, list and remove records, each kept 60 days", async () => {
    const upstash = await fakeUpstash();
    try {
      const store = storeOn(new Redis({ url: upstash.url, token: "test-token", enableTelemetry: false }));
      const record = readRecord(body(), NOW) as PushRecord;
      const id = subscriptionId(ENDPOINT);
      await store.save(id, record);
      assert.equal(upstash.ttl.get(`push:sub:${id}`), RECORD_TTL_S);
      assert.deepEqual(await store.get(id), record);
      assert.deepEqual(await store.all(), [[id, record]]);
      assert.equal(await store.get("nobody"), null);

      await store.remove(id);
      assert.equal(await store.get(id), null);
      assert.deepEqual(await store.all(), []);
      assert.ok(!(upstash.data.get("push:subs") as Set<string>).has(id));
    } finally {
      await upstash.close();
    }
  }),

  check("Store: listing drops records that expired, and reads 100 at a time", async () => {
    const upstash = await fakeUpstash();
    try {
      const store = storeOn(new Redis({ url: upstash.url, token: "test-token", enableTelemetry: false }));
      const record = readRecord(body(), NOW) as PushRecord;
      const ids = Array.from({ length: 205 }, (_, i) => `phone-${i}`);
      for (const id of ids) await store.save(id, record);
      // Two records reach their 60 days.
      upstash.data.delete("push:sub:phone-3");
      upstash.data.delete("push:sub:phone-150");
      upstash.commands.length = 0;
      const all = await store.all();
      assert.equal(all.length, 203);
      assert.equal(upstash.commands.filter(([c]) => c === "mget").length, 3);
      assert.ok(upstash.commands.filter(([c]) => c === "mget").every((c) => c.length - 1 <= 100));
      const index = upstash.data.get("push:subs") as Set<string>;
      assert.ok(!index.has("phone-3") && !index.has("phone-150"));
      assert.equal(index.size, 203);
    } finally {
      await upstash.close();
    }
  }),

  check("Store: storms already sent, per phone, kept 21 days; and the send job's last run", async () => {
    const upstash = await fakeUpstash();
    try {
      const store = storeOn(new Redis({ url: upstash.url, token: "test-token", enableTelemetry: false }));
      assert.deepEqual(await store.sent("27W"), {});
      await store.markSent("27W", { a: "warning", b: "severe" });
      await store.markSent("27W", { a: "severe" });
      assert.deepEqual(await store.sent("27W"), { a: "severe", b: "severe" });
      assert.equal(upstash.ttl.get("push:sent:27W"), SENT_TTL_S);
      upstash.commands.length = 0;
      await store.markSent("28W", {});
      assert.equal(upstash.commands.length, 0);

      assert.equal(await store.lastRun(), null);
      await store.setLastRun(NOW);
      assert.equal(await store.lastRun(), NOW);
    } finally {
      await upstash.close();
    }
  }),

  check("Service worker: a push shows DooFah's notification, one per storm, severe ones stay up", async () => {
    const sw = await worker();
    const message = {
      title: "ไต้ฝุ่น KONG-REY อาจเคลื่อนผ่านห่างจากบ้านราว 320 กม.",
      body: "ใกล้ที่สุดพรุ่งนี้ 14:00 น.",
      tag: "storm-27W",
      level: "severe",
      lang: "th",
      url: "/?storm=27W&place=0a1b2c3d",
    };
    await sw.dispatch("push", { data: pushData(message) });
    assert.equal(sw.shown.length, 1);
    const [{ title, options }] = sw.shown;
    assert.equal(title, message.title);
    assert.equal(options.body, message.body);
    assert.equal(options.tag, "storm-27W");
    assert.equal(options.renotify, true);
    assert.equal(options.requireInteraction, true);
    assert.equal(options.lang, "th");
    assert.equal(options.icon, "/icons/icon-192.png");
    assert.equal(options.badge, "/icons/badge-96.png");
    assert.deepEqual(plain(options.data), { url: message.url });

    await sw.dispatch("push", { data: pushData({ ...message, level: "warning" }) });
    assert.equal(sw.shown[1].options.requireInteraction, false);
  }),

  check("Service worker: a push that isn't JSON, or is empty, still shows something", async () => {
    const sw = await worker();
    await sw.dispatch("push", { data: pushData("Test push message from DevTools.") });
    assert.equal(sw.shown[0].title, "DooFah");
    assert.equal(sw.shown[0].options.body, "Test push message from DevTools.");
    assert.equal(sw.shown[0].options.renotify, false);
    await sw.dispatch("push", { data: null });
    assert.equal(sw.shown[1].title, "DooFah");
    assert.deepEqual(plain(sw.shown[1].options.data), { url: "/" });
  }),

  check("Service worker: a tap brings an open DooFah forward on the storm, or opens one", async () => {
    const tab = client(`${ORIGIN}/`);
    const other = client("https://elsewhere.example/");
    const sw = await worker([other, tab]);
    let closed = false;
    const notification = (url: string) => ({ data: { url }, close: () => (closed = true) });
    await sw.dispatch("notificationclick", { notification: notification("/?storm=27W&place=0a1b2c3d") });
    assert.ok(closed);
    assert.ok(tab.focused);
    assert.equal(tab.navigatedTo, `${ORIGIN}/?storm=27W&place=0a1b2c3d`);
    assert.ok(!other.focused);
    assert.deepEqual(sw.opened, []);

    const closedApp = await worker([]);
    await closedApp.dispatch("notificationclick", { notification: notification("/?storm=27W") });
    assert.deepEqual(closedApp.opened, [`${ORIGIN}/?storm=27W`]);

    // A link to another site opens DooFah's home page instead.
    const elsewhere = await worker([]);
    await elsewhere.dispatch("notificationclick", { notification: notification("https://evil.example/") });
    assert.deepEqual(elsewhere.opened, [`${ORIGIN}/`]);
  }),

  check("Service worker: a renewed subscription is sent to DooFah with the old address", async () => {
    const sw = await worker();
    const old = { endpoint: ENDPOINT, options: { userVisibleOnly: true, applicationServerKey: new ArrayBuffer(65) } };
    await sw.dispatch("pushsubscriptionchange", { oldSubscription: old, newSubscription: null });
    assert.deepEqual(sw.resubscribed, [old.options]);
    assert.deepEqual(sw.posted, [
      {
        url: "/api/push/subscribe",
        method: "PUT",
        body: { oldEndpoint: ENDPOINT, subscription: { endpoint: `${ENDPOINT}-renewed`, keys: KEYS } },
      },
    ]);

    const nothing = await worker();
    await nothing.dispatch("pushsubscriptionchange", { oldSubscription: null, newSubscription: null });
    assert.deepEqual(nothing.posted, []);
  }),
  check("Store: one send job at a time, the lock gone after 2 minutes even if a run dies", async () => {
    const upstash = await fakeUpstash();
    try {
      const store = storeOn(new Redis({ url: upstash.url, token: "test-token", enableTelemetry: false }));
      assert.equal(await store.claimRun(), true);
      assert.equal(await store.claimRun(), false);
      assert.equal(upstash.ttl.get("push:run"), RUN_LOCK_S);
      await store.releaseRun();
      assert.equal(await store.claimRun(), true);
    } finally {
      await upstash.close();
    }
  }),

  check("Store: one test push a minute per phone", async () => {
    const upstash = await fakeUpstash();
    try {
      const store = storeOn(new Redis({ url: upstash.url, token: "test-token", enableTelemetry: false }));
      assert.equal(await store.claimTest("a"), true);
      assert.equal(await store.claimTest("a"), false);
      assert.equal(await store.claimTest("b"), true);
      assert.equal(upstash.ttl.get("push:test:a"), TEST_GAP_S);
      upstash.data.delete("push:test:a");
      assert.equal(await store.claimTest("a"), true);
    } finally {
      await upstash.close();
    }
  }),

  check("Routes: 503 until set up; only DooFah's own pages; size, JSON and method checked", async () => {
    assert.equal((await routes({ store: null }).server.subscribe(subscribe("POST", body()))).status, 503);
    assert.equal((await routes({ vapid: null }).server.test(test(ENDPOINT))).status, 503);

    const { server, store } = routes();
    for (const site of ["cross-site", "same-site", "none"]) {
      const refused = await answer(await server.subscribe(subscribe("POST", body(), { "sec-fetch-site": site })));
      assert.equal(refused.status, 403);
    }
    // No header at all: an old browser or a script, not DooFah's page.
    const bare = new Request(`${ORIGIN}/api/push/subscribe`, { method: "POST", body: JSON.stringify(body()) });
    assert.equal((await server.subscribe(bare)).status, 403);
    assert.equal((await server.test(test(ENDPOINT, { "sec-fetch-site": "cross-site" }))).status, 403);

    const big = { ...body(), padding: "x".repeat(9000) };
    assert.equal((await server.subscribe(subscribe("POST", big))).status, 413);
    const notJson = await answer(await server.subscribe(subscribe("POST", "{nope")));
    assert.equal(notJson.status, 400);
    const french = await answer(await server.subscribe(subscribe("POST", body({ lang: "fr" }))));
    assert.deepEqual(french, { status: 400, body: { error: true, reason: "Unknown language" } });
    const exact = await answer(
      await server.subscribe(
        subscribe("POST", body({ places: [{ ref: "0a1b2c3d", name: "Home", lat: 13.756, lon: 100.5 }] })),
      ),
    );
    assert.equal(exact.status, 400);
    assert.equal((await server.subscribe(subscribe("PATCH", body()))).status, 405);
    assert.equal(store.records.size, 0);
  }),

  check(
    "Routes: turning on keeps the record under its push address's id; syncing updates it; off deletes it",
    async () => {
      const { server, store, clock } = routes();
      const id = subscriptionId(ENDPOINT);
      const on = await answer(await server.subscribe(subscribe("POST", body())));
      assert.deepEqual(on, { status: 204, body: null });
      assert.deepEqual(store.records.get(id), readRecord(body(), NOW));

      clock.now = NOW + 86_400_000;
      assert.equal((await server.subscribe(subscribe("POST", body({ lang: "en" })))).status, 204);
      assert.equal(store.records.size, 1);
      assert.equal(store.records.get(id)?.lang, "en");
      assert.equal(store.records.get(id)?.savedAt, new Date(clock.now).toISOString());

      assert.equal((await server.subscribe(subscribe("DELETE", {}))).status, 400);
      assert.equal((await server.subscribe(subscribe("DELETE", { endpoint: ENDPOINT }))).status, 204);
      assert.equal(store.records.size, 0);
      // Already gone (turned off twice, or expired): still fine.
      assert.equal((await server.subscribe(subscribe("DELETE", { endpoint: ENDPOINT }))).status, 204);
    },
  ),

  check("Routes: a renewed subscription moves the record to the new address, places and language kept", async () => {
    const { server, store, clock } = routes();
    await server.subscribe(subscribe("POST", body()));
    clock.now = NOW + 3_600_000;
    const renewed = { endpoint: NEW_ENDPOINT, keys: KEYS };
    const moved = await server.subscribe(subscribe("PUT", { oldEndpoint: ENDPOINT, subscription: renewed }));
    assert.equal(moved.status, 204);
    assert.equal(store.records.get(subscriptionId(ENDPOINT)), undefined);
    const record = store.records.get(subscriptionId(NEW_ENDPOINT));
    assert.deepEqual(record?.subscription, renewed);
    assert.deepEqual(record?.places, body().places);
    assert.equal(record?.lang, "th");
    assert.equal(record?.savedAt, new Date(clock.now).toISOString());

    // Nothing to move: the page sends everything again when it next opens.
    const unknown = { oldEndpoint: "https://fcm.googleapis.com/fcm/send/unknown", subscription: renewed };
    assert.equal((await server.subscribe(subscribe("PUT", unknown))).status, 204);
    assert.equal((await server.subscribe(subscribe("PUT", { subscription: renewed }))).status, 204);
    assert.equal(store.records.size, 1);
    const fake = { oldEndpoint: NEW_ENDPOINT, subscription: { endpoint: "https://evil.example/push", keys: KEYS } };
    assert.equal((await server.subscribe(subscribe("PUT", fake))).status, 400);
    assert.ok(store.records.has(subscriptionId(NEW_ENDPOINT)));
  }),

  check("Routes: each visitor may write 30 times an hour", async () => {
    const { server, clock } = routes();
    for (let i = 0; i < 30; i++) assert.equal((await server.subscribe(subscribe("POST", body()))).status, 204);
    assert.equal((await server.subscribe(subscribe("POST", body()))).status, 429);
    assert.equal((await server.test(test(ENDPOINT))).status, 429);
    const other = { "x-forwarded-for": "198.51.100.2, 10.0.0.1" };
    assert.equal((await server.subscribe(subscribe("POST", body(), other))).status, 204);
    clock.now = NOW + 3_600_001;
    assert.equal((await server.subscribe(subscribe("POST", body()))).status, 204);
  }),

  check("Test push: in the phone's language, urgent, kept a minute, once a minute", async () => {
    const { server, sent } = routes();
    assert.equal((await server.test(test(ENDPOINT))).status, 404);
    assert.equal(sent.length, 0);

    await server.subscribe(subscribe("POST", body()));
    assert.equal((await server.test(test(ENDPOINT))).status, 204);
    assert.equal(sent.length, 1);
    const [{ subscription, payload, options }] = sent;
    assert.deepEqual(subscription, { endpoint: ENDPOINT, keys: KEYS });
    assert.deepEqual(payload, {
      title: MESSAGES.th.push.testTitle,
      body: MESSAGES.th.push.testBody,
      tag: "doofah-test",
      level: "warning",
      lang: "th",
      url: "/",
    });
    assert.equal(options.TTL, 60);
    assert.equal(options.urgency, "high");
    assert.equal(options.timeout, 10_000);
    assert.deepEqual(options.vapidDetails, VAPID);

    const again = await answer(await server.test(test(ENDPOINT)));
    assert.equal(again.status, 429);
    assert.equal(sent.length, 1);
    assert.equal(
      (
        await server.test(
          new Request(`${ORIGIN}/api/push/test`, {
            method: "POST",
            headers: { "sec-fetch-site": "same-origin" },
            body: "{}",
          }),
        )
      ).status,
      400,
    );
  }),

  check("Test push: a subscription the push service has dropped is deleted; other failures are 502", async () => {
    const gone = routes();
    await gone.server.subscribe(subscribe("POST", body()));
    gone.push.failWith = new WebPushError("Gone", 410, {}, "", ENDPOINT);
    assert.equal((await gone.server.test(test(ENDPOINT))).status, 410);
    assert.equal(gone.store.records.size, 0);
    assert.deepEqual(gone.alerts, []);

    const down = routes();
    await down.server.subscribe(subscribe("POST", body()));
    down.push.failWith = new WebPushError("Server error", 500, {}, "", ENDPOINT);
    assert.equal((await down.server.test(test(ENDPOINT))).status, 502);
    assert.equal(down.store.records.size, 1);
    assert.deepEqual(down.alerts, [
      { kind: "error", api: "/api/push/test", message: "502: the push service answered 500" },
    ]);

    const timeout = routes();
    await timeout.server.subscribe(subscribe("POST", body()));
    timeout.push.failWith = new Error("socket hang up");
    assert.equal((await timeout.server.test(test(ENDPOINT))).status, 502);
    assert.equal(timeout.alerts[0].message, "502: the push service answered nothing");
  }),

  check("Store failures: 500, reported without the command (no push address or places in logs)", async () => {
    const upstashError = new Error(
      `WRONGPASS invalid password, command was: [["set","push:sub:abc",${JSON.stringify(JSON.stringify(body()))}]]`,
    );
    assert.equal(storeProblem(upstashError), "WRONGPASS invalid password");
    assert.equal(storeProblem("x".repeat(500)).length, 200);

    const broken: PushStore = {
      ...memoryStore(),
      async save() {
        throw upstashError;
      },
      async get() {
        throw upstashError;
      },
    };
    const { server, alerts } = routes({ store: broken });
    const saved = await answer(await server.subscribe(subscribe("POST", body())));
    assert.deepEqual(saved, {
      status: 500,
      body: { error: true, reason: "Storm alerts are unavailable, try again later" },
    });
    assert.equal((await server.test(test(ENDPOINT))).status, 500);
    assert.equal(alerts.length, 2);
    for (const alert of alerts) {
      assert.equal(alert.message, "500: WRONGPASS invalid password");
      assert.ok(!JSON.stringify(alert).includes("fcm.googleapis.com"));
    }
  }),

  check(
    "Phone: places rounded to 0.1°, named by a hash of their id, at most 10, and accepted by the server",
    async () => {
      assert.equal(phone.MAX_PLACES, MAX_PLACES);
      assert.equal(phone.MAX_NAME_LENGTH, MAX_NAME_LENGTH);
      const gps = { id: "pt@13.756,100.502", name: "  Home  ", point: { lat: 13.756, lon: 100.502 } };
      const [home] = await phone.pushPlaces([gps]);
      assert.deepEqual(home, { ref: await placeRef(gps.id), name: "Home", lat: 13.8, lon: 100.5 });
      assert.ok(!JSON.stringify(home).includes("13.756"));

      const many = Array.from({ length: 12 }, (_, i) => ({
        id: `place-${i}`,
        name: `Place ${i}`,
        point: { lat: -33.8688 + i, lon: 151.2093 - i * 0.05 },
      }));
      const places = await phone.pushPlaces(many);
      assert.equal(places.length, 10);
      const record = readRecord(body({ places }), NOW);
      assert.notEqual(typeof record, "string", String(record));

      // 39 letters then an emoji (two UTF-16 units): the emoji is dropped whole, not split.
      const [cut] = await phone.pushPlaces([{ id: "a", name: `${"a".repeat(39)}🌧️`, point: { lat: 0, lon: 0 } }]);
      assert.equal(cut.name, "a".repeat(39));
      const [blank] = await phone.pushPlaces([{ id: "b", name: " ", point: { lat: 7.04, lon: 100.47 } }]);
      assert.equal(blank.name, "7, 100.5");
      assert.notEqual(typeof readRecord(body({ places: [cut, blank] }), NOW), "string");
    },
  ),

  check("Phone: the VAPID key as bytes; sent again when anything changed, and once a day", () => {
    const bytes = phone.keyBytes(VAPID.publicKey);
    assert.equal(bytes.length, 65);
    assert.equal(bytes[0], 4);
    assert.deepEqual([...bytes], [...Buffer.from(VAPID.publicKey, "base64url")]);

    const places = body().places;
    const stamp = phone.syncStamp(ENDPOINT, places, "th", "Asia/Bangkok", NOW);
    assert.equal(phone.syncStamp(ENDPOINT, places, "th", "Asia/Bangkok", NOW + 60_000), stamp);
    assert.notEqual(phone.syncStamp(ENDPOINT, places, "th", "Asia/Bangkok", NOW + 86_400_000), stamp);
    assert.notEqual(phone.syncStamp(ENDPOINT, places, "en", "Asia/Bangkok", NOW), stamp);
    assert.notEqual(phone.syncStamp(ENDPOINT, places.slice(1), "th", "Asia/Bangkok", NOW), stamp);
    assert.notEqual(phone.syncStamp(NEW_ENDPOINT, places, "th", "Asia/Bangkok", NOW), stamp);
    assert.notEqual(phone.syncStamp(ENDPOINT, places, "th", "Asia/Tokyo", NOW), stamp);
  }),

  check('Phone: "Not now" hides the offer for 30 days', () => {
    withStorage(() => {
      assert.equal(phone.isSnoozed(NOW), false);
      phone.snooze(NOW);
      assert.equal(phone.isSnoozed(NOW + 1), true);
      assert.equal(phone.isSnoozed(NOW + phone.LATER_MS - 1), true);
      assert.equal(phone.isSnoozed(NOW + phone.LATER_MS), false);
    });
    // Storage blocked: never snoozed rather than an error.
    assert.equal(phone.isSnoozed(NOW), false);
  }),
  check("Storm job: only the scheduler's CRON_SECRET; 503 until set up; one run at a time", async () => {
    const { server, store } = routes();
    for (const request of [
      new Request(`${ORIGIN}/api/push/send`, { method: "POST" }),
      job("wrong"),
      job(SECRET.toUpperCase()),
      // A page on DooFah itself can't start it either.
      new Request(`${ORIGIN}/api/push/send`, { method: "POST", headers: { "sec-fetch-site": "same-origin" } }),
    ]) {
      assert.equal((await answer(await server.sendStorms(request))).status, 401);
    }
    const noSecret = routes({ secret: undefined });
    assert.equal((await noSecret.server.sendStorms(job(""))).status, 401);
    assert.equal(
      (await noSecret.server.sendStorms(new Request(ORIGIN, { headers: { authorization: "Bearer " } }))).status,
      401,
    );
    assert.equal((await routes({ store: null }).server.sendStorms(job())).status, 503);
    assert.equal((await routes({ vapid: null }).server.sendStorms(job())).status, 503);

    store.state.running = true;
    const busy = await answer(await server.sendStorms(job()));
    assert.deepEqual(busy, { status: 409, body: { error: true, reason: "Already running" } });
    store.state.running = false;
    assert.equal((await server.sendStorms(job())).status, 200);
    assert.equal(store.state.running, false);
  }),

  check(
    "Storm job: no storms anywhere means the phones aren't read; the run time is kept for the health check",
    async () => {
      const { server, store, sent, world } = routes();
      await savePhone(store, ENDPOINT, [HOME]);
      world.feed = { run: "2026-10-04T00:00:00.000Z", storms: [] };
      const run = await answer(await server.sendStorms(job()));
      assert.deepEqual(run, {
        status: 200,
        body: {
          ok: true,
          run: "2026-10-04T00:00:00.000Z",
          storms: 0,
          phones: 0,
          alerts: 0,
          sent: 0,
          removed: 0,
          failed: 0,
        },
      });
      assert.equal(store.counts.all, 0);
      assert.equal(sent.length, 0);
      assert.equal(store.state.last, NOW);
    },
  ),

  check("Storm job: a phone near the path gets one warning, in its language and time zone; never twice", async () => {
    const { server, store, sent, world } = routes();
    const thai = await savePhone(store, ENDPOINT, [HOME, FAR]);
    await savePhone(store, NEW_ENDPOINT, [{ ...HOME, name: "Home" }], "en", "Europe/London");
    await savePhone(store, APPLE_ENDPOINT, [FAR]);
    world.feed = westward();

    const first = await answer(await server.sendStorms(job()));
    assert.deepEqual(first.body, {
      ok: true,
      run: world.feed.run,
      storms: 1,
      phones: 3,
      alerts: 2,
      sent: 2,
      removed: 0,
      failed: 0,
    });
    assert.equal(sent.length, 2);
    assert.ok(!sent.some((s) => s.subscription.endpoint === APPLE_ENDPOINT), "the phone 800 km away gets nothing");

    const [alert] = cycloneAlerts(world.feed, { id: HOME.ref, name: HOME.name, point: HOME }, [], NOW);
    assert.equal(alert.level, "warning");
    assert.equal(alert.km, 110);
    const th = sent.find((s) => s.subscription.endpoint === ENDPOINT)!;
    const en = sent.find((s) => s.subscription.endpoint === NEW_ENDPOINT)!;
    const thaiClock = createFormatters("th").clock(alert.at!, "Asia/Bangkok");
    const londonClock = createFormatters("en").clock(alert.at!, "Europe/London");
    assert.notEqual(thaiClock, londonClock);
    assert.equal(th.payload.title, "พายุไต้ฝุ่น IN-FA อาจเคลื่อนผ่านห่างจากบ้านราว 110\u00a0กม.");
    assert.ok(String(th.payload.body).includes(thaiClock), String(th.payload.body));
    assert.equal(en.payload.title, "Typhoon IN-FA may pass about 110 km from Home");
    assert.ok(String(en.payload.body).startsWith(`Closest at ${londonClock} `), String(en.payload.body));
    assert.ok(String(en.payload.body).includes("winds near the centre up to 150 km/h"));
    assert.deepEqual(
      { tag: th.payload.tag, level: th.payload.level, lang: th.payload.lang, url: th.payload.url },
      { tag: "storm-27W", level: "warning", lang: "th", url: "/?storm=27W&place=0a1b2c3d" },
    );
    assert.equal(en.payload.lang, "en");
    assert.equal(th.options.TTL, 6 * 3600);
    assert.equal(th.options.urgency, "normal");
    assert.equal(th.options.topic, "27W");
    assert.deepEqual(th.options.vapidDetails, VAPID);
    assert.deepEqual(store.marked.get("27W"), { [thai]: "warning", [subscriptionId(NEW_ENDPOINT)]: "warning" });

    const again = await answer(await server.sendStorms(job()));
    assert.equal(again.body.alerts, 2);
    assert.equal(again.body.sent, 0);
    assert.equal(sent.length, 2);
  }),

  check("Storm job: the same storm turning severe sends once more, urgent; then nothing", async () => {
    const { server, store, sent, world, clock } = routes();
    await savePhone(store, ENDPOINT, [HOME]);
    world.feed = westward();
    await server.sendStorms(job());
    assert.equal(sent.length, 1);

    // 12 hours on, the path is within 500 km inside 48 hours.
    clock.now = NOW + 12 * HOUR;
    const severe = await answer(await server.sendStorms(job()));
    assert.equal(severe.body.sent, 1);
    assert.equal(sent[1].payload.level, "severe");
    assert.equal(sent[1].payload.tag, "storm-27W");
    assert.equal(sent[1].options.urgency, "high");
    clock.now = NOW + 13 * HOUR;
    assert.equal((await answer(await server.sendStorms(job()))).body.sent, 0);

    // A phone that first hears of it when it is already severe hears once.
    await savePhone(store, NEW_ENDPOINT, [HOME]);
    assert.equal((await answer(await server.sendStorms(job()))).body.sent, 1);
    assert.equal((await answer(await server.sendStorms(job()))).body.sent, 0);
    assert.equal(sent.length, 3);
  }),

  check(
    "Storm job: a dropped phone is deleted; other refusals are retried next run, reported once without the address",
    async () => {
      const { server, store, sent, world, push, alerts } = routes();
      const gone = await savePhone(store, ENDPOINT, [HOME]);
      const busy = await savePhone(store, NEW_ENDPOINT, [HOME]);
      world.feed = westward();
      push.failFor.set(ENDPOINT, new WebPushError("Received unexpected response code", 410, {}, "", ENDPOINT));
      push.failFor.set(
        NEW_ENDPOINT,
        new WebPushError(`Received unexpected response code from ${NEW_ENDPOINT}`, 429, {}, "", NEW_ENDPOINT),
      );
      const first = await answer(await server.sendStorms(job()));
      assert.deepEqual([first.body.sent, first.body.removed, first.body.failed], [0, 1, 1]);
      assert.equal(store.counts.remove, 1);
      assert.ok(!store.records.has(gone));
      assert.ok(store.records.has(busy));
      assert.equal(store.marked.get("27W"), undefined);
      assert.deepEqual(alerts, [
        {
          kind: "error",
          api: "/api/push/send",
          message: "1 of 2 storm pushes failed; first: 429: Received unexpected response code from <address>",
        },
      ]);

      push.failFor.clear();
      const retry = await answer(await server.sendStorms(job()));
      assert.deepEqual([retry.body.phones, retry.body.sent], [1, 1]);
      assert.equal(sent[0].subscription.endpoint, NEW_ENDPOINT);
      assert.equal(alerts.length, 1);
    },
  ),

  check("Storm job: a dropped phone near several storms is deleted once and not tried again", async () => {
    const { server, store, world, push } = routes();
    await savePhone(store, ENDPOINT, [HOME]);
    world.feed = { ...westward(), storms: Array.from({ length: 25 }, (_, i) => westward(NOW, `${i + 1}W`).storms[0]) };
    push.failFor.set(ENDPOINT, new WebPushError("Received unexpected response code", 410, {}, "", ENDPOINT));
    const run = await answer(await server.sendStorms(job()));
    assert.deepEqual([run.body.alerts, run.body.sent, run.body.removed, run.body.failed], [25, 0, 1, 0]);
    assert.equal(store.counts.remove, 1);
    assert.equal(push.tried, 20);
  }),

  check("Storm job: 20 pushes at a time, each batch marked as sent when it is done", async () => {
    const { server, store, sent, world, push } = routes();
    for (let i = 0; i < 45; i++) await savePhone(store, `${ENDPOINT}-${i}`, [HOME]);
    world.feed = westward();
    const run = await answer(await server.sendStorms(job()));
    assert.equal(run.body.sent, 45);
    assert.equal(sent.length, 45);
    assert.equal(push.mostInFlight, 20);
    assert.equal(store.counts.markSent, 3);
    assert.equal(Object.keys(store.marked.get("27W")!).length, 45);
  }),

  check(
    "Storm job: ECMWF out of reach is a 502, reported; nothing sent, the lock released, no run time kept",
    async () => {
      const { server, store, sent, world, alerts } = routes();
      await savePhone(store, ENDPOINT, [HOME]);
      world.error = new CycloneSourceError("Google Cloud answered 503; ECMWF answered 503");
      const down = await answer(await server.sendStorms(job()));
      assert.deepEqual(down, {
        status: 502,
        body: { error: true, reason: "Google Cloud answered 503; ECMWF answered 503" },
      });
      assert.deepEqual(alerts, [
        { kind: "error", api: "/api/push/send", message: "502, Google Cloud answered 503; ECMWF answered 503" },
      ]);
      assert.equal(sent.length, 0);
      assert.equal(store.state.running, false);
      assert.equal(store.state.last, null);

      world.error = new TypeError("Cannot read properties of undefined");
      const bug = await answer(await server.sendStorms(job()));
      assert.equal(bug.status, 500);
      assert.equal(store.state.running, false);
    },
  ),

  check("Storm message: already close, other ids, topics", () => {
    const alert: CycloneAlert = {
      kind: "cyclone",
      level: "severe",
      stormId: "27W",
      name: null,
      category: "storm",
      place: "Home",
      placeId: "0a1b2c3d",
      km: 90,
      at: null,
      windKmh: null,
      chance: 80,
      also: [],
    };
    const message = stormMessage(alert, "en", "Asia/Bangkok", NOW);
    assert.equal(message.title, "Tropical storm 27W is 90 km from Home");
    assert.equal(message.body, "80% of ECMWF's forecasts bring it within 500 km");
    assert.equal(stormMessage({ ...alert, stormId: "27W/b" }, "en", "Asia/Bangkok", NOW).url, "/");
    assert.equal(topicOf("27W"), "27W");
    assert.equal(topicOf("!!"), undefined);
    assert.equal(topicOf("x".repeat(40))?.length, 32);
    assert.ok(new TextEncoder().encode(JSON.stringify(stormMessage(alert, "th", "Asia/Bangkok", NOW))).length < 1000);
  }),
];

async function main() {
  for (const { name, fn } of CHECKS) {
    try {
      await fn();
      checks++;
      console.log(`✓ ${name}`);
    } catch (error) {
      console.error(`✗ ${name}`);
      throw error;
    }
  }
  console.log(`\nAll ${checks} push checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
