/**
 * What DooFah keeps for each phone that turns storm alerts on, and the checks
 * a subscription passes before it is stored. Anyone can call the subscribe
 * route, so nothing is kept unless it is a real push service address with
 * well-formed keys, up to 10 places already rounded to 0.1° (about 11 km), a
 * known language and a real time zone.
 */

import { createHash } from "node:crypto";
import { isLocale, type Locale } from "@/i18n/config";
import { PLACE_REF } from "@/lib/pushLink";

/** The browser's PushSubscription, as `toJSON()` gives it. */
export interface SavedSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPlace {
  /** A short hash of the place's id (see src/lib/pushLink.ts), never the id: a GPS place's id is its exact spot. */
  ref: string;
  /** As the notification says it: "Home", "Chiang Mai". */
  name: string;
  lat: number;
  lon: number;
}

export interface PushRecord {
  subscription: SavedSubscription;
  /** The first is the main place; storms are checked against all of them. */
  places: PushPlace[];
  lang: Locale;
  /** IANA time zone the notification's times are written in. */
  timeZone: string;
  /** When the phone last sent its subscription (ISO). */
  savedAt: string;
}

export const MAX_PLACES = 10;
export const MAX_NAME_LENGTH = 40;
const MAX_ENDPOINT_LENGTH = 1024;

/** The record's id: one per push address, so the same phone always updates its own record. */
export const subscriptionId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

/**
 * Whether `endpoint` belongs to a browser push service: Google (Chrome,
 * Android, Samsung Internet, Opera), Mozilla (Firefox), Apple (Safari) or
 * Microsoft (Edge). Anything else is refused, so DooFah never sends to an
 * address someone made up.
 */
export function isPushServiceUrl(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
  const host = url.hostname;
  return (
    host === "fcm.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    host.endsWith(".push.apple.com") ||
    host.endsWith(".notify.windows.com")
  );
}

// p256dh is a 65-byte public key (87 base64url characters), auth 16 bytes (22); some browsers add padding.
const P256DH = /^[A-Za-z0-9_-]{86,88}={0,2}$/;
const AUTH = /^[A-Za-z0-9_-]{21,24}={0,2}$/;

const isRounded = (n: number) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;

function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The subscription as sent by the browser, or why it can't be kept. */
export function readSubscription(value: unknown): SavedSubscription | string {
  if (!isObject(value) || typeof value.endpoint !== "string") return "No subscription";
  const { endpoint, keys } = value;
  if (endpoint.length > MAX_ENDPOINT_LENGTH || !isPushServiceUrl(endpoint)) return "Not a push service address";
  if (!isObject(keys) || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return "No keys";
  if (!P256DH.test(keys.p256dh) || !AUTH.test(keys.auth)) return "Malformed keys";
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function readPlace(value: unknown): PushPlace | string {
  if (!isObject(value)) return "Not a place";
  const { ref, name, lat, lon } = value;
  if (typeof ref !== "string" || !PLACE_REF.test(ref)) return "Bad place ref";
  if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME_LENGTH) return "Bad place name";
  if (typeof lat !== "number" || typeof lon !== "number" || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return "Bad coordinates";
  }
  // The phone rounds before sending; anything finer is refused rather than kept.
  if (!isRounded(lat) || !isRounded(lon)) return "Coordinates must be rounded to 0.1°";
  return { ref, name: name.trim(), lat, lon };
}

/** Everything the phone sends, checked, as the record to keep, or why it can't be kept. */
export function readRecord(body: unknown, now: number): PushRecord | string {
  if (!isObject(body)) return "Not JSON";
  const subscription = readSubscription(body.subscription);
  if (typeof subscription === "string") return subscription;
  const { places, lang, timeZone } = body;
  if (!Array.isArray(places) || !places.length || places.length > MAX_PLACES) {
    return `Between 1 and ${MAX_PLACES} places`;
  }
  const read = places.map(readPlace);
  const problem = read.find((p): p is string => typeof p === "string");
  if (problem) return problem;
  if (!isLocale(lang)) return "Unknown language";
  if (!isTimeZone(timeZone)) return "Unknown time zone";
  return { subscription, places: read as PushPlace[], lang, timeZone, savedAt: new Date(now).toISOString() };
}
