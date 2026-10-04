/**
 * The link in a storm notification: `/?storm=<id>&place=<ref>`. Tapping it
 * opens DooFah on the saved place the alert was about, with the storm on the
 * map (see public/sw.js and DooFahDashboard).
 *
 * The place is named by a short hash of its id, never the id itself, because
 * a GPS place's id is its exact spot ("pt@13.756,100.502") and the link
 * travels through Google's, Apple's or Mozilla's push service.
 */

/** A warning centre's storm number, e.g. "27W". */
export const STORM_ID = /^[A-Za-z0-9-]{1,16}$/;
/** The first 8 hex digits of SHA-256(place id). */
export const PLACE_REF = /^[0-9a-f]{8}$/;

export async function placeRef(id: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return [...new Uint8Array(hash).slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function stormLink(stormId: string, ref: string | null): string {
  const params = new URLSearchParams({ storm: stormId });
  if (ref) params.set("place", ref);
  return `/?${params}`;
}

/** What a tapped notification asks the dashboard to open, from the page's search params. */
export interface StormLink {
  stormId: string;
  placeRef: string | null;
}

export function readStormLink(storm: unknown, place: unknown): StormLink | undefined {
  if (typeof storm !== "string" || !STORM_ID.test(storm)) return undefined;
  return { stormId: storm, placeRef: typeof place === "string" && PLACE_REF.test(place) ? place : null };
}
