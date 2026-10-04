/**
 * Checks for storm alerts by Web Push (post-launch step 3, part A): the VAPID
 * settings, what a subscription must look like before it is kept, the link a
 * notification opens, the Upstash Redis store (against a stand-in for
 * Upstash's REST API) and the service worker's push, tap and renewal
 * handlers (run in a stand-in worker). Needs no network and sends nothing.
 * Run with: npm run verify:push
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { runInNewContext } from "node:vm";
import { Redis } from "@upstash/redis";
import { placeRef, readStormLink, stormLink } from "../src/lib/pushLink";
import { RECORD_TTL_S, SENT_TTL_S, redisStore, storeOn } from "../src/services/push/store";
import {
  isPushServiceUrl,
  readRecord,
  readSubscription,
  subscriptionId,
  type PushRecord,
} from "../src/services/push/subscription";
import { vapidFrom } from "../src/services/push/vapid";

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
