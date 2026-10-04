/**
 * Storm alerts on this device, from the browser's side: whether push can work
 * here, asking permission, subscribing with DooFah's VAPID public key, and
 * sending the subscription with the places to watch to /api/push/subscribe.
 * public/sw.js shows the notifications; src/services/push/http.ts keeps them.
 */

import type { Locale } from "@/i18n/config";
import { placeRef } from "@/lib/pushLink";
import type { PushPlace } from "@/services/push/subscription";
import type { GeoPoint } from "@/services/weather/types";

export type { PushPlace };

/**
 * - `hidden`: push can't work here (no key, a development build, an older browser), so there is no bell.
 * - `install`: iPhone or iPad in a Safari tab; push needs DooFah on the Home Screen.
 * - `ask`: not on yet (never asked, or allowed but not subscribed).
 * - `denied`: the browser's permission was refused.
 * - `on`: subscribed, and the server has this device's places.
 */
export type PushState = "hidden" | "install" | "ask" | "denied" | "on";

export type TestResult = "sent" | "wait" | "gone" | "failed";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
/** The server's limits (src/services/push/subscription.ts), repeated so this file stays out of server code. */
export const MAX_PLACES = 10;
export const MAX_NAME_LENGTH = 40;
/** The day and what was last sent, so the record is sent again only when it changed, and once a day. */
const SYNCED_KEY = "doofah-push-synced";
/** Until when the banner's link and the first-star prompt stay hidden after "Not now". */
const LATER_KEY = "doofah-push-later";
export const LATER_MS = 30 * 86_400_000;
const DAY_MS = 86_400_000;
/** The worker is registered on load; if it never becomes ready, turning on fails instead of spinning forever. */
const READY_TIMEOUT_MS = 10_000;

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isHomeScreenApp = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

async function currentSubscription(): Promise<PushSubscription | null> {
  // getRegistration, not `ready`: `ready` never settles where no worker is registered.
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  // public/sw.js is only registered in production builds (src/lib/pwa.ts).
  if (!PUBLIC_KEY || process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return "hidden";
  if (!("PushManager" in window) || !("Notification" in window)) {
    return isIos() && !isHomeScreenApp() ? "install" : "hidden";
  }
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && (await currentSubscription()) ? "on" : "ask";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Cut to the server's length without splitting an emoji in half. */
const shortName = (name: string) =>
  name
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[\uD800-\uDBFF]$/, "");

/**
 * The places as they leave the phone: at most 10, rounded to 0.1° (about
 * 11 km, enough for a 500 km storm alert and too coarse to point at a house),
 * and named by a hash of their id, since a GPS place's id is its exact spot.
 */
export function pushPlaces(places: readonly { id: string; name: string; point: GeoPoint }[]): Promise<PushPlace[]> {
  return Promise.all(
    places.slice(0, MAX_PLACES).map(async (p) => {
      const lat = round1(p.point.lat);
      const lon = round1(p.point.lon);
      return { ref: await placeRef(p.id), name: shortName(p.name) || `${lat}, ${lon}`, lat, lon };
    }),
  );
}

/** VAPID keys are base64url; PushManager wants the bytes. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** What a sync sends, with the day, so an unchanged record is sent again only once a day. */
export function syncStamp(endpoint: string, places: PushPlace[], lang: Locale, timeZone: string, now: number) {
  return `${Math.floor(now / DAY_MS)}|${JSON.stringify([endpoint, places, lang, timeZone])}`;
}

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the record is sent on every open instead, and "Not now" lasts this visit.
  }
}

async function save(subscription: PushSubscription, places: PushPlace[], lang: Locale) {
  const zone = timeZone();
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON(), places, lang, timeZone: zone }),
  });
  if (!response.ok) throw new Error(`Storm alerts not saved: ${response.status}`);
  write(SYNCED_KEY, syncStamp(subscription.endpoint, places, lang, zone, Date.now()));
}

function workerReady(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("No service worker")), READY_TIMEOUT_MS)),
  ]);
}

/**
 * Call straight from the tap: the permission prompt must be the first thing
 * awaited, or iPhones refuse to show it. Throws when the server didn't keep
 * the subscription, which is then dropped again so the state stays "ask".
 */
export async function turnOn(places: PushPlace[], lang: Locale): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "ask";
  const registration = await workerReady();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY!) }));
  try {
    await save(subscription, places, lang);
  } catch (error) {
    if (!existing) await subscription.unsubscribe().catch(() => undefined);
    throw error;
  }
  return "on";
}

/**
 * Deletes the record on the server, then unsubscribes. Throws, leaving alerts
 * on, when the server couldn't delete it: the card promises it is deleted.
 */
export async function turnOff(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  // The server first: once unsubscribed, the browser no longer knows the address to delete.
  const response = await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) throw new Error(`Storm alerts not deleted: ${response.status}`);
  await subscription.unsubscribe();
  write(SYNCED_KEY, null);
}

/**
 * While alerts are on: sends the record again when the places, language or
 * time zone changed, and at least once a day, so the server's 60-day expiry
 * only drops phones that stopped opening DooFah.
 */
export async function sync(places: PushPlace[], lang: Locale): Promise<void> {
  if (!places.length || Notification.permission !== "granted") return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  if (read(SYNCED_KEY) === syncStamp(subscription.endpoint, places, lang, timeZone(), Date.now())) return;
  await save(subscription, places, lang);
}

/** One test notification. A record the server no longer has (expired) is sent again first. */
export async function sendTest(places: PushPlace[], lang: Locale): Promise<TestResult> {
  const subscription = await currentSubscription();
  if (!subscription) return "gone";
  const post = () =>
    fetch("/api/push/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  let response = await post();
  if (response.status === 404) {
    await save(subscription, places, lang);
    response = await post();
  }
  if (response.ok) return "sent";
  if (response.status === 429) return "wait";
  if (response.status === 410) {
    // The push service has dropped this subscription; the server already forgot it.
    await subscription.unsubscribe().catch(() => undefined);
    write(SYNCED_KEY, null);
    return "gone";
  }
  return "failed";
}

/** Whether "Not now" was tapped in the last 30 days. */
export function isSnoozed(now = Date.now()): boolean {
  const until = Number(read(LATER_KEY));
  return Number.isFinite(until) && until > now;
}

export function snooze(now = Date.now()) {
  write(LATER_KEY, String(now + LATER_MS));
}
