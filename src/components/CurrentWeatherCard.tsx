"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Grid3x3, Layers, Leaf } from "lucide-react";
import type { ReactNode } from "react";
import { FavoriteStar } from "@/components/favorites/FavoriteStar";
import { RainCountdownPanel } from "@/components/RainCountdownPanel";
import { GlassCard } from "@/components/ui/GlassCard";
import { WeatherIcon } from "@/components/ui/WeatherIcon";
import { useI18n } from "@/i18n/I18nProvider";
import { placeLabel } from "@/i18n/places";
import { AQI_COLOR } from "@/lib/colors";
import type { RainCountdown } from "@/lib/rainCountdown";
import type { CurrentConditions, DailyForecast } from "@/services/WeatherNext3MockService";

interface CurrentWeatherCardProps {
  current: CurrentConditions;
  /** Today first. */
  daily: DailyForecast[];
  countdown: RainCountdown;
  /** The one-tap weather report buttons, shown under the rain countdown. */
  reportBar?: ReactNode;
  className?: string;
}

export function CurrentWeatherCard({ current, daily, countdown, reportBar, className = "" }: CurrentWeatherCardProps) {
  const { locale, m, f } = useI18n();
  const { sample, place, airQuality, cell, blend } = current;
  const tz = place.timeZone;
  const label = placeLabel(place, locale);
  const today = daily[0];

  return (
    <GlassCard
      className={`relative flex flex-col overflow-hidden p-6 sm:p-7 ${className}`}
      index={0}
      aria-label={m.hero.label}
    >
      {/* Location. Relative so the favorite panel spans the card's width. */}
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <AnimatePresence mode="wait">
              <motion.h1
                key={place.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="min-w-0 truncate text-2xl font-medium tracking-tight drop-shadow-[0_2px_24px_rgba(0,0,0,0.25)] sm:text-[28px]"
              >
                {label.name}
                {label.localName && (
                  <span className="ml-2 hidden text-lg font-normal text-white/60 sm:inline">{label.localName}</span>
                )}
              </motion.h1>
            </AnimatePresence>
            <FavoriteStar key={place.id} place={place} />
          </div>
          <p className="mt-0.5 truncate text-sm text-white/60">
            {/* Offline, the time the saved forecast was downloaded. */}
            {label.area} · {m.hero.updated(f.clock(current.savedAt ?? current.observedAt, tz))}
          </p>
        </div>
        {cell && (
          <span
            className="glass-chip flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-white/85"
            title={m.hero.cellTitle(cell.id)}
          >
            <Grid3x3 className="size-3.5 text-sky-200" aria-hidden />
            {/* The word only shows while the card is full width; beside the map it needs the room for the name. */}
            {m.hero.precisionBefore && <span className="hidden sm:inline lg:hidden">{m.hero.precisionBefore}</span>}
            5×5 {m.units.km}
            {m.hero.precisionAfter && <span className="hidden sm:inline lg:hidden">{m.hero.precisionAfter}</span>}
          </span>
        )}
        {/* Real forecasts: how many models the chance of rain blends. */}
        {!cell && blend && blend.length > 1 && (
          <span
            className="glass-chip flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-white/85"
            title={`${m.hero.modelsTitle} ${blend.map((b) => b.name).join(", ")}`}
          >
            <Layers className="size-3.5 text-sky-200" aria-hidden />
            {m.hero.models(blend.length)}
          </span>
        )}
      </div>

      {/* Temperature hero */}
      <div className="mb-6 mt-6 flex items-end justify-between gap-4">
        <div>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={`${place.id}-${Math.round(sample.temperatureC)}`}
              initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -24, filter: "blur(8px)" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="text-[104px] leading-[0.9] font-extralight tracking-[-0.06em] text-shadow-soft sm:text-[128px]"
            >
              {f.temp(sample.temperatureC)}
            </motion.div>
          </AnimatePresence>
          <p className="mt-3 text-lg font-medium">{m.condition(sample.condition, sample.isDay)}</p>
          <p className="text-sm text-white/65">
            <span className="whitespace-nowrap">{m.hero.feelsLike(f.temp(sample.feelsLikeC))}</span>
            {today && (
              <>
                {" · "}
                <span className="whitespace-nowrap">
                  {m.hero.highLow(f.temp(today.maxTempC), f.temp(today.minTempC))}
                </span>
              </>
            )}
          </p>
        </div>
        <motion.div
          key={sample.condition + String(sample.isDay)}
          initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 180, damping: 14 }}
          className="mb-8 drop-shadow-[0_8px_30px_rgba(255,255,255,0.25)]"
        >
          <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
            <WeatherIcon condition={sample.condition} isDay={sample.isDay} className="size-24 sm:size-28" />
          </motion.div>
        </motion.div>
      </div>

      {/* Time to rain, from the nowcast */}
      <RainCountdownPanel current={current} countdown={countdown} daily={daily} />
      {reportBar}

      {/* Air quality, when there is a recent reading */}
      {airQuality && (
        <div className="mt-4 flex items-center gap-3">
          <Leaf className="size-4 shrink-0" style={{ color: AQI_COLOR[airQuality.category] }} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-white/90">
                {m.hero.aqi} <span className="font-semibold">{airQuality.aqi}</span>
                <span className="ml-1.5 text-white/60">{m.aqi[airQuality.category]}</span>
              </span>
              <span className="text-xs text-white/50">
                PM2.5 {airQuality.pm25} {m.units.microgramsPerCubicMetre}
              </span>
            </div>
            <div className="relative mt-1.5 h-1.5 rounded-full bg-[linear-gradient(90deg,#4ade80,#facc15_20%,#fb923c_40%,#f87171_60%,#c084fc_80%,#be123c)]">
              <motion.span
                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/30 shadow"
                initial={{ left: "0%" }}
                animate={{ left: `${Math.min(100, (airQuality.aqi / 300) * 100)}%` }}
                transition={{ type: "spring", stiffness: 90, damping: 16, delay: 0.2 }}
              />
            </div>
          </div>
        </div>
      )}
    </GlassCard>
  );
}
