"use client";

import { motion } from "framer-motion";
import { AlertTriangle, RotateCw, WifiOff } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { useForecast } from "@/hooks/useForecast";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useRouteWeather } from "@/hooks/useRouteWeather";
import { useI18n } from "@/i18n/I18nProvider";
import { placeLabel } from "@/i18n/places";
import { previewAlerts, weatherAlerts, type AlertKind } from "@/lib/alerts";
import { readOpeningPlace, saveLastPlace } from "@/lib/favorites";
import { lifestyleIndex } from "@/lib/lifestyle";
import { previewCountdown, previewNowcast, rainCountdown, type CountdownPreview } from "@/lib/rainCountdown";
import { weatherSummary } from "@/lib/voiceSummary";
import { weatherService, type WeatherSetup } from "@/services/weatherService";
import {
  DEFAULT_PLACE,
  weatherNext3,
  type AtmosphereTheme,
  type GeoPoint,
  type Place,
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
  /** The OSRM server road trips are routed by. */
  osrmUrl: string;
  /** The site operator's email, shown in the footer. */
  contactEmail?: string;
}

const noSubscription = () => () => {};

export function DooFahDashboard({
  atmosphereOverride,
  alertPreview,
  rainPreview,
  weather: setup,
  osrmUrl,
  contactEmail,
}: DooFahDashboardProps) {
  const { locale, m, f } = useI18n();
  const weather = weatherService(setup);
  const simulated = weather.source === "simulated";
  // False on the server and while hydrating, true in the browser after that.
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const [chosen, setPlace] = useState<Place | null>(null);
  // Until a place is picked, open on a saved favorite (the server, which
  // cannot see localStorage, renders the default place first).
  const place = chosen ?? (inBrowser ? readOpeningPlace() : undefined) ?? DEFAULT_PLACE;
  const { data, loading, error, refresh } = useForecast(weather, place);
  const crowd = useCrowdReports(place, simulated);
  const route = useRouteWeather(weather, place, osrmUrl);
  const [routeFocus, setRouteFocus] = useState<RouteFocus>({ key: 0, stop: null });

  // Remember what is on screen, so the app reopens on it if it is a favorite.
  useEffect(() => {
    if (inBrowser) saveLastPlace(place);
  }, [inBrowser, place]);

  const onLocated = useCallback((point: GeoPoint) => setPlace(weatherNext3.placeForPoint(point)), []);
  const geo = useGeolocation(onLocated);

  const atmosphere = atmosphereOverride ?? data?.current.atmosphere ?? "clear-night";
  // Only show data that belongs to the selected place (the previous place's
  // data stays visible, dimmed, while the next one loads).
  const tz = data?.current.place.timeZone ?? place.timeZone;

  const alerts = !data
    ? []
    : alertPreview
      ? previewAlerts(alertPreview, Date.parse(data.current.observedAt))
      : weatherAlerts(data.current, data.hourly);

  const countdown = !data
    ? undefined
    : rainPreview
      ? previewCountdown(rainPreview, Date.parse(data.current.observedAt))
      : rainCountdown(data.current, data.hourly, data.daily);
  // A preview also redraws the radar bars under the badge to match it.
  const current =
    data && rainPreview
      ? {
          ...data.current,
          nowcast: { ...data.current.nowcast, steps: previewNowcast(rainPreview, data.current.nowcast.steps) },
        }
      : data?.current;
  // The cards read the same countdown, so they never disagree with the badge.
  const lifestyle =
    data && countdown ? lifestyleIndex(data.current, data.hourly, data.daily, undefined, countdown) : [];
  // Read aloud by the floating button; follows the same countdown as the badge.
  const summary =
    data && countdown
      ? weatherSummary({ current: data.current, hourly: data.hourly, daily: data.daily, countdown }, locale)
      : null;

  // The trip's stops: the start and end by their places, the rest by the nearest town, else the distance.
  const trip = route.trip;
  const stopName = (i: number) => {
    if (!trip) return "";
    if (i === 0) return placeLabel(route.origin, locale).name;
    if (i === trip.stops.length - 1 && route.destination) return placeLabel(route.destination, locale).name;
    const { town, km } = trip.stops[i];
    return town ? (locale === "th" ? town.th : town.name) : m.route.km(km);
  };
  const showTripOnMap = (stop: number | null) => {
    setRouteFocus((f) => ({ key: f.key + 1, stop }));
    document.getElementById("doofah-radar")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <>
      <AtmosphereBackground theme={atmosphere} />
      <main className="relative mx-auto w-full min-w-0 max-w-[1400px] px-4 pb-24 pt-5 sm:px-6 lg:px-8">
        <DooFahHeader place={place} onSelectPlace={setPlace} onLocate={geo.locate} geoStatus={geo.status} />
        <FavoritesBar
          place={place}
          onSelectPlace={setPlace}
          weather={weather}
          sampleTime={data ? Date.parse(data.current.observedAt) : undefined}
        />
        <WeatherAlertBanner alerts={alerts} placeId={data?.current.place.id ?? place.id} timeZone={tz} />

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
            {data && current && countdown ? (
              <CurrentWeatherCard
                current={current}
                daily={data.daily}
                countdown={countdown}
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
            {data ? (
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
          <RouteWeatherCard
            state={route}
            place={place}
            timeZone={place.timeZone}
            stopName={stopName}
            onShowOnMap={showTripOnMap}
            className="lg:col-span-2 lg:row-start-3"
          />
        </div>

        <div className={`mt-4 transition-opacity duration-300 ${loading && data ? "opacity-60" : ""}`}>
          {data ? (
            <HourlyForecastSlider hours={data.hourly} days={data.daily.slice(0, 3)} timeZone={tz} />
          ) : (
            <Skeleton className="h-[168px]" />
          )}
        </div>

        <div
          className={`mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_minmax(340px,420px)] ${
            loading && data ? "opacity-60" : ""
          } transition-opacity duration-300`}
        >
          {data ? (
            <>
              <DailyForecastList days={data.daily} timeZone={tz} currentTempC={data.current.sample.temperatureC} />
              <WeatherDetailsGrid current={data.current} />
            </>
          ) : (
            <>
              <Skeleton className="h-[720px]" />
              <Skeleton className="h-[480px]" />
            </>
          )}
        </div>

        {/* Floats over the bottom right; the page's bottom padding keeps the last card clear of it. */}
        <VoiceSummaryButton summary={summary} />

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
            // Open-Meteo's data is CC BY 4.0 and its air quality comes from Copernicus CAMS; both must be credited.
            <>
              DooFah ดูฟ้า · {m.footer.weatherBy} <FooterLink href="https://open-meteo.com/">Open-Meteo.com</FooterLink>{" "}
              (<FooterLink href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</FooterLink>) ·{" "}
              {m.footer.airBy} <FooterLink href="https://atmosphere.copernicus.eu/">Copernicus CAMS</FooterLink>
              {data?.current.blend && <BlendCredit centres={data.current.blend.map((b) => b.centre)} />}
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

const CENTRE_LINK: Record<string, string> = {
  ECMWF: "https://www.ecmwf.int/",
  DWD: "https://www.dwd.de/",
  NOAA: "https://www.nco.ncep.noaa.gov/",
  CMA: "https://www.cma.gov.cn/en/",
};

/**
 * Whose models the chance of rain blends. The blend is DooFah's own (CC BY
 * asks that changes are marked), and Canada's data asks for its own credit line.
 */
function BlendCredit({ centres }: { centres: string[] }) {
  const { m } = useI18n();
  const unique = [...new Set(centres)];
  const linked = unique.filter((c) => CENTRE_LINK[c]);
  return (
    <p className="mt-1">
      {m.footer.blendBy}{" "}
      {linked.map((c, i) => (
        <span key={c}>
          {i > 0 && ", "}
          <FooterLink href={CENTRE_LINK[c]}>{c}</FooterLink>
        </span>
      ))}
      {unique.includes("ECCC") && (
        <>
          {" · "}
          Data Source:{" "}
          <FooterLink href="https://eccc-msc.github.io/open-data/licence/readme_en/">
            Environment and Climate Change Canada
          </FooterLink>
        </>
      )}
    </p>
  );
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
