"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Grid3x3, Leaf, Umbrella } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { WeatherIcon } from "@/components/ui/WeatherIcon";
import { AQI_STYLE, conditionLabel, formatClock, formatTemp } from "@/lib/format";
import type { CurrentConditions, DailyForecast } from "@/services/WeatherNext3MockService";

interface CurrentWeatherCardProps {
  current: CurrentConditions;
  today?: DailyForecast;
  className?: string;
}

export function CurrentWeatherCard({ current, today, className = "" }: CurrentWeatherCardProps) {
  const { sample, place, airQuality, cell, nowcast } = current;
  const tz = place.timeZone;
  const aqiStyle = AQI_STYLE[airQuality.category];
  const maxStep = Math.max(2, ...nowcast.steps.map((s) => s.precipitationMm));

  return (
    <GlassCard className={`relative flex flex-col overflow-hidden p-6 sm:p-7 ${className}`} index={0} aria-label="Current weather">
      {/* Location */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.h1
              key={place.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="truncate text-2xl font-medium tracking-tight text-shadow-soft sm:text-[28px]"
            >
              {place.name}
              {place.localName && <span className="ml-2 text-lg font-normal text-white/60">{place.localName}</span>}
            </motion.h1>
          </AnimatePresence>
          <p className="mt-0.5 truncate text-sm text-white/60">
            {[place.region, place.country].filter(Boolean).join(", ")} · Updated {formatClock(current.observedAt, tz)}
          </p>
        </div>
        <span
          className="glass-chip flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-white/85"
          title={`WeatherNext 3 grid cell ${cell.id}`}
        >
          <Grid3x3 className="size-3.5 text-sky-200" aria-hidden />
          5×5 km<span className="hidden sm:inline"> precision</span>
        </span>
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
              {formatTemp(sample.temperatureC)}
            </motion.div>
          </AnimatePresence>
          <p className="mt-3 text-lg font-medium">{conditionLabel(sample.condition, sample.isDay)}</p>
          <p className="text-sm text-white/65">
            Feels like {formatTemp(sample.feelsLikeC)}
            {today && (
              <>
                {" "}
                · H {formatTemp(today.maxTempC)} L {formatTemp(today.minTempC)}
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

      {/* Nowcast */}
      <div className="mt-auto rounded-2xl bg-black/10 p-3.5">
        <div className="flex items-center gap-2 text-sm">
          <Umbrella className="size-4 text-sky-200" aria-hidden />
          <span className="text-white/90">{nowcast.summary}</span>
        </div>
        <div className="mt-3 flex h-8 items-end gap-1" aria-hidden>
          {nowcast.steps.map((s, i) => (
            <motion.span
              key={s.time}
              className="flex-1 rounded-sm bg-sky-300/80"
              initial={{ height: 2 }}
              animate={{ height: Math.max(2, (s.precipitationMm / maxStep) * 32) }}
              transition={{ delay: 0.3 + i * 0.03, type: "spring", stiffness: 200, damping: 20 }}
              style={{ opacity: s.precipitationMm >= 0.1 ? 1 : 0.25 }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-white/45">
          <span>Now</span>
          <span>+1 h</span>
          <span>+2 h</span>
        </div>
      </div>

      {/* Air quality */}
      <div className="mt-4 flex items-center gap-3">
        <Leaf className="size-4 shrink-0" style={{ color: aqiStyle.color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-white/90">
              AQI <span className="font-semibold">{airQuality.aqi}</span>
              <span className="ml-1.5 text-white/60">{aqiStyle.short}</span>
            </span>
            <span className="text-xs text-white/50">PM2.5 {airQuality.pm25} µg/m³</span>
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
    </GlassCard>
  );
}
