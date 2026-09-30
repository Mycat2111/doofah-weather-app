import { DooFahDashboard } from "@/components/DooFahDashboard";
import type { AlertKind } from "@/lib/alerts";
import { ATMOSPHERE_THEMES, type AtmosphereTheme } from "@/services/WeatherNext3MockService";

const ALERT_KINDS: AlertKind[] = ["storm", "rain", "air"];

export default async function Home({ searchParams }: PageProps<"/">) {
  const { sky, alert } = await searchParams;
  const override = ATMOSPHERE_THEMES.find((t) => t === sky) as AtmosphereTheme | undefined;
  // `?alert=storm`, `?alert=rain,air` or `?alert=all` previews the alert banner.
  const requested = typeof alert === "string" ? alert.split(",") : [];
  const alertPreview = requested.includes("all") ? ALERT_KINDS : ALERT_KINDS.filter((k) => requested.includes(k));
  return (
    <DooFahDashboard atmosphereOverride={override} alertPreview={alertPreview.length ? alertPreview : undefined} />
  );
}
