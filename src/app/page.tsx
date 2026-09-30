import { DooFahDashboard } from "@/components/DooFahDashboard";
import type { AlertKind } from "@/lib/alerts";
import { COUNTDOWN_PREVIEWS } from "@/lib/rainCountdown";
import { ATMOSPHERE_THEMES, type AtmosphereTheme } from "@/services/WeatherNext3MockService";

const ALERT_KINDS: AlertKind[] = ["storm", "rain", "air"];

export default async function Home({ searchParams }: PageProps<"/">) {
  const { sky, alert, rain } = await searchParams;
  const override = ATMOSPHERE_THEMES.find((t) => t === sky) as AtmosphereTheme | undefined;
  // `?alert=storm`, `?alert=rain,air` or `?alert=all` previews the alert banner.
  const requested = typeof alert === "string" ? alert.split(",") : [];
  const alertPreview = requested.includes("all") ? ALERT_KINDS : ALERT_KINDS.filter((k) => requested.includes(k));
  // `?rain=soon`, `now`, `later` or `dry` previews the rain countdown.
  const rainPreview = COUNTDOWN_PREVIEWS.find((k) => k === rain);
  return (
    <DooFahDashboard
      atmosphereOverride={override}
      alertPreview={alertPreview.length ? alertPreview : undefined}
      rainPreview={rainPreview}
    />
  );
}
