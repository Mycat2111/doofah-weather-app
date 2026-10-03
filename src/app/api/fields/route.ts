import { fieldsResponse } from "@/services/fields/http";

/** One tile of the map's live layers (ECMWF) for ?spacing=…&tile=row,col&slot=…. */
export function GET(request: Request) {
  return fieldsResponse(request);
}
