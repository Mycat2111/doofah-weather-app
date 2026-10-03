"use client";

import { motion } from "framer-motion";
import { AlertTriangle, RotateCw, WifiOff } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AtmosphereBackground } from "@/components/AtmosphereBackground";
import { CurrentWeatherCard } from "@/components/CurrentWeatherCard";
import { DailyForecastList } from "@/components/DailyForecastList";
import { DooFahHeader } from "@/components/DooFahHeader";
import { DooFahRadarMap } from "@/components/DooFahRadarMap";
import { FavoritesBar } from "@/components/favorites/FavoritesBar";
import { HourlyForecastSlider } from "@/components/HourlyForecastSlider";
import { LifestyleIndex } from "@/components/LifestyleIndex";
import type { RouteFocus } from "@/components/radar/leaflet/RouteLayer";
import { RouteWeatherCard } from "@/components/route/RouteWeatherCard";
import { TapButton } from "@/components/ui/TapButton";
import { WeatherAlertBanner } from "@/components/WeatherAlertBanner";
import { WeatherDetailsGrid } from "@/components/WeatherDetailsGrid";
import { VoiceSummaryButton } from "@/components/VoiceSummaryButton";
import { WeatherReportBar } from "@/components/WeatherReportBar";
import { useCrowdReports } from "@/hooks/useCrowdReports";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useRouteWeather } from "@/hooks/useRouteWeather";
import { useWeatherState, WeatherStateProvider } from "@/hooks/useWeatherState";
import type { Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/I18nProvider";
import { placeLabel } from "@/i18n/places";
import { previewAlerts, weatherAlerts, type AlertKind } from "@/lib/alerts";
import { lifestyleIndex } from "@/lib/lifestyle";
import { previewCountdown, previewNowcast, rainCountdown, type CountdownPreview } from "@/lib/rainCountdown";
import { weatherSummary } from "@/lib/voiceSummary";
import { weatherService, type WeatherService, type WeatherSetup } from "@/services/weatherService";
import {
  weatherNext3,
  type AtmosphereTheme,
  type ForecastBundle,
  type GeoPoint,
} from "@/services/WeatherNext3MockService";

interface DooFahDashboardProps {
  /** Force a sky theme, e.g. from `?sky=thunderstorm`, to preview every mood. */
  atmosphereOverride?: AtmosphereTheme;
  /** Show sample alerts, e.g. from `?alert=storm`, whatever the weather is doing. */
  alertPreview?: AlertKind[];
  /** Show a sample rain countdown, e.g. from `?rain=soon`. */
  rainPreview?: CountdownPreview;
  /** Where the forecast comes from, decided on the server. */
  weather: WeatherSetup;
  /** The OSRM server road trips are routed by, or null when the site has none it may use. */
  osrmUrl: string | null;
  /** The site operator's email, shown in the footer. */
  contactEmail?: string;
  /** The spoken summary can use the AI voice at /api/voice. */
  aiVoice?: boolean;
}

export function DooFahDashboard({ weather: setup, ...props }: DooFahDashboardProps) {
  const weather = weatherService(setup);
  return (
    <WeatherStateProvider weather={weather}>
      <Dashboard weather={weather} {...props} />
    </WeatherStateProvider>
  );
}

function Dashboard({
  atmosphereOverride,
  alertPreview,
  rainPreview,
  weather,
  osrmUrl,
  contactEmail,
  aiVoice,
}: Omit<DooFahDashboardProps, "weather"> & { weather: WeatherService }) {
  const { locale, m, f } = useI18n();
  const simulated = weather.source === "simulated";
  const { place, setPlace, forecast: data, here, status, setTime } = useWeatherState();
  const { loading, error, refresh } = status;
  const crowd = useCrowdReports(place, simulated);
  const route = useRouteWeather(weather, place, osrmUrl);
  const [routeFocus, setRouteFocus] = useState<RouteFocus>({ key: 0, stop: null });

  const onLocated = useCallback((point: GeoPoint) => setPlace(weatherNext3.placeForPoint(point)), [setPlace]);
  const geo = useGeolocation(onLocated);

  // The sky, the weather card, its rain countdown, the lifestyle cards and the
  // details show the moment picked on the map's timeline (`here`). Alerts and
  // the spoken summary are about what is coming from now, so they stay on now.
  const atmosphere = atmosphereOverride ?? here?.current.atmosphere ?? "clear-night";
  // Only show data that belongs to the selected place (the previous place's
  // data stays visible, dimmed, while the next one loads).
  const tz = data?.current.place.timeZone ?? place.timeZone;

  const alerts = useMemo(() => alertsFor(data, alertPreview), [data, alertPreview]);

  const countdownOf = (bundle: typeof data) =>
    !bundle
      ? undefined
      : rainPreview
        ? previewCountdown(rainPreview, Date.parse(bundle.current.observedAt))
        : rainCountdown(bundle.current, bundle.hourly, bundle.daily);
  const countdown = countdownOf(here);
  // A preview also redraws the radar bars under the badge to match it.
  const current =
    here && rainPreview
      ? {
          ...here.current,
          nowcast: { ...here.current.nowcast, steps: previewNowcast(rainPreview, here.current.nowcast.steps) },
        }
      : here?.current;
  // The cards read the same countdown, so they never disagree with the badge.
  const lifestyle =
    here && countdown ? lifestyleIndex(here.current, here.hourly, here.daily, undefined, countdown) : [];
  // Read aloud by the floating button; the countdown from now, as the badge shows it at now.
  const summary = useMemo(() => summaryFor(data, rainPreview, locale), [data, rainPreview, locale]);

  const { trip, origin, destination } = route;
  // The trip's stops: the start and end by their places, the rest by the nearest town, else the distance.
  const stopName = useCallback(
    (i: number) => {
      if (!trip) return "";
      if (i === 0) return placeLabel(origin, locale).name;
      if (i === trip.stops.length - 1 && destination) return placeLabel(destination, locale).name;
      const { town, km } = trip.stops[i];
      return town ? (locale === "th" ? town.th : town.name) : m.route.km(km);
    },
    [trip, origin, destination, locale, m],
  );
  const showTripOnMap = useCallback((stop: number | null) => {
    setRouteFocus((f) => ({ key: f.key + 1, stop }));
    document.getElementById("doofah-radar")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // While the map's timeline plays, only what shows its moment draws again; these stay as they are.
  const sampleTime = data ? Date.parse(data.current.observedAt) : undefined;
  const placeId = data?.current.place.id ?? place.id;
  const top = useMemo(
    () => (
      <>
        <DooFahHeader place={place} onSelectPlace={setPlace} onLocate={geo.locate} geoStatus={geo.status} />
        <FavoritesBar place={place} onSelectPlace={setPlace} weather={weather} sampleTime={sampleTime} />
        <WeatherAlertBanner alerts={alerts} placeId={placeId} timeZone={tz} />
      </>
    ),
    [place, setPlace, geo.locate, geo.status, weather, sampleTime, alerts, placeId, tz],
  );
  const hourly = useMemo(
    () =>
      data ? (
        <HourlyForecastSlider hours={data.hourly} days={data.daily.slice(0, 3)} timeZone={tz} />
      ) : (
        <Skeleton className="h-[168px]" />
      ),
    [data, tz],
  );
  const days = useMemo(
    () =>
      data ? (
        <DailyForecastList days={data.daily} timeZone={tz} currentTempC={data.current.sample.temperatureC} />
      ) : (
        <Skeleton className="h-[720px]" />
      ),
    [data, tz],
  );
  const routeCard = useMemo(
    () => (
      <RouteWeatherCard
        state={route}
        place={place}
        timeZone={place.timeZone}
        stopName={stopName}
        onShowOnMap={showTripOnMap}
        className="lg:col-span-2 lg:row-start-3"
      />
    ),
    [route, place, stopName, showTripOnMap],
  );

  return (
    <>
      <AtmosphereBackground theme={atmosphere} />
      <main className="relative mx-auto w-full min-w-0 max-w-[1400px] px-4 pb-24 pt-5 sm:px-6 lg:px-8">
        {top}

        {error && (
          <div role="alert" className="glass mt-3 flex items-center gap-3 rounded-2xl px-4 py-3 text-sm">
            <AlertTriangle className="size-4 text-amber-200" />
            <span className="flex-1" title={error}>
              {m.errors.forecast}
            </span>
            <TapButton onClick={refresh} className="flex items-center gap-1 text-sky-200 hover:text-white">
              <RotateCw className="size-3.5" /> {m.errors.retry}
            </TapButton>
          </div>
        )}
        {!error && data?.current.savedAt && (
          <div role="status" className="glass mt-3 flex items-center gap-3 rounded-2xl px-4 py-3 text-sm">
            <WifiOff className="size-4 shrink-0 text-sky-200" aria-hidden />
            <span className="flex-1">{m.errors.offline(f.clock(data.current.savedAt, tz))}</span>
            <TapButton onClick={refresh} className="flex items-center gap-1 text-sky-200 hover:text-white">
              <RotateCw className="size-3.5" /> {m.errors.retry}
            </TapButton>
          </div>
        )}

        {/* Phones: weather, lifestyle, map. Wide screens: weather beside the map, lifestyle below both. */}
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(340px,420px)_1fr]">
          <div className={`transition-opacity duration-300 ${loading && data ? "opacity-60" : ""}`}>
            {here && current && countdown ? (
              <CurrentWeatherCard
                current={current}
                daily={here.daily}
                countdown={countdown}
                onBackToNow={() => setTime(null)}
                reportBar={
                  <WeatherReportBar
                    reports={crowd.reports}
                    mine={crowd.mine}
                    now={crowd.now}
                    isDay={current.sample.isDay}
                    onReport={crowd.submit}
                  />
                }
                className="h-full"
              />
            ) : (
              <Skeleton className="h-[560px]" />
            )}
          </div>
          <div
            className={`transition-opacity duration-300 lg:col-span-2 lg:row-start-2 ${loading && data ? "opacity-60" : ""}`}
          >
            {here ? (
              <LifestyleIndex statuses={lifestyle} timeZone={tz} />
            ) : (
              <Skeleton className="h-[330px] lg:h-[210px]" />
            )}
          </div>
          <DooFahRadarMap
            place={place}
            onLocated={onLocated}
            reports={crowd.reports}
            reportsNow={crowd.now}
            verification={crowd.verification}
            night={data ? !data.current.sample.isDay : false}
            source={weather.source}
            trip={trip}
            tripFocus={routeFocus}
            tripStopName={stopName}
            className="h-[600px] lg:col-start-2 lg:row-start-1 lg:h-auto lg:min-h-[580px]"
          />
          {routeCard}
        </div>

        <div className={`mt-4 transition-opacity duration-300 ${loading && data ? "opacity-60" : ""}`}>{hourly}</div>

        <div
          className={`mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_minmax(340px,420px)] ${
            loading && data ? "opacity-60" : ""
          } transition-opacity duration-300`}
        >
          {days}
          {here ? <WeatherDetailsGrid current={here.current} /> : <Skeleton className="h-[480px]" />}
        </div>

        {/* Floats over the bottom right; the page's bottom padding keeps the last card clear of it. */}
        <VoiceSummaryButton summary={summary} aiVoice={aiVoice} />

        <footer className="mt-10 text-center text-xs text-white/45">
          {simulated ? (
            <>
              {m.footer.credit}
              {data?.current.model && (
                <>
                  {" · "}
                  {m.footer.modelRun(
                    new Date(data.current.model.runInitTime).toISOString().slice(0, 16).replace("T", " "),
                  )}
                </>
              )}
            </>
          ) : (
            // Whose forecasts these are: TMD's WRF when it is used, and ECMWF's through Open-Meteo (CC BY 4.0,
            // which asks for credit). The air quality is Copernicus CAMS's.
            <>
              DooFah ดูฟ้า · {m.footer.forecastBy}{" "}
              {data?.current.models?.includes("WRF") && (
                <>
                  {m.footer.wrf.before}
                  <FooterLink href="https://www.tmd.go.th/">{m.footer.tmd}</FooterLink>
                  {m.footer.wrf.after} ·{" "}
                </>
              )}
              <FooterLink href="https://www.ecmwf.int/">ECMWF</FooterLink> {m.footer.via}{" "}
              <FooterLink href="https://open-meteo.com/">Open-Meteo.com</FooterLink> (
              <FooterLink href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</FooterLink>) · {m.footer.airBy}{" "}
              <FooterLink href="https://atmosphere.copernicus.eu/">Copernicus CAMS</FooterLink>
            </>
          )}
          {/* FOSSGIS's routing terms ask every site using its router to show how to reach the operator. */}
          {contactEmail && (
            <p className="mt-1">
              {m.footer.contact} <FooterLink href={`mailto:${contactEmail}`}>{contactEmail}</FooterLink>
            </p>
          )}
        </footer>
      </main>
    </>
  );
}

/** The alert banner's alerts, from now (or the sample ones asked for in the address). */
function alertsFor(data: ForecastBundle | undefined, preview: AlertKind[] | undefined) {
  if (!data) return [];
  return preview
    ? previewAlerts(preview, Date.parse(data.current.observedAt))
    : weatherAlerts(data.current, data.hourly);
}

/** The spoken summary, from now, with the same countdown the badge shows at now. */
function summaryFor(data: ForecastBundle | undefined, preview: CountdownPreview | undefined, locale: Locale) {
  if (!data) return null;
  const countdown = preview
    ? previewCountdown(preview, Date.parse(data.current.observedAt))
    : rainCountdown(data.current, data.hourly, data.daily);
  return weatherSummary({ current: data.current, hourly: data.hourly, daily: data.daily, countdown }, locale);
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-white/30 hover:text-white/70">
      {children}
    </a>
  );
}

function Skeleton({ className }: { className: string }) {
  return (
    <motion.div
      className={`glass rounded-[28px] ${className}`}
      animate={{ opacity: [0.45, 0.8, 0.45] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}
