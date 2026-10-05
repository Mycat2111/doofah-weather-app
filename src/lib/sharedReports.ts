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

import { distanceKm } from "@/services/weather/places";
import type { GeoBounds, GeoPoint } from "@/services/weather/types";
import { REPORT_KINDS, type CrowdReport, type ReportKind } from "./crowdReports";

// Reports leave the shared map after REPORT_TTL_MS (crowdReports.ts), as Supabase's crowd_report_ttl() says.

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

const KM_PER_DEGREE = 111.32;

/** A box reaching `km` from `point` each way, for the reports around a place. */
export function boundsAround({ lat, lon }: GeoPoint, km: number): GeoBounds {
  const dLat = km / KM_PER_DEGREE;
  const dLon = km / (KM_PER_DEGREE * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return [
    [lat - dLat, lon - dLon],
    [lat + dLat, lon + dLon],
  ];
}

/** Several tiles' answers as one. A report right on a tile's edge comes back from both tiles. */
export function mergeTiles(answers: TileReports[]): TileReports {
  const seen = new Set<string>();
  const reports = answers.flatMap((a) => a.reports).filter((r) => !seen.has(r.id) && !!seen.add(r.id));
  return { reports, cells: answers.flatMap((a) => a.cells) };
}

/** Everyone's reports as the page shows them, without this device's own, which show from its storage. */
export function othersOf(shared: SharedReport[], mine: CrowdReport[]): CrowdReport[] {
  const own = new Set(mine.flatMap((r) => r.serverIds ?? []));
  return shared
    .filter((r) => !own.has(r.id))
    .map((r) => ({ id: `s${r.id}`, kind: r.kind, point: { lat: r.lat, lon: r.lon }, time: r.time, mine: false }));
}

/** How many other people's reports are within `radiusKm` of `center`: one by one, and counted cells by their spot. */
export const countNear = (others: CrowdReport[], cells: ReportCell[], center: GeoPoint, radiusKm: number) =>
  others.filter((r) => distanceKm(center, r.point) <= radiusKm).length +
  cells.filter((c) => distanceKm(center, c) <= radiusKm).reduce((sum, c) => sum + c.count, 0);

/** The kind most of a cell's reports say; rain wins a tie, since that's what people need to know. */
export const cellKind = (cell: ReportCell): ReportKind =>
  [...REPORT_KINDS].reverse().reduce((best, kind) => (cell.kinds[kind] > cell.kinds[best] ? kind : best));

/** Pixels a bubble is moved from its spot. */
export type Offset = readonly [number, number];
export const AT_SPOT: Offset = [0, 0];
/** Directions round a spot, degrees clockwise from east, leaving out the top right, where your own bubble sits. */
const SLOTS = [180, 135, 90, 45, 0, -135];

/**
 * Where other people's bubbles go when several share a spot. Everyone
 * looking at a city reports from its centre (spots are also rounded to
 * about 1 km), so those bubbles go round the spot instead of on top of each
 * other, newest first, and clear of the "you are here" pin at the place.
 */
export function spread(reports: CrowdReport[], center: GeoPoint | undefined): Map<string, Offset> {
  const spot = (p: GeoPoint) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const groups = new Map<string, CrowdReport[]>();
  for (const r of reports) if (!r.mine) groups.set(spot(r.point), [...(groups.get(spot(r.point)) ?? []), r]);
  const offsets = new Map<string, Offset>();
  for (const [key, group] of groups) {
    const ring = [...group].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    // Away from the place's pin, the newest stays on the spot itself.
    if (!center || key !== spot(center)) offsets.set(ring.shift()!.id, AT_SPOT);
    ring.forEach((r, k) => {
      const lap = Math.floor(k / SLOTS.length);
      const angle = (SLOTS[k % SLOTS.length] + (lap % 2) * 22.5) * (Math.PI / 180);
      const radius = 30 + lap * 16;
      offsets.set(r.id, [Math.round(radius * Math.cos(angle)), Math.round(radius * Math.sin(angle))]);
    });
  }
  return offsets;
}
