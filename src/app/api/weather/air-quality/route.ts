import { proxyAirQuality } from "@/services/openmeteo/proxy";

/** Open-Meteo air quality with DooFah's commercial API key (only when OPEN_METEO_API_KEY is set). */
export function GET(request: Request) {
  return proxyAirQuality(request);
}
