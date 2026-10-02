"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  CloudDrizzle,
  CloudMoon,
  CloudRain,
  CloudRainWind,
  CloudSun,
  Moon,
  Radar,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useNow } from "@/hooks/useNow";
import { useI18n } from "@/i18n/I18nProvider";
import {
  COUNTDOWN_HOURS,
  dryHoursUntil,
  minutesUntil,
  RAIN_LIKELY,
  WET_RATE,
  type RainCountdown,
} from "@/lib/rainCountdown";
import type { CurrentConditions, DailyForecast, RainIntensity } from "@/services/WeatherNext3MockService";

const RAIN_ICON: Record<RainIntensity, LucideIcon> = {
  drizzle: CloudDrizzle,
  light: CloudRain,
  moderate: CloudRain,
  heavy: CloudRainWind,
};

const STEP_MS = 10 * 60_000;

type Tone = "rain" | "sun" | "moon" | "cloud";

const TONE: Record<Tone, { badge: string; icon: string; pulse: string }> = {
  rain: {
    badge: "bg-sky-400/20 ring-sky-300/40 shadow-[0_0_28px_-6px_rgba(56,189,248,0.7)]",
    icon: "bg-sky-300/25 text-sky-100",
    pulse: "bg-sky-300/60",
  },
  sun: {
    badge: "bg-amber-300/15 ring-amber-200/35 shadow-[0_0_28px_-8px_rgba(252,211,77,0.55)]",
    icon: "bg-amber-200/20 text-amber-100",
    pulse: "bg-amber-200/50",
  },
  moon: {
    badge: "bg-indigo-300/15 ring-indigo-200/35 shadow-[0_0_28px_-8px_rgba(165,180,252,0.55)]",
    icon: "bg-indigo-200/20 text-indigo-100",
    pulse: "bg-indigo-200/50",
  },
  cloud: { badge: "bg-white/10 ring-white/20", icon: "bg-white/15 text-white/90", pulse: "bg-white/40" },
};

interface RainCountdownPanelProps {
  current: CurrentConditions;
  countdown: RainCountdown;
  daily: DailyForecast[];
}

/**
 * Time to the next rain (or to the end of this rain) as a badge that counts
 * down live, over rain bars for the next 2 hours: every 10 minutes from the
 * simulation's radar, or each hour's rain for the live forecast.
 */
export function RainCountdownPanel({ current, countdown, daily }: RainCountdownPanelProps) {
  const { m, f } = useI18n();
  const tz = current.place.timeZone;
  const observed = Date.parse(current.observedAt);
  const tick = useNow();
  const now = Math.max(tick ?? observed, observed);
  const clock = (time: string) => f.clock(time, tz);
  const { steps } = current.nowcast;
  const maxStep = Math.max(2, ...steps.map((s) => s.precipitationMm));
  const { isDay } = current.sample;

  let title: string;
  let detail: string;
  let Icon: LucideIcon;
  let tone: Tone;
  /** The time came from the radar nowcast, to the minute. */
  let fromRadar = false;
  /** Rain now or within half an hour: the icon pulses. */
  let urgent = false;
  /** Where the rain starts or stops on the bars. */
  let marker: number | null = null;

  switch (countdown.kind) {
    case "starting": {
      const minutes = minutesUntil(countdown.at, now);
      title =
        minutes <= 0 ? m.countdown.startingNow : m.countdown.rainIn[countdown.intensity](m.countdown.duration(minutes));
      detail = m.countdown.startsAt(clock(countdown.at));
      Icon = RAIN_ICON[countdown.intensity];
      tone = "rain";
      fromRadar = true;
      urgent = minutes <= 30;
      marker = Date.parse(countdown.at);
      break;
    }
    case "raining": {
      title = m.countdown.raining[countdown.intensity];
      Icon = RAIN_ICON[countdown.intensity];
      tone = "rain";
      urgent = true;
      if (!countdown.until) {
        detail = m.countdown.noBreak(COUNTDOWN_HOURS);
      } else if (countdown.precise) {
        const minutes = minutesUntil(countdown.until, now);
        detail =
          minutes > 0
            ? m.countdown.easesIn(m.countdown.duration(minutes), clock(countdown.until))
            : m.countdown.easingNow;
        fromRadar = true;
        marker = Date.parse(countdown.until);
      } else {
        detail = m.countdown.easesAround(clock(countdown.until));
      }
      break;
    }
    case "later":
    case "dry": {
      // Rain likely, or only possible: its chance is under an even one.
      const likely = countdown.kind === "later" && countdown.chance >= RAIN_LIKELY;
      if (countdown.kind === "later" && countdown.soon) {
        // The live forecast has rain within 2 hours: this hour, or from the start of a later one.
        const minutes = minutesUntil(countdown.at, now);
        title =
          minutes <= 0
            ? likely
              ? m.countdown.likelyNow
              : m.countdown.possibleNow
            : (likely ? m.countdown.likelyAround : m.countdown.possibleAround)(clock(countdown.at));
        Icon = CloudRain;
        tone = "rain";
        urgent = minutes <= 30;
        detail = m.countdown.chance(countdown.chance);
        break;
      }
      const hours = countdown.kind === "later" ? dryHoursUntil(countdown.at, now) : countdown.hours;
      title = countdown.clear ? m.countdown.clearFor(hours) : m.countdown.dryFor(hours);
      tone = countdown.clear ? (isDay ? "sun" : "moon") : "cloud";
      Icon = countdown.clear ? (isDay ? Sun : Moon) : isDay ? CloudSun : CloudMoon;
      if (countdown.kind === "later") {
        detail = (likely ? m.countdown.rainFrom : m.countdown.possibleFrom)(clock(countdown.at), countdown.chance);
      } else {
        const index = countdown.nextRainDay;
        const day = index === null ? undefined : daily[index];
        detail = !day
          ? m.countdown.noRainAhead
          : index === 1
            ? m.countdown.nextRainTomorrow
            : m.countdown.nextRain(f.dayName(day.date, index!), f.shortDate(day.date));
      }
      break;
    }
  }

  // Bar i is centred on its step, so the marker lines up with the bar it falls on.
  const markerLeft =
    marker === null
      ? null
      : ((Math.min(steps.length - 1, Math.max(0, (marker - observed) / STEP_MS)) + 0.5) / steps.length) * 100;

  return (
    <div className="mt-auto rounded-2xl bg-black/10 p-3.5" role="group" aria-label={m.countdown.label}>
      <div className="flex">
        <motion.div
          layout
          className={`relative flex min-w-0 items-center gap-2 rounded-[20px] py-1.5 pl-1.5 pr-3.5 ring-1 transition-colors duration-500 ${TONE[tone].badge}`}
        >
          <span className={`relative grid size-7 shrink-0 place-items-center rounded-full ${TONE[tone].icon}`}>
            {urgent && (
              <motion.span
                className={`absolute inset-0 rounded-full motion-reduce:hidden ${TONE[tone].pulse}`}
                initial={{ scale: 1, opacity: 0.6 }}
                animate={{ scale: 1.9, opacity: 0 }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                aria-hidden
              />
            )}
            <Icon className="relative size-4" aria-hidden />
          </span>
          <span className="relative min-w-0 overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={title}
                className="block text-sm font-semibold leading-snug text-white"
                initial={{ y: 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -14, opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                {title}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 pl-1">
        <p className="min-w-0 text-xs text-white/65 th:text-[13px]">{detail}</p>
        {/* Only the simulation has a radar behind its nowcast. */}
        {fromRadar && current.source === "simulated" && (
          <span className="glass-chip flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-sky-100 th:text-[11px]">
            <Radar className="size-3" aria-hidden />
            {m.countdown.radar}
          </span>
        )}
      </div>

      <div className="relative mt-3">
        <div className="flex h-8 items-end gap-1" aria-hidden>
          {steps.map((s, i) => (
            <motion.span
              key={s.time}
              className="flex-1 rounded-sm bg-sky-300/80"
              initial={{ height: 2 }}
              animate={{ height: Math.max(2, (s.precipitationMm / maxStep) * 32) }}
              transition={{ delay: 0.3 + i * 0.03, type: "spring", stiffness: 200, damping: 20 }}
              style={{ opacity: s.precipitationMm >= WET_RATE ? 1 : 0.25 }}
            />
          ))}
        </div>
        {markerLeft !== null && (
          <motion.span
            key={marker}
            className="absolute -top-2 bottom-0 w-px origin-bottom bg-white/80"
            style={{ left: `${markerLeft}%` }}
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{ delay: 0.7, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            aria-hidden
          >
            <span className="absolute -left-[3px] -top-[3px] size-[7px] rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
          </motion.span>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-white/45 th:text-[11px]">
        <span>{m.hero.now}</span>
        <span>{m.hero.hoursAhead(1)}</span>
        <span>{m.hero.hoursAhead(2)}</span>
      </div>
    </div>
  );
}
