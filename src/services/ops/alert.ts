/**
 * Alerts for whoever runs DooFah, never shown to users: one line to a Discord
 * channel (ALERT_DISCORD_WEBHOOK_URL) and, if set up, to a LINE chat through
 * the Messaging API (ALERT_LINE_CHANNEL_TOKEN + ALERT_LINE_TO), when a source
 * falls back, a route answers 5xx, or a health check fails. Without either
 * setting, alerts only reach Vercel's logs.
 */

export type AlertKind = "fallback" | "error" | "health";

export interface Alert {
  kind: AlertKind;
  /** What it is about, such as "/api/forecast". */
  api: string;
  /** What happened, in a line or two. Never a token, a key or a user's exact location. */
  message: string;
}

export interface AlertTargets {
  discordUrl?: string;
  lineToken?: string;
  lineTo?: string;
}

/** The same kind of alert about the same API is sent at most once in this long by each server instance. */
const QUIET_MS = 15 * 60_000;
const TIMEOUT_MS = 5_000;
/** Discord's limit is 2,000 characters, LINE's 5,000. */
const MAX_CHARS = 1_900;
const MARK: Record<AlertKind, string> = { fallback: "🟡 Fallback", error: "🔴 Error", health: "🩺 Health check" };

const lastSent = new Map<string, number>();

export function alertTargets(env: Record<string, string | undefined> = process.env): AlertTargets {
  return {
    discordUrl: env.ALERT_DISCORD_WEBHOOK_URL?.trim() || undefined,
    lineToken: env.ALERT_LINE_CHANNEL_TOKEN?.trim() || undefined,
    lineTo: env.ALERT_LINE_TO?.trim() || undefined,
  };
}

/** Sends `alert` to every target set up, unless the same kind about the same API went out in the last 15 minutes. */
export async function sendAlert(
  alert: Alert,
  targets: AlertTargets = alertTargets(),
  now: number = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<"sent" | "quiet" | "no-target"> {
  const key = `${alert.kind} ${alert.api}`;
  if (now - (lastSent.get(key) ?? -Infinity) < QUIET_MS) return "quiet";
  const where = process.env.VERCEL_ENV ?? "local";
  const text = `${MARK[alert.kind]} · DooFah ${where} · ${alert.api}\n${alert.message}`.slice(0, MAX_CHARS);
  const posts: Promise<Response>[] = [];
  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  if (targets.discordUrl) {
    // allowed_mentions: a reason that happens to contain @everyone pings no one.
    posts.push(
      post(targets.discordUrl, { username: "DooFah monitor", content: text, allowed_mentions: { parse: [] } }),
    );
  }
  if (targets.lineToken && targets.lineTo) {
    posts.push(
      post(
        "https://api.line.me/v2/bot/message/push",
        { to: targets.lineTo, messages: [{ type: "text", text }] },
        { Authorization: `Bearer ${targets.lineToken}` },
      ),
    );
  }
  if (!posts.length) return "no-target";
  lastSent.set(key, now);
  for (const result of await Promise.allSettled(posts)) {
    if (result.status === "rejected") console.error("[alert] not sent:", (result.reason as Error).message);
    else if (!result.value.ok) console.error("[alert] not sent: answered", result.value.status);
  }
  return "sent";
}
