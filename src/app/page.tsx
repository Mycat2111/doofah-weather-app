import { DooFahDashboard } from "@/components/DooFahDashboard";
import { ATMOSPHERE_THEMES, type AtmosphereTheme } from "@/services/WeatherNext3MockService";

export default async function Home({ searchParams }: PageProps<"/">) {
  const { sky } = await searchParams;
  const override = ATMOSPHERE_THEMES.find((t) => t === sky) as AtmosphereTheme | undefined;
  return <DooFahDashboard atmosphereOverride={override} />;
}
