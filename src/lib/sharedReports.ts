/**
 * Everyone's weather reports, shared through DooFah's server (/api/reports,
 * kept in Supabase): what the page asks for and what comes back, shared by
 * the page and the server so both name the same pieces.
 *
 * The map asks by tile, not by its exact view: a tile is a square of SIZE
 * degrees counted from 0° N 0° E, so everyone looking at the same area asks
 * for the same few tiles, and Vercel's edge answers most of them without
 * asking Supabase. The tile size follows the view, so a view takes at most
 * 3 × 3 tiles. A tile with more than MAX_POINTS live reports comes back
 * counted per cell instead, so a whole country stays one small answer.
 */

import type { ReportKind } from "./crowdReports";
import type { GeoBounds } from "@/services/weather/types";

/** Reports leave the shared map 3 hours after they are made (supabase/migrations: crowd_report_ttl). */
export const SHARED_REPORT_TTL_MS = 3 * 3_600_000;

/** Tile sides, degrees, smallest first: each divides 90 and 180, so tiles meet the poles and the date line. */
export const TILE_SIZES = [0.25, 1, 5, 15] as const;
export type TileSize = (typeof TILE_SIZES)[number];

/** Most reports one tile sends one by one; above this they are counted per cell. */
export const MAX_POINTS = 200;
/** Cells per tile side when a tile's reports are counted. */
export const CELLS_PER_SIDE = 16;

export interface ReportTile {
  size: TileSize;
  /** Tile row (northwards) and column (eastwards) from 0° N 0° E. */
  row: number;
  col: number;
}

/** Someone's report, as the server sends it. Its spot is rounded to about 1 km. */
export interface SharedReport {
  id: string;
  kind: ReportKind;
  lat: number;
  lon: number;
  /** ISO time it was made, by the server's clock. */
  time: string;
}

/** Reports counted together: the cell's average spot, how many of each kind, and when the newest was made. */
export interface ReportCell {
  lat: number;
  lon: number;
  count: number;
  kinds: Record<ReportKind, number>;
  newest: string;
}

/** One tile's live reports: one by one, or counted per cell when there are many (one of the two is empty). */
export interface TileReports {
  reports: SharedReport[];
  cells: ReportCell[];
}

export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** The tile as it is written in a request: "size,row,col". */
export const tileKey = ({ size, row, col }: ReportTile) => `${size},${row},${col}`;

export const isTileSize = (value: number): value is TileSize => (TILE_SIZES as readonly number[]).includes(value);

/** Whether a tile lies on the globe (the server answers no other). */
export function tileAllowed({ size, row, col }: ReportTile): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row * size >= -90 &&
    (row + 1) * size <= 90 &&
    col * size >= -180 &&
    (col + 1) * size <= 180
  );
}

export function parseTile(text: string | null): ReportTile | null {
  const parts = (text ?? "").split(",");
  if (parts.length !== 3 || !parts.every((p) => /^-?\d{1,5}(\.\d{1,2})?$/.test(p))) return null;
  const [size, row, col] = parts.map(Number);
  const tile = { size, row, col } as ReportTile;
  return isTileSize(size) && tileAllowed(tile) ? tile : null;
}

export const tileBox = ({ size, row, col }: ReportTile): Box => ({
  west: col * size,
  south: row * size,
  east: (col + 1) * size,
  north: (row + 1) * size,
});

/** The cell side a tile's reports are counted in, degrees. */
export const cellSize = (tile: ReportTile) => tile.size / CELLS_PER_SIDE;

/** The middle of a view this many degrees a side, at most, gets reports. */
const MAX_SPAN = 2 * TILE_SIZES[TILE_SIZES.length - 1];

/** The tiles covering a view: the smallest size that takes at most 3 × 3 of them. */
export function tilesFor([[south, west], [north, east]]: GeoBounds): ReportTile[] {
  // Zoomed out further, the middle of the view gets reports, so a whole-world view stays 9 tiles.
  const midLat = (south + north) / 2;
  const midLon = (west + east) / 2;
  const halfLat = Math.min(north - south, MAX_SPAN) / 2;
  const halfLon = Math.min(east - west, MAX_SPAN) / 2;
  const s = Math.max(-90, midLat - halfLat);
  const n = Math.min(90, midLat + halfLat);
  // The map runs on past the date line; reports stop at it.
  const w = Math.max(-180, midLon - halfLon);
  const e = Math.min(180, midLon + halfLon);
  if (!(n > s && e > w)) return [];
  const size = TILE_SIZES.find((t) => Math.max(n - s, e - w) <= 2 * t) ?? TILE_SIZES[TILE_SIZES.length - 1];
  const tiles: ReportTile[] = [];
  const last = (edge: number) => Math.ceil(edge / size) - 1;
  for (let row = Math.floor(s / size); row <= last(n); row++) {
    for (let col = Math.floor(w / size); col <= last(e); col++) tiles.push({ size, row, col });
  }
  return tiles.filter(tileAllowed);
}
