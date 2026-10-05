/**
 * Sending pushes with web-push (Node only, not the Edge runtime): each
 * message is encrypted for its phone and signed with DooFah's VAPID keys,
 * then handed to the phone's push service (Google, Apple, Mozilla or
 * Microsoft), which delivers it when the phone is reachable.
 *
 * sendStormAlerts() is the storm alert job: every phone with alerts on,
 * checked with the banner's own rule (cycloneAlerts), told once about each
 * storm as a warning and once more if it turns severe.
 */

import webpush, { WebPushError, type RequestOptions } from "web-push";
import type { Locale } from "@/i18n/config";
import { cycloneAlerts, type CycloneAlert, type CycloneFeed } from "@/lib/cyclones";
import type { Report } from "../ops/report";
import { stormMessage } from "./message";
import type { PushStore, StormLevel } from "./store";
import type { PushRecord, SavedSubscription } from "./subscription";
import type { Vapid } from "./vapid";

/** What public/sw.js shows. Already in the reader's language. */
export interface PushMessage {
  title: string;
  body: string;
  /** Per storm, so a newer alert replaces the one on screen. */
  tag: string;
  level: "warning" | "severe";
  lang: Locale;
  /** A DooFah page to open on tap. */
  url: string;
}

export interface SendOptions {
  /** How long the push service keeps trying a phone that is off, in seconds. */
  ttl: number;
  urgency: "normal" | "high";
  /** Up to 32 URL-safe characters: a newer push with the same topic replaces one still waiting. */
  topic?: string;
}

/** Sends one push; tests pass their own. */
export type Sender = (subscription: SavedSubscription, payload: string, options: RequestOptions) => Promise<unknown>;

export const webPushSender: Sender = (subscription, payload, options) =>
  webpush.sendNotification(subscription, payload, options);

const TIMEOUT_MS = 10_000;

export function sendPush(
  subscription: SavedSubscription,
  message: PushMessage,
  vapid: Vapid,
  options: SendOptions,
  send: Sender = webPushSender,
): Promise<unknown> {
  return send(subscription, JSON.stringify(message), {
    vapidDetails: vapid,
    TTL: options.ttl,
    urgency: options.urgency,
    topic: options.topic,
    timeout: TIMEOUT_MS,
  });
}

/** The push service's answer to a failed send, or 0 when it never answered. */
export const pushStatus = (error: unknown) => (error instanceof WebPushError ? error.statusCode : 0);

/** 404 and 410: the phone unsubscribed or was reset, so it can never be reached again. */
export const isGone = (status: number) => status === 404 || status === 410;

/** A phone that is off longer than this gets the next run's alert instead of a stale one. */
const STORM_TTL_S = 6 * 3600;
/** Pushes handed to the push services at once. */
const BATCH = 20;

/** Push services take up to 32 URL-safe characters as a topic: a newer push for the storm replaces one still waiting. */
export const topicOf = (stormId: string) => stormId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined;

/** A failure for the log and Discord, without the push address it was for. */
const failureOf = (status: number, error: unknown) =>
  `${status || "no answer"}: ${(error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/\S+/g, "<address>")
    .slice(0, 120)}`;

export interface SendSummary {
  /** Active storms in ECMWF's newest run. */
  storms: number;
  /** Phones with alerts on (read only when there is a storm). */
  phones: number;
  /** Storm alerts for those phones' places this run. */
  alerts: number;
  /** Pushes handed to the push services. */
  sent: number;
  /** Phones whose push service said they are gone; their records were deleted. */
  removed: number;
  /** Pushes refused for another reason; not marked as sent, so the next run tries again. */
  failed: number;
}

/**
 * One run of the storm alert job. No storms means the phones aren't even
 * read. What was sent is marked after each batch, so a run cut short never
 * sends the same alert twice.
 */
export async function sendStormAlerts(
  feed: CycloneFeed,
  store: PushStore,
  vapid: Vapid,
  now: number,
  report: Report,
  send: Sender = webPushSender,
): Promise<SendSummary> {
  const summary: SendSummary = { storms: feed.storms.length, phones: 0, alerts: 0, sent: 0, removed: 0, failed: 0 };
  if (!feed.storms.length) return summary;

  const phones = await store.all();
  summary.phones = phones.length;
  const already = new Map<string, Record<string, StormLevel>>();
  const due: { id: string; record: PushRecord; alert: CycloneAlert }[] = [];
  for (const [id, record] of phones) {
    const [first, ...rest] = record.places.map((p) => ({ id: p.ref, name: p.name, point: { lat: p.lat, lon: p.lon } }));
    if (!first) continue;
    for (const alert of cycloneAlerts(feed, first, rest, now)) {
      summary.alerts++;
      if (!already.has(alert.stormId)) already.set(alert.stormId, await store.sent(alert.stormId));
      const was = already.get(alert.stormId)![id];
      // Once as a warning, once more if it turns severe; never the same level twice.
      if (was === "severe" || was === alert.level) continue;
      due.push({ id, record, alert });
    }
  }

  const problems: string[] = [];
  const gone = new Set<string>();
  for (let i = 0; i < due.length; i += BATCH) {
    // A phone found gone in an earlier batch isn't tried again for its other storms.
    const batch = due.slice(i, i + BATCH).filter(({ id }) => !gone.has(id));
    const results = await Promise.allSettled(
      // Async, so a record that can't be worded fails alone instead of stopping everyone's alerts.
      batch.map(async ({ record, alert }) =>
        sendPush(
          record.subscription,
          stormMessage(alert, record.lang, record.timeZone, now),
          vapid,
          {
            ttl: STORM_TTL_S,
            // High wakes a phone in battery saver; kept for storms within 48 hours.
            urgency: alert.level === "severe" ? "high" : "normal",
            topic: topicOf(alert.stormId),
          },
          send,
        ),
      ),
    );
    const delivered = new Map<string, Record<string, StormLevel>>();
    for (const [j, result] of results.entries()) {
      const { id, alert } = batch[j];
      if (result.status === "fulfilled") {
        summary.sent++;
        delivered.set(alert.stormId, { ...delivered.get(alert.stormId), [id]: alert.level });
        continue;
      }
      const status = pushStatus(result.reason);
      if (isGone(status)) {
        // Unsubscribed, or the browser was reset: this phone can't be reached again.
        if (!gone.has(id)) {
          gone.add(id);
          await store.remove(id);
          summary.removed++;
        }
      } else {
        // Rate limits and push service outages: not marked as sent, so the next run tries again.
        summary.failed++;
        problems.push(failureOf(status, result.reason));
      }
    }
    for (const [stormId, levels] of delivered) await store.markSent(stormId, levels);
  }

  if (problems.length) {
    report({
      kind: "error",
      api: "/api/push/send",
      message: `${problems.length} of ${due.length} storm pushes failed; first: ${problems[0]}`,
    });
  }
  return summary;
}
