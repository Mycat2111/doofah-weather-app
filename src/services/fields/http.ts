/**
 * Server side of /api/fields?spacing=…&tile=row,col&slot=…: one tile of the
 * map's lattice as JSON (ecmwfFields.ts).
 *
 * A tile is the same for everyone in a slot, so Vercel's edge and the browser
 * keep it for the whole slot and Open-Meteo is asked once per tile per slot. Only the
 * current slot (or the one either side, for clocks a little off) is
 * answered, so no one can make DooFah ask again by inventing slots.
 */

import { cacheHeaders } from "../http/cacheHeaders";
import { OpenMeteoError } from "../openmeteo/api";
import { fetchFieldTile, type FieldTile } from "./ecmwfFields";
import { isSpacing, parseSlot, SLOT_MS, slotOf, tileAllowed, type TileId } from "./lattice";

/** While a slot's tile is fetched again, the old one may be served for this long. */
const STALE_SECONDS = 3600;
/** Open-Meteo is busy (its per-minute limit): ask the page to try again after this. */
const RETRY_SECONDS = 60;

const refuse = (status: number, reason: string, headers: Record<string, string> = {}) =>
  Response.json({ error: true, reason }, { status, headers: { "Cache-Control": "no-store", ...headers } });

export type TileSource = (tile: TileId, slot: number) => Promise<FieldTile>;

export function defaultTileSource(
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): TileSource {
  const apiKey = env.OPEN_METEO_API_KEY?.trim() || undefined;
  return (tile, slot) => fetchFieldTile(tile, slot, { apiKey, fetch: fetcher });
}

const integer = (value: string | undefined) =>
  value !== undefined && /^-?\d{1,4}$/.test(value) ? Number(value) : null;

export async function fieldsResponse(
  request: Request,
  source: TileSource = defaultTileSource(),
  now: number = Date.now(),
): Promise<Response> {
  // Browsers say where a request comes from; other sites' pages may not spend DooFah's model calls.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return refuse(403, "Only DooFah can use this");

  const params = new URL(request.url).searchParams;
  const spacing = Number(params.get("spacing"));
  const [rowText, colText, extra] = (params.get("tile") ?? "").split(",");
  const row = integer(rowText);
  const col = integer(colText);
  const slot = parseSlot(params.get("slot"));
  if (!isSpacing(spacing) || row === null || col === null || extra !== undefined || slot === null) {
    return refuse(400, "Give spacing (0.125 to 4), tile=row,col and slot=YYYY-MM-DDTHH");
  }
  const tile: TileId = { spacing, row, col };
  if (!tileAllowed(tile)) return refuse(400, "That tile is off the map");
  const current = slotOf(now);
  if (Math.abs(slot - current) > SLOT_MS) return refuse(400, "Only the current slot is answered");

  try {
    const body = await source(tile, slot);
    // A slot's tile never changes and its URL names the slot, so the browser and the edge keep it until the
    // slot is over; a request for the slot before is only answered while clocks catch up. No stale-if-error:
    // a new slot is a new URL, with no older copy to fall back to.
    const seconds = Math.max(60, Math.round((slot + SLOT_MS - now) / 1000));
    return Response.json(body, { headers: cacheHeaders({ browser: seconds, fresh: seconds, stale: STALE_SECONDS }) });
  } catch (error) {
    if (error instanceof OpenMeteoError) {
      if (error.status === 429) {
        return refuse(503, "Open-Meteo is busy; try again in a minute", { "Retry-After": String(RETRY_SECONDS) });
      }
      return refuse(502, `ECMWF unavailable: ${error.message}`);
    }
    console.error("[fields]", error);
    return refuse(500, "The map layers could not be made");
  }
}
