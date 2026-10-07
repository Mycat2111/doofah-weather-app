import { wxPointResponse } from "@/services/wx/http";

/** v2's forecast for ?lat=…&lon=…: ECMWF's newest 9 km run from the forecast store, step by step. */
export function GET(request: Request) {
  return wxPointResponse(request);
}
