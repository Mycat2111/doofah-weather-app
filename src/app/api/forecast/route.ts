import { forecastResponse } from "@/services/forecast/http";

/** The unified forecast (WRF for the first 48 hours where it reaches, ECMWF after) for ?lat=…&lon=…. */
export function GET(request: Request) {
  return forecastResponse(request);
}
