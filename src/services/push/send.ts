/**
 * Sending one push with web-push (Node only, not the Edge runtime): the
 * message is encrypted for that phone and signed with DooFah's VAPID keys,
 * then handed to the phone's push service (Google, Apple, Mozilla or
 * Microsoft), which delivers it when the phone is reachable.
 */

import webpush, { WebPushError, type RequestOptions } from "web-push";
import type { Locale } from "@/i18n/config";
import type { SavedSubscription } from "./subscription";
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
