import { distanceKm, PLACES } from "@/services/weather/places";
import type { GeoPoint, Place } from "@/services/weather/types";

/** Quick labels offered when naming a favorite. Shown in the reader's language. */
export const FAVORITE_KINDS = ["home", "office"] as const;
export type FavoriteKind = (typeof FAVORITE_KINDS)[number];

export interface Favorite {
  place: Place;
  /** A name the reader typed, e.g. "Mum's house". Wins over `kind`. */
  name?: string;
  /** Picked from the quick labels, so it follows the UI language. */
  kind?: FavoriteKind;
  /** ISO time it was starred. */
  savedAt: string;
}

export const FAVORITES_KEY = "doofah-favorites";
const VERSION = 1;
const MAX_NAME_LENGTH = 40;

/**
 * Two places count as the same favorite when they share an id, or when they
 * are within 1 km: "Use my location" returns slightly different coordinates
 * each time, and a located spot in central Bangkok is still Bangkok.
 */
const SAME_PLACE_KM = 1;

export function isSamePlace(a: Place, b: Place): boolean {
  return a.id === b.id || distanceKm(a.point, b.point) < SAME_PLACE_KM;
}

export function findFavorite(favorites: readonly Favorite[], place: Place): Favorite | undefined {
  return favorites.find((f) => f.place.id === place.id) ?? favorites.find((f) => isSamePlace(f.place, place));
}

/* ------------------------------------------------------------------ */
/* Pure list operations                                                */
/* ------------------------------------------------------------------ */

export function addFavorite(favorites: readonly Favorite[], place: Place, now = new Date()): Favorite[] {
  if (findFavorite(favorites, place)) return [...favorites];
  return [...favorites, { place, savedAt: now.toISOString() }];
}

export function removeFavorite(favorites: readonly Favorite[], place: Place): Favorite[] {
  const match = findFavorite(favorites, place);
  return favorites.filter((f) => f !== match);
}

export function renameFavorite(
  favorites: readonly Favorite[],
  place: Place,
  change: { name?: string; kind?: FavoriteKind | null },
): Favorite[] {
  const match = findFavorite(favorites, place);
  return favorites.map((f) => {
    if (f !== match) return f;
    const next: Favorite = { ...f };
    if ("name" in change) {
      const name = change.name?.slice(0, MAX_NAME_LENGTH);
      if (name?.trim()) next.name = name;
      else delete next.name;
    }
    if ("kind" in change) {
      if (change.kind) next.kind = change.kind;
      else delete next.kind;
    }
    return next;
  });
}

/* ------------------------------------------------------------------ */
/* Storage format                                                      */
/* ------------------------------------------------------------------ */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isPoint = (v: unknown): v is GeoPoint =>
  isObject(v) && Number.isFinite(v.lat) && Number.isFinite(v.lon) && Math.abs(v.lat as number) <= 90;

function isStoredPlace(v: unknown): v is Place {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.country === "string" &&
    typeof v.timeZone === "string" &&
    isPoint(v.point)
  );
}

/**
 * Catalog places are rebuilt from the current catalog, so a renamed city or
 * new Thai name shows up; the saved id and point are kept.
 */
function refreshPlace(place: Place): Place {
  const catalog = PLACES.find((p) => p.id === place.id.split("@")[0]);
  return catalog ? { ...catalog, id: place.id, point: place.point } : place;
}

/** Reads the saved list, dropping anything malformed instead of failing. */
export function parseFavorites(raw: string | null): Favorite[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isObject(data) || !Array.isArray(data.favorites)) return [];
  const favorites: Favorite[] = [];
  for (const item of data.favorites) {
    if (!isObject(item) || !isStoredPlace(item.place)) continue;
    const place = refreshPlace(item.place);
    if (findFavorite(favorites, place)) continue;
    const favorite: Favorite = {
      place,
      savedAt: typeof item.savedAt === "string" ? item.savedAt : new Date(0).toISOString(),
    };
    if (typeof item.name === "string" && item.name.trim()) favorite.name = item.name.slice(0, MAX_NAME_LENGTH);
    if (FAVORITE_KINDS.includes(item.kind as FavoriteKind)) favorite.kind = item.kind as FavoriteKind;
    favorites.push(favorite);
  }
  return favorites;
}

export function serializeFavorites(favorites: readonly Favorite[]): string {
  return JSON.stringify({ version: VERSION, favorites });
}

/* ------------------------------------------------------------------ */
/* Where the app opens                                                 */
/* ------------------------------------------------------------------ */

/** The place on screen when the app was last used, so it can reopen there. */
export const LAST_PLACE_KEY = "doofah-last-place";

/**
 * The place to open with: the favorite you were looking at last time, else
 * the one named Home, else the first in the bar. Undefined with no favorites.
 */
export function openingPlace(favorites: readonly Favorite[], lastPlace?: Place | null): Place | undefined {
  const last = lastPlace ? findFavorite(favorites, lastPlace) : undefined;
  return (last ?? favorites.find((f) => f.kind === "home") ?? favorites[0])?.place;
}

export function parseLastPlace(raw: string | null): Place | null {
  if (!raw) return null;
  try {
    const place: unknown = JSON.parse(raw);
    return isStoredPlace(place) ? place : null;
  } catch {
    return null;
  }
}

let opening: { place: Place | undefined } | null = null;

/**
 * The opening place for this visit, read once in the browser so the app does
 * not jump somewhere else later (for example after a favorite is removed).
 */
export function readOpeningPlace(): Place | undefined {
  if (!opening) {
    let last: Place | null = null;
    try {
      last = parseLastPlace(window.localStorage.getItem(LAST_PLACE_KEY));
    } catch {
      // Storage blocked: fall back to Home or the first favorite.
    }
    opening = { place: openingPlace(favoritesStore.getSnapshot(), last) };
  }
  return opening.place;
}

export function saveLastPlace(place: Place) {
  try {
    window.localStorage.setItem(LAST_PLACE_KEY, JSON.stringify(place));
  } catch {
    // Not remembered when storage is full or blocked; the app still opens on a favorite.
  }
}

/* ------------------------------------------------------------------ */
/* Browser store (for useSyncExternalStore)                            */
/* ------------------------------------------------------------------ */

const EMPTY: Favorite[] = [];
const listeners = new Set<() => void>();
let current: Favorite[] | null = null;

function load(): Favorite[] {
  try {
    return parseFavorites(window.localStorage.getItem(FAVORITES_KEY));
  } catch {
    // Storage can be blocked (private mode, strict cookie settings).
    return EMPTY;
  }
}

function onStorage(event: StorageEvent) {
  // Another tab changed the list (or cleared all storage).
  if (event.key !== null && event.key !== FAVORITES_KEY) return;
  current = parseFavorites(event.newValue);
  listeners.forEach((listener) => listener());
}

export const favoritesStore = {
  subscribe(listener: () => void) {
    if (listeners.size === 0) window.addEventListener("storage", onStorage);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot(): Favorite[] {
    current ??= load();
    return current;
  },
  /** Nothing is stored on the server, so the first render has no favorites. */
  getServerSnapshot(): Favorite[] {
    return EMPTY;
  },
  update(change: (favorites: Favorite[]) => Favorite[]) {
    current = change(favoritesStore.getSnapshot());
    try {
      window.localStorage.setItem(FAVORITES_KEY, serializeFavorites(current));
    } catch {
      // Still works for this visit when storage is full or blocked.
    }
    listeners.forEach((listener) => listener());
  },
};
