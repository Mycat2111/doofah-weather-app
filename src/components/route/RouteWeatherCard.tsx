"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownUp,
  CarFront,
  CloudDrizzle,
  CloudLightning,
  CloudRain,
  CloudRainWind,
  Droplet,
  Flag,
  Map as MapIcon,
  RotateCw,
  Route as RouteIcon,
  Ship,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { CardLabel, GlassCard } from "@/components/ui/GlassCard";
import { PRESSED_LABEL, TapButton } from "@/components/ui/TapButton";
import { WeatherIcon } from "@/components/ui/WeatherIcon";
import type { RouteWeatherState, Trip } from "@/hooks/useRouteWeather";
import { useI18n } from "@/i18n/I18nProvider";
import { haptic } from "@/lib/haptics";
import { DEPARTURE_OFFSETS_H, stopRain, worseRain, type RouteOutlook } from "@/lib/routeWeather";
import type { Place } from "@/services/WeatherNext3MockService";
import { PlaceField } from "./PlaceField";
import { RAIN_COLOR } from "./rainStyle";

const OUTLOOK_STYLE: Record<"dry" | "possible" | "rain" | "heavy" | "storm", { icon: LucideIcon; tone: string }> = {
  dry: { icon: Sun, tone: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100" },
  possible: { icon: CloudDrizzle, tone: "border-sky-300/30 bg-sky-400/10 text-sky-100" },
  rain: { icon: CloudRain, tone: "border-blue-300/35 bg-blue-500/15 text-blue-100" },
  heavy: { icon: CloudRainWind, tone: "border-indigo-300/40 bg-indigo-500/20 text-indigo-100" },
  storm: { icon: CloudLightning, tone: "border-purple-300/40 bg-purple-500/20 text-purple-100" },
};

const outlookLevel = (o: RouteOutlook) => (o.kind === "rain" ? o.level : o.kind);

interface RouteWeatherCardProps {
  state: RouteWeatherState;
  /** The dashboard's place: the default start, and a quick pick. */
  place: Place;
  timeZone: string;
  /** Names a stop: the start and end by their places, the rest by the nearest town or distance. */
  stopName: (index: number) => string;
  /** Show the whole trip on the radar, or one stop at the time you get there. */
  onShowOnMap: (stop: number | null) => void;
  className?: string;
}

/** Plan a drive and see the weather at each point along it, at the time you get there. */
export function RouteWeatherCard({
  state,
  place,
  timeZone,
  stopName,
  onShowOnMap,
  className = "",
}: RouteWeatherCardProps) {
  const { m } = useI18n();
  const { origin, destination, trip, loading, error } = state;

  return (
    <GlassCard className={`p-4 sm:p-5 ${className}`} index={3} aria-label={m.route.title}>
      <div className="flex items-center justify-between gap-3">
        <CardLabel icon={<RouteIcon className="size-3.5" />}>{m.route.title}</CardLabel>
        {destination && (
          <TapButton
            tapScale={0.85}
            onClick={state.clear}
            className="-my-2 grid size-9 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
            aria-label={m.route.clear}
            title={m.route.clear}
          >
            <X className="size-4" />
          </TapButton>
        )}
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] lg:gap-6">
        {/* Where and when */}
        <div className="min-w-0">
          <div className="relative flex items-center gap-2 rounded-2xl bg-black/15 p-3 ring-1 ring-white/10">
            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
              <PlaceField
                label={m.route.from}
                role="start"
                value={origin}
                placeholder={m.route.searchPlaceholder}
                onChange={state.setOrigin}
                current={place}
              />
              {/* The dotted line between the two ends, like a map app. */}
              <span className="ml-[9px] h-3 border-l-2 border-dotted border-white/25" aria-hidden />
              <PlaceField
                label={m.route.to}
                role="end"
                value={destination}
                placeholder={m.route.toPlaceholder}
                onChange={state.setDestination}
                current={place}
              />
            </div>
            <TapButton
              haptic="selection"
              tapScale={0.85}
              onClick={state.swap}
              disabled={!destination}
              aria-label={m.route.swap}
              title={m.route.swap}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 disabled:opacity-35"
            >
              <motion.span whileTap={{ rotate: 180 }} className="flex">
                <ArrowDownUp className="size-4" />
              </motion.span>
            </TapButton>
          </div>

          <div className="mt-3 flex items-center gap-2">
            {/* The chips need the room on the narrowest phones; the group keeps its name for screen readers. */}
            <span className="shrink-0 text-xs text-white/55 max-[379px]:hidden th:text-[13px]" aria-hidden>
              {m.route.leave}
            </span>
            <div
              role="radiogroup"
              aria-label={m.route.leave}
              className="flex min-w-0 flex-1 gap-1 rounded-full bg-black/15 p-1"
            >
              {DEPARTURE_OFFSETS_H.map((hours) => {
                const selected = state.leaveInHours === hours;
                return (
                  <motion.button
                    key={hours}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    whileTap="pressed"
                    onClick={() => {
                      if (selected) return;
                      haptic("selection");
                      state.setLeaveInHours(hours);
                    }}
                    className={`relative flex-1 whitespace-nowrap rounded-full px-1 py-1.5 text-xs font-medium transition-colors th:text-[13px] ${
                      selected ? "text-slate-900" : "text-white/75 hover:text-white"
                    }`}
                  >
                    {selected && (
                      <motion.span
                        layoutId="leave-pill"
                        className="absolute inset-0 rounded-full bg-white"
                        transition={{ type: "spring", stiffness: 500, damping: 38 }}
                      />
                    )}
                    <motion.span className="relative block" variants={PRESSED_LABEL}>
                      {hours === 0 ? m.route.leaveNow : m.route.leaveIn(hours)}
                    </motion.span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>

        {/* The trip */}
        <div className="min-w-0" aria-live="polite" aria-busy={loading}>
          <AnimatePresence mode="wait" initial={false}>
            {!destination ? (
              <Fade key="hint">
                <p className="flex h-full items-start gap-2.5 rounded-2xl bg-white/[0.05] p-4 text-sm leading-relaxed text-white/65">
                  <CarFront className="mt-0.5 size-4 shrink-0 text-sky-200" aria-hidden />
                  {m.route.hint}
                </p>
              </Fade>
            ) : loading && !trip ? (
              <Fade key="loading">
                <PlanningShimmer label={m.route.planning} />
              </Fade>
            ) : error ? (
              <Fade key="error">
                <div className="flex items-center gap-3 rounded-2xl bg-amber-400/10 p-4 text-sm text-amber-100 ring-1 ring-amber-300/25">
                  <span className="flex-1">{m.route.errors[error]}</span>
                  {error === "failed" && (
                    <TapButton onClick={state.retry} className="flex items-center gap-1 text-sky-200 hover:text-white">
                      <RotateCw className="size-3.5" /> {m.route.retry}
                    </TapButton>
                  )}
                </div>
              </Fade>
            ) : trip ? (
              <Fade key={`${trip.route.departure}-${trip.route.distanceKm}`}>
                <TripView
                  trip={trip}
                  timeZone={timeZone}
                  stopName={stopName}
                  onShowOnMap={onShowOnMap}
                  dimmed={loading}
                />
              </Fade>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </GlassCard>
  );
}

function Fade({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function PlanningShimmer({ label }: { label: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white/[0.05] p-4">
      <p className="flex items-center gap-2 text-sm text-white/70">
        <motion.span
          className="flex"
          animate={{ x: [0, 6, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
        >
          <CarFront className="size-4 text-sky-200" aria-hidden />
        </motion.span>
        {label}
      </p>
      <div className="mt-4 flex gap-3" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <motion.span
            key={i}
            className="h-20 w-16 shrink-0 rounded-xl bg-white/10"
            animate={{ opacity: [0.35, 0.8, 0.35] }}
            transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.12 }}
          />
        ))}
      </div>
    </div>
  );
}

function TripView({
  trip,
  timeZone,
  stopName,
  onShowOnMap,
  dimmed,
}: {
  trip: Trip;
  timeZone: string;
  stopName: (index: number) => string;
  onShowOnMap: (stop: number | null) => void;
  dimmed: boolean;
}) {
  const { m, f } = useI18n();
  const { route, stops, outlook } = trip;
  const level = outlookLevel(outlook);
  const style = OUTLOOK_STYLE[level];
  const OutlookIcon = style.icon;
  const clock = (i: number) => f.clock(stops[i].eta, timeZone);

  return (
    <div className={`transition-opacity duration-300 ${dimmed ? "opacity-60" : ""}`}>
      {/* Time, distance, arrival */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <p className="text-2xl font-semibold tracking-tight text-white">{m.route.duration(route.durationMin)}</p>
          <p className="mt-0.5 text-xs text-white/60 th:text-[13px]">
            {m.route.distance(route.distanceKm)} · {m.route.arrive(f.clock(route.arrival, timeZone))}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 text-[11px] th:text-xs">
          {route.ferry && (
            <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-white/75">
              <Ship className="size-3" aria-hidden /> {m.route.ferry}
            </span>
          )}
          {route.borders > 0 && (
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/75">{m.route.borders(route.borders)}</span>
          )}
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/60">{m.route.source[route.source]}</span>
        </div>
      </div>

      {/* The trip in one line */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, delay: 0.05 }}
        className={`mt-3 flex items-start gap-3 rounded-2xl border px-3.5 py-3 ${style.tone}`}
      >
        <OutlookIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">{m.routeOutlook(outlook, stopName, clock)}</p>
          {outlook.kind === "rain" && (
            <p className="mt-0.5 text-xs leading-snug opacity-80 th:text-[13px]">{m.route.advice[outlook.level]}</p>
          )}
        </div>
      </motion.div>

      {/* Journey timeline */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium text-white/55 th:text-[13px]">{m.route.timeline}</h3>
        <TapButton
          onClick={() => onShowOnMap(null)}
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 hover:bg-white/20 th:text-[13px]"
        >
          <MapIcon className="size-3.5" aria-hidden /> {m.route.showOnMap}
        </TapButton>
      </div>
      <ol className="no-scrollbar -mx-4 mt-2 flex snap-x overflow-x-auto px-4 pb-1 sm:-mx-5 sm:px-5 lg:mx-0 lg:px-0">
        {stops.map((stop, i) => {
          const rain = stopRain(stop.weather);
          const before = i > 0 ? worseRain(stopRain(stops[i - 1].weather), rain) : null;
          const after = i < stops.length - 1 ? worseRain(rain, stopRain(stops[i + 1].weather)) : null;
          const name = stopName(i);
          const time = clock(i);
          return (
            <motion.li
              key={i}
              className="min-w-[76px] flex-1 snap-start"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.08 + i * 0.04 }}
            >
              <button
                type="button"
                onClick={() => onShowOnMap(i)}
                aria-label={m.route.stopOnMap(name, time)}
                className="group flex w-full flex-col items-center rounded-xl py-1.5 text-center transition-colors hover:bg-white/[0.06]"
              >
                <span className="text-[11px] font-medium tabular-nums text-white/70 th:text-xs">{time}</span>
                {/* The road: each half coloured by the rain between this stop and its neighbour. */}
                <span className="relative my-1.5 flex h-9 w-full items-center justify-center" aria-hidden>
                  {before && (
                    <span
                      className="absolute left-0 right-1/2 top-1/2 h-1 -translate-y-1/2"
                      style={{ background: RAIN_COLOR[before] }}
                    />
                  )}
                  {after && (
                    <span
                      className="absolute left-1/2 right-0 top-1/2 h-1 -translate-y-1/2"
                      style={{ background: RAIN_COLOR[after] }}
                    />
                  )}
                  <span
                    className="relative grid size-9 place-items-center rounded-full bg-slate-900/85 ring-2 transition-transform group-hover:scale-110"
                    style={{ ["--tw-ring-color" as string]: RAIN_COLOR[rain] }}
                  >
                    <WeatherIcon
                      condition={stop.weather.condition}
                      isDay={stop.weather.isDay}
                      className="size-[18px]"
                    />
                    {stop.role !== "stop" && (
                      <span className="absolute -right-1.5 -top-1.5 grid size-[18px] place-items-center rounded-full bg-white text-slate-900 shadow">
                        {stop.role === "start" ? (
                          <CarFront className="size-3" strokeWidth={2.4} />
                        ) : (
                          <Flag className="size-2.5 fill-rose-500 text-rose-600" strokeWidth={2.4} />
                        )}
                      </span>
                    )}
                  </span>
                </span>
                <span className="text-sm font-semibold text-white">{f.temp(stop.weather.temperatureC)}</span>
                <span
                  className={`mt-0.5 flex items-center gap-0.5 text-[11px] tabular-nums th:text-xs ${
                    rain === "dry" ? "text-white/50" : "text-sky-200"
                  }`}
                >
                  <Droplet className="size-2.5" aria-hidden /> {m.route.chance(stop.weather.precipitationProbability)}
                </span>
                <span className="mt-1 line-clamp-2 w-full px-0.5 text-[11px] leading-tight text-white/60 th:text-xs">
                  {name}
                </span>
              </button>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
