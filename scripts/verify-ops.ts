/**
 * Checks for DooFah's own monitoring (post-launch step 2): asking a source
 * again (which failures, how many times, how long between), and the alerts
 * for whoever runs DooFah (which channels, what they are sent, at most one of
 * a kind every 15 minutes, never too long for Discord). Uses made-up
 * channels, so it needs no network and sends nothing.
 * Run with: npm run verify:ops
 */
import assert from "node:assert/strict";
import { CycloneSourceError } from "../src/services/cyclones/openData";
import { TmdError } from "../src/services/forecast/tmd";
import { OpenMeteoError } from "../src/services/openmeteo/api";
import { alertTargets, sendAlert, type Alert } from "../src/services/ops/alert";
import { reportAfterReply } from "../src/services/ops/report";
import { isTransient, withRetry } from "../src/services/ops/retry";

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 9, 4, 7, 0);

let checks = 0;
const check = (name: string, fn: () => void | Promise<void>) => ({ name, fn });

/** A channel that records what it is sent and answers with `status`, or fails to connect when `status` is 0. */
function channel(status = 204) {
  const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    if (!status) throw new TypeError("fetch failed");
    return new Response(null, { status });
  }) as typeof fetch;
  return { fetcher, sent };
}

/** Runs `work` with console.error collected instead of printed. */
async function logged<T>(work: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const error = console.error;
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    return { result: await work(), lines };
  } finally {
    console.error = error;
  }
}

const DISCORD = "https://discord.com/api/webhooks/1/test";
const alert = (
  api: string,
  kind: Alert["kind"] = "fallback",
  message = "TMD answered 401: Unauthenticated.",
): Alert => ({
  kind,
  api,
  message,
});

const CHECKS = [
  /* ---------------- Asking again ---------------- */

  check("a timeout, a dropped connection or a 5xx may pass; a 4xx, a 429 or DooFah's own bug won't", () => {
    assert.ok(isTransient(new OpenMeteoError("Open-Meteo could not be reached", 502)));
    assert.ok(isTransient(new OpenMeteoError("Open-Meteo answered 503", 503)));
    assert.ok(isTransient(new TmdError("TMD could not be reached", 502)));
    assert.ok(isTransient(new CycloneSourceError("Google Cloud stopped answering (terminated)")), "no status: 502");
    assert.ok(!isTransient(new OpenMeteoError("Too many requests", 429)));
    assert.ok(!isTransient(new TmdError("TMD answered 401: Unauthenticated.", 401)));
    assert.ok(!isTransient(new CycloneSourceError("ECMWF answered 403", 403)));
    assert.ok(!isTransient(new TypeError("Cannot read properties of undefined")));
    assert.ok(!isTransient(null) && !isTransient("502"));
  }),

  check("a source is asked twice in all, after a short wait, and only while the failure may pass", async () => {
    const waits: number[] = [];
    const wait = async (ms: number) => void waits.push(ms);
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw new OpenMeteoError("Open-Meteo answered 503", 503);
      return "ECMWF";
    };
    assert.equal(await withRetry(flaky, { retryable: isTransient, wait }), "ECMWF");
    assert.equal(calls, 2);
    assert.equal(waits.length, 1);
    assert.ok(waits[0] >= 375 && waits[0] <= 625, `about 0.5 s, give or take a quarter: ${waits[0]}`);

    calls = 0;
    const down = async () => {
      calls++;
      throw new OpenMeteoError(`try ${calls}`, 502);
    };
    await assert.rejects(withRetry(down, { retryable: isTransient, wait }), /try 2/, "the last try's error");
    assert.equal(calls, 2);

    calls = 0;
    const refused = async () => {
      calls++;
      throw new OpenMeteoError("Too many requests", 429);
    };
    await assert.rejects(withRetry(refused, { retryable: isTransient, wait }), /Too many requests/);
    assert.equal(calls, 1, "a 429 isn't asked again: that would make the limit worse");

    const tries: number[] = [];
    await assert.rejects(
      withRetry(
        async (n) => {
          tries.push(n);
          throw new OpenMeteoError("down", 502);
        },
        { tries: 3, delayMs: 1_000, retryable: isTransient, wait },
      ),
    );
    assert.deepEqual(tries, [1, 2, 3]);
    assert.ok(waits.slice(-2).every((ms) => ms >= 750 && ms <= 1_250));
  }),

  /* ---------------- Alerts ---------------- */

  check("alert channels come from the environment, and none means Vercel's logs only", async () => {
    assert.deepEqual(alertTargets({}), { discordUrl: undefined, lineToken: undefined, lineTo: undefined });
    assert.deepEqual(
      alertTargets({ ALERT_DISCORD_WEBHOOK_URL: ` ${DISCORD} `, ALERT_LINE_CHANNEL_TOKEN: " ", ALERT_LINE_TO: "U1" }),
      { discordUrl: DISCORD, lineToken: undefined, lineTo: "U1" },
    );
    const none = channel();
    assert.equal(await sendAlert(alert("/api/none"), {}, NOW, none.fetcher), "no-target");
    assert.equal(
      await sendAlert(alert("/api/none"), { lineToken: "t" }, NOW, none.fetcher),
      "no-target",
      "LINE needs both",
    );
    assert.equal(none.sent.length, 0);
  }),

  check("Discord gets one line naming the kind, where it ran and the API, and pings no one", async () => {
    const discord = channel();
    const env = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    try {
      const message = "ECMWF alone for 5 minutes: TMD answered 401: Unauthenticated. @everyone";
      assert.equal(
        await sendAlert(alert("/api/discord", "fallback", message), { discordUrl: DISCORD }, NOW, discord.fetcher),
        "sent",
      );
    } finally {
      if (env === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = env;
    }
    assert.equal(discord.sent.length, 1);
    const [post] = discord.sent;
    assert.equal(post.url, DISCORD);
    assert.equal(post.headers.get("content-type"), "application/json");
    assert.deepEqual(post.body, {
      username: "DooFah monitor",
      content:
        "🟡 Fallback · DooFah production · /api/discord\nECMWF alone for 5 minutes: TMD answered 401: Unauthenticated. @everyone",
      allowed_mentions: { parse: [] },
    });
  }),

  check("LINE gets the same text as a push message with the channel token", async () => {
    const both = channel(200);
    const targets = { discordUrl: DISCORD, lineToken: "line-token", lineTo: "Uabc" };
    assert.equal(
      await sendAlert(alert("/api/line", "error", "502, ECMWF unavailable: Busy"), targets, NOW, both.fetcher),
      "sent",
    );
    assert.equal(both.sent.length, 2);
    const line = both.sent.find((s) => s.url === "https://api.line.me/v2/bot/message/push")!;
    assert.equal(line.headers.get("authorization"), "Bearer line-token");
    assert.deepEqual(line.body, {
      to: "Uabc",
      messages: [{ type: "text", text: "🔴 Error · DooFah local · /api/line\n502, ECMWF unavailable: Busy" }],
    });
  }),

  check("the same kind about the same API goes out at most once in 15 minutes", async () => {
    const discord = channel();
    const send = (api: string, kind: Alert["kind"], at: number) =>
      sendAlert(alert(api, kind), { discordUrl: DISCORD }, at, discord.fetcher);
    assert.equal(await send("/api/quiet", "fallback", NOW), "sent");
    assert.equal(await send("/api/quiet", "fallback", NOW + 14 * MINUTE), "quiet");
    assert.equal(await send("/api/quiet", "error", NOW + MINUTE), "sent", "another kind");
    assert.equal(await send("/api/other", "fallback", NOW + MINUTE), "sent", "another API");
    assert.equal(await send("/api/quiet", "fallback", NOW + 15 * MINUTE), "sent", "15 minutes later");
    assert.equal(discord.sent.length, 4);
  }),

  check("a long reason is cut to fit Discord's 2,000 characters", async () => {
    const discord = channel();
    await sendAlert(alert("/api/long", "health", "x".repeat(5_000)), { discordUrl: DISCORD }, NOW, discord.fetcher);
    const content = String(discord.sent[0].body.content);
    assert.equal(content.length, 1_900);
    assert.ok(content.startsWith("🩺 Health check · DooFah local · /api/long\nxxx"));
  }),

  check("a channel that is down or refuses is logged, and never fails the route", async () => {
    const down = channel(0);
    const offline = await logged(() => sendAlert(alert("/api/down"), { discordUrl: DISCORD }, NOW, down.fetcher));
    assert.equal(offline.result, "sent");
    assert.deepEqual(offline.lines, ["[alert] not sent: fetch failed"]);
    const gone = channel(404);
    const deleted = await logged(() => sendAlert(alert("/api/gone"), { discordUrl: DISCORD }, NOW, gone.fetcher));
    assert.deepEqual(deleted.lines, ["[alert] not sent: answered 404"], "a deleted webhook");
  }),

  check("outside a request, a report is logged and sent at once", async () => {
    const env = { ...process.env };
    delete process.env.ALERT_DISCORD_WEBHOOK_URL;
    delete process.env.ALERT_LINE_CHANNEL_TOKEN;
    try {
      const { lines } = await logged(async () => reportAfterReply(alert("/api/report", "error", "500: boom")));
      assert.deepEqual(lines, ["[/api/report] error: 500: boom"]);
    } finally {
      Object.assign(process.env, env);
    }
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
  console.log(`\nAll ${checks} ops checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
