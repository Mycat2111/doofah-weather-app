import { cookies } from "next/headers";
import { DooFahDashboard } from "@/components/DooFahDashboard";
import type { AlertKind } from "@/lib/alerts";
import { COUNTDOWN_PREVIEWS } from "@/lib/rainCountdown";
import { FOSSGIS_OSRM_URL } from "@/services/routing/osrm";
import type { WeatherSetup } from "@/services/weatherService";
import { isWeatherNextOwner, OWNER_COOKIE } from "@/services/weathernext/server";
import { ATMOSPHERE_THEMES, type AtmosphereTheme } from "@/services/WeatherNext3MockService";

const ALERT_KINDS: AlertKind[] = ["storm", "rain", "air"];

export default async function Home({ searchParams }: PageProps<"/">) {
  const { sky, alert, rain, data } = await searchParams;
  const contactEmail = process.env.CONTACT_EMAIL || undefined;
  const override = ATMOSPHERE_THEMES.find((t) => t === sky) as AtmosphereTheme | undefined;
  // `?alert=storm`, `?alert=rain,air` or `?alert=all` previews the alert banner.
  const requested = typeof alert === "string" ? alert.split(",") : [];
  const alertPreview = requested.includes("all") ? ALERT_KINDS : ALERT_KINDS.filter((k) => requested.includes(k));
  // `?rain=soon`, `now`, `later` or `dry` previews the rain countdown.
  const rainPreview = COUNTDOWN_PREVIEWS.find((k) => k === rain);
  // Real forecasts from Open-Meteo; `?data=sim` shows the WeatherNext 3 simulation instead.
  // With a commercial key set, the browser asks through /api/weather so the key stays on the server.
  const weather: WeatherSetup =
    data === "sim"
      ? { source: "simulated", proxy: false }
      : { source: "open-meteo", proxy: Boolean(process.env.OPEN_METEO_API_KEY) };
  return (
    <DooFahDashboard
      atmosphereOverride={override}
      alertPreview={alertPreview.length ? alertPreview : undefined}
      rainPreview={rainPreview}
      weather={weather}
      // Road routes from OSRM: FOSSGIS's public server unless OSRM_URL names another. FOSSGIS's
      // terms ask every site using it to show the operator's address, so without one there are no routes.
      osrmUrl={process.env.OSRM_URL || (contactEmail ? FOSSGIS_OSRM_URL : null)}
      contactEmail={contactEmail}
      // A natural AI voice for the spoken summary, from /api/voice, when the site has a Google Cloud key.
      aiVoice={Boolean(process.env.GOOGLE_CLOUD_TTS_API_KEY)}
      // WeatherNext 3's next 6 hours, only on the owner's device (unlocked at /api/weathernext/access).
      weatherNext={data !== "sim" && isWeatherNextOwner((await cookies()).get(OWNER_COOKIE)?.value, process.env)}
    />
  );
}
