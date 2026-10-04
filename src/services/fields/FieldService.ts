/**
 * The map's live layers in the page: the tiles over the view from
 * /api/fields (ECMWF), put together into the hourly frames the map draws,
 * the same shape the simulation gives, so the map, its timeline and the
 * frames between hours work the same for both.
 *
 * Every tile carries all the layers, so switching layers or panning back
 * reuses tiles already here and draws at once.
 */

import { floorToHour, HOUR_MS } from "../weather/time";
import type {
  FieldModel,
  RadarFrame,
  RadarFrameSet,
  RadarGridSpec,
  RadarLayerType,
  RadarRequest,
} from "../weather/types";
import type { FieldTile } from "./ecmwfFields";
import {
  AHEAD_HOURS,
  fieldView,
  latticeRange,
  PAST_HOURS,
  slotKey,
  slotOf,
  spacingFor,
  TILE,
  tileKey,
  tilesFor,
  type TileId,
} from "./lattice";

/** Tiles asked for at once. */
const AT_ONCE = 4;
/** Tiles kept in the page; the oldest go first. */
const KEPT = 160;
const TIMEOUT_MS = 20_000;
const KM_PER_DEGREE = 111.32;

export class FieldError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FieldError";
  }
}

export interface FieldServiceOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

const MODEL: FieldModel = { model: "ECMWF", runInitTime: null, spatialResolutionKm: 9, simulated: false };

export class FieldService {
  private readonly tiles = new Map<string, Promise<FieldTile>>();
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(options: FieldServiceOptions = {}) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  /** The address of a tile for a slot. */
  static url(tile: TileId, slot: number): string {
    return `/api/fields?spacing=${tile.spacing}&tile=${tileKey(tile)}&slot=${slotKey(slot)}`;
  }

  /** One layer over the area in view, 3 hours back to a day ahead, every hour. */
  async getRadarFrames<L extends RadarLayerType>(request: RadarRequest<L>): Promise<RadarFrameSet<L>> {
    const now = this.now();
    const view = fieldView(request.bounds);
    const spacing = spacingFor(view);
    const slot = slotOf(now);
    const ids = tilesFor(view, spacing);
    const tiles = new Map<string, FieldTile>();
    for (let i = 0; i < ids.length; i += AT_ONCE) {
      const batch = ids.slice(i, i + AT_ONCE);
      const got = await Promise.all(batch.map((id) => this.tile(id, slot)));
      batch.forEach((id, k) => tiles.set(tileKey(id), got[k]));
    }
    return framesFrom(request.layer, view, spacing, tiles, floorToHour(now), request);
  }

  private tile(id: TileId, slot: number): Promise<FieldTile> {
    const url = FieldService.url(id, slot);
    let promise = this.tiles.get(url);
    if (!promise) {
      promise = this.load(url);
      this.tiles.set(url, promise);
      promise.catch(() => this.tiles.delete(url));
      while (this.tiles.size > KEPT) this.tiles.delete(this.tiles.keys().next().value!);
    }
    return promise;
  }

  private async load(url: string): Promise<FieldTile> {
    let response: Response;
    try {
      response = await this.fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new FieldError("The map layers could not be reached", 0);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { reason?: string } | null;
      throw new FieldError(body?.reason ?? `The map layers answered ${response.status}`, response.status);
    }
    return (await response.json()) as FieldTile;
  }
}

type Variable = "rain" | "cloud" | "temperature" | "pressure" | "wind_u" | "wind_v";

/**
 * The frames of one layer from the tiles over `view`: a grid with a cell
 * centred on each lattice point (row 0 the northernmost), every hour from
 * PAST_HOURS before `hour` to AHEAD_HOURS after it.
 */
export function framesFrom<L extends RadarLayerType>(
  layer: L,
  view: RadarRequest["bounds"],
  spacing: number,
  tiles: Map<string, FieldTile>,
  hour: number,
  request: Pick<RadarRequest, "fromOffsetHours" | "toOffsetHours"> = {},
): RadarFrameSet<L> {
  const { i0, i1, j0, j1 } = latticeRange(view, spacing as TileId["spacing"]);
  const rows = i1 - i0 + 1;
  const cols = j1 - j0 + 1;
  const n = rows * cols;
  const half = spacing / 2;
  const grid: RadarGridSpec = {
    bounds: [
      [i0 * spacing - half, j0 * spacing - half],
      [i1 * spacing + half, j1 * spacing + half],
    ],
    rows,
    cols,
    latStep: spacing,
    lonStep: spacing,
    cellSizeKm: Math.round(spacing * KM_PER_DEGREE),
  };

  // Where each cell's values sit: its tile, and its place in the tile's lists.
  const sources = new Array<{ tile: FieldTile; p: number } | null>(n);
  for (let r = 0; r < rows; r++) {
    const i = i1 - r;
    const tileRow = Math.floor(i / TILE);
    for (let c = 0; c < cols; c++) {
      const j = j0 + c;
      const tileCol = Math.floor(j / TILE);
      const tile = tiles.get(`${tileRow},${tileCol}`);
      sources[r * cols + c] = tile
        ? { tile, p: (TILE - 1 - (i - tileRow * TILE)) * TILE + (j - tileCol * TILE) }
        : null;
    }
  }

  const values = (name: Variable, k: (tile: FieldTile) => number, scale = 1) => {
    const out = new Float32Array(n);
    for (let x = 0; x < n; x++) {
      const s = sources[x];
      const v = s ? s.tile[name][k(s.tile) * s.tile.size * s.tile.size + s.p] : null;
      out[x] = v === null || v === undefined ? Number.NaN : v * scale;
    }
    return out;
  };

  const from = -Math.min(PAST_HOURS, Math.abs(request.fromOffsetHours ?? PAST_HOURS));
  const to = Math.min(AHEAD_HOURS, request.toOffsetHours ?? AHEAD_HOURS);
  const frames: RadarFrame[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (let offset = from; offset <= to; offset++) {
    const time = hour + offset * HOUR_MS;
    const k = (tile: FieldTile) => (time - tile.start) / HOUR_MS;
    // Every tile of a slot starts at the same hour; a missing hour leaves the frame out.
    const first = sources.find(Boolean)?.tile;
    if (!first || k(first) < 0 || k(first) >= first.hours) continue;
    const base = {
      time: new Date(time).toISOString(),
      offsetHours: offset,
      kind: offset <= 0 ? "analysis" : "forecast",
    } as const;
    let frame: RadarFrame;
    let primary: Float32Array;
    switch (layer) {
      case "precipitation": {
        const rate = values("rain", k);
        frame = { ...base, layer: "precipitation", rate, cloud: values("cloud", k, 0.01) };
        primary = rate;
        break;
      }
      case "clouds": {
        const cover = values("cloud", k);
        frame = { ...base, layer: "clouds", cover };
        primary = cover;
        break;
      }
      case "temperature": {
        const temperature = values("temperature", k);
        frame = { ...base, layer: "temperature", temperature };
        primary = temperature;
        break;
      }
      case "pressure": {
        const pressure = values("pressure", k);
        frame = { ...base, layer: "pressure", pressure };
        primary = pressure;
        break;
      }
      default: {
        const u = values("wind_u", k);
        const v = values("wind_v", k);
        const speed = new Float32Array(n);
        for (let x = 0; x < n; x++) speed[x] = Math.hypot(u[x], v[x]);
        frame = { ...base, layer: "wind", u, v, speed };
        primary = speed;
      }
    }
    for (let x = 0; x < n; x++) {
      const v = primary[x];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    frames.push(frame);
  }
  return {
    layer,
    grid,
    frames: frames as RadarFrameSet<L>["frames"],
    range: { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 },
    model: MODEL,
  };
}
