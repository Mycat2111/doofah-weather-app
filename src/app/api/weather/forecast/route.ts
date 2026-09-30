import { proxyOpenMeteo } from "@/services/openmeteo/proxy";

/** Open-Meteo forecasts with DooFah's commercial API key (only when OPEN_METEO_API_KEY is set). */
export function GET(request: Request) {
  return proxyOpenMeteo(request, "forecast");
}
