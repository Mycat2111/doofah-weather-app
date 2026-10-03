/**
 * Where and when the map's live layers are sampled, shared by the page and
 * DooFah's server so both name the same pieces.
 *
 * - **Where.** Points every `spacing` degrees, counted from 0° N 0° E, so
 *   every view reuses the same points. The spacing follows the view: about
 *   a dozen points across it, from 0.125° (14 km) close in to 4° (445 km)
 *   for the whole region. Points come in square tiles of TILE a side, and a
 *   tile is the unit asked for and kept.
 * - **When.** The day is cut into 6-hour slots, about when each ECMWF run
 *   becomes available. A tile is fetched once per slot and carries the hours
 *   any moment in the slot needs: the timeline's 3 hours back to a day ahead.
 *
 * Each point is one call of Open-Meteo's quota, so keeping tiles for a whole
 * slot and the points per view low keeps the map within the free limits.
 */

import { HOUR_MS } from "../weathernext3/time";
import type { GeoBounds } from "../weathernext3/types";

/** Lattice spacings, degrees, finest first. ECMWF's own grid is about 0.1°. */
export const SPACINGS = [0.125, 0.25, 0.5, 1, 2, 4] as const;
export type Spacing = (typeof SPACINGS)[number];

/** Points per tile side. */
export const TILE = 6;

/** About this many points across the view's longer side, at most. */
const ACROSS = 12;

/**
 * The most of a view that gets layers, degrees: wide enough for the monsoon
 * from the Bay of Bengal to the South China Sea, or a typhoon on its way in.
 * Zoomed out further, the middle of the view is drawn, so a whole-world view
 * never asks for thousands of points.
 */
export const MAX_VIEW = { lat: 40, lon: 50 };
/** Latitudes beyond this aren't asked for (the map's projection stretches them anyway). */
const MAX_LAT = 75;

export const SLOT_MS = 6 * HOUR_MS;
/** Slots start at 02, 08, 14 and 20 UTC, a couple of hours after each ECMWF run's time. */
const SLOT_OFFSET_MS = 2 * HOUR_MS;
/** Hours before and after the current hour the map's timeline shows. */
export const PAST_HOURS = 3;
export const AHEAD_HOURS = 24;

/** The slot `now` falls in: its start, ms. */
export const slotOf = (now: number) => Math.floor((now - SLOT_OFFSET_MS) / SLOT_MS) * SLOT_MS + SLOT_OFFSET_MS;

/** The slot as it is written in a request: "2026-10-03T08". */
export const slotKey = (slot: number) => new Date(slot).toISOString().slice(0, 13);

export function parseSlot(key: string | null): number | null {
  if (!key || !/^\d{4}-\d\d-\d\dT\d\d$/.test(key)) return null;
  const ms = Date.parse(`${key}:00:00Z`);
  return Number.isFinite(ms) && slotOf(ms) === ms ? ms : null;
}

/**
 * The hours a tile carries for its slot: 3 hours before the slot starts to a
 * day after it ends, so every moment in the slot finds the timeline's hours.
 */
export function slotHours(slot: number): { start: number; end: number } {
  return { start: slot - PAST_HOURS * HOUR_MS, end: slot + SLOT_MS + AHEAD_HOURS * HOUR_MS };
}

/** The part of a view that gets layers: all of it, or its middle MAX_VIEW when zoomed out further. */
export function fieldView([[s, w], [n, e]]: GeoBounds): GeoBounds {
  const midLat = (s + n) / 2;
  const midLon = (w + e) / 2;
  const halfLat = Math.min(n - s, MAX_VIEW.lat) / 2;
  const halfLon = Math.min(e - w, MAX_VIEW.lon) / 2;
  return [
    [Math.max(-MAX_LAT, midLat - halfLat), midLon - halfLon],
    [Math.min(MAX_LAT, midLat + halfLat), midLon + halfLon],
  ];
}

/** The spacing for a view: the finest that keeps about a dozen points across it. */
export function spacingFor([[s, w], [n, e]]: GeoBounds): Spacing {
  const span = Math.max(n - s, e - w);
  return SPACINGS.find((spacing) => span / spacing <= ACROSS) ?? SPACINGS[SPACINGS.length - 1];
}

export interface TileId {
  spacing: Spacing;
  /** Tile row (northwards) and column (eastwards) from 0° N 0° E. */
  row: number;
  col: number;
}

/** The tile as it is written in a request: "row,col". */
export const tileKey = ({ row, col }: TileId) => `${row},${col}`;

/**
 * Lattice indices covered by a tile: rows of points from south to north, and
 * columns from west to east. Point (i, j) sits at i·spacing °N, j·spacing °E.
 */
export function tileIndices({ row, col }: TileId) {
  return { i0: row * TILE, i1: row * TILE + TILE - 1, j0: col * TILE, j1: col * TILE + TILE - 1 };
}

/** A longitude between −180° and 180° (the map runs on past the date line). */
const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** The tile's points, north row first, each row west to east: the order of its values. */
export function tilePoints(tile: TileId): { lat: number; lon: number }[] {
  const { i0, i1, j0, j1 } = tileIndices(tile);
  const points: { lat: number; lon: number }[] = [];
  for (let i = i1; i >= i0; i--) {
    for (let j = j0; j <= j1; j++) points.push({ lat: i * tile.spacing, lon: wrapLon(j * tile.spacing) });
  }
  return points;
}

/** Lattice indices of the points needed to draw `bounds` (one point beyond each edge). */
export function latticeRange([[s, w], [n, e]]: GeoBounds, spacing: Spacing) {
  return {
    i0: Math.floor(s / spacing) - 1,
    i1: Math.ceil(n / spacing) + 1,
    j0: Math.floor(w / spacing) - 1,
    j1: Math.ceil(e / spacing) + 1,
  };
}

/** The tiles holding the points needed for `bounds` (a fieldView). */
export function tilesFor(bounds: GeoBounds, spacing: Spacing): TileId[] {
  const { i0, i1, j0, j1 } = latticeRange(bounds, spacing);
  const tiles: TileId[] = [];
  for (let row = Math.floor(i0 / TILE); row <= Math.floor(i1 / TILE); row++) {
    for (let col = Math.floor(j0 / TILE); col <= Math.floor(j1 / TILE); col++) tiles.push({ spacing, row, col });
  }
  return tiles;
}

/** Whether a tile is one a view can ask for (the server answers no other). */
export function tileAllowed(tile: TileId): boolean {
  const { i0, i1, j0, j1 } = tileIndices(tile);
  const { spacing } = tile;
  const limit = MAX_LAT + TILE * spacing;
  return (
    i0 * spacing >= -limit && i1 * spacing <= limit && Math.abs(j0 * spacing) <= 540 && Math.abs(j1 * spacing) <= 540
  );
}

export const isSpacing = (value: number): value is Spacing => (SPACINGS as readonly number[]).includes(value);
