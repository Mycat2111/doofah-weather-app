"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Clock, Droplet, Sparkles, Sunrise, Sunset } from "lucide-react";
import { Fragment, useRef, type ReactNode } from "react";
import { legendGradient, legendPosition, PRECIP_SCALE } from "@/components/radar/colorScales";
import { CardLabel, GlassCard } from "@/components/ui/GlassCard";
import { TapButton } from "@/components/ui/TapButton";
import { WeatherIcon } from "@/components/ui/WeatherIcon";
import { useI18n } from "@/i18n/I18nProvider";
import type { Messages } from "@/i18n/messages";
import { nowcastByHour, RAIN_MM, type Nowcast, type NowcastHour } from "@/services/weathernext/nowcast";
import type { DailyForecast, HourlyForecast } from "@/services/WeatherNext3MockService";

interface HourlyForecastSliderProps {
  hours: HourlyForecast[];
  days: DailyForecast[];
  timeZone: string;
  /** WeatherNext 3's next 6 hours (the owner's device only); its hours are highlighted. */
  nowcast?: Nowcast | null;
}

type SunEvent = { kind: "sunrise" | "sunset"; time: string };

/** Height of the rain bars, px. */
const BAR_PX = 36;
/** The radar's rain colours, bottom to top. */
const VERTICAL_RAIN = legendGradient(PRECIP_SCALE).replace("90deg", "0deg");

/** Rain in mm as shown under a bar: one decimal below 10 mm. */
const mmText = (mm: number) => (mm < 10 ? mm.toFixed(1) : String(Math.round(mm)));

export function HourlyForecastSlider({ hours: allHours, days, timeZone, nowcast }: HourlyForecastSliderProps) {
  const { m, f } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const ai = nowcastByHour(nowcast ?? null, allHours);
  // Just after the hour turns the strip can still start at the hour that ended: start where WeatherNext 3 does.
  const firstAi = allHours.findIndex((h) => ai.has(h.time));
  const hours = firstAi > 0 ? allHours.slice(firstAi) : allHours;
  // The leading hours WeatherNext 3 covers are drawn together in one highlighted group.
  let lead = 0;
  while (lead < hours.length && ai.has(hours[lead].time)) lead++;

  const sunEvents: SunEvent[] = days.flatMap((d) => [
    ...(d.sunrise ? [{ kind: "sunrise" as const, time: d.sunrise }] : []),
    ...(d.sunset ? [{ kind: "sunset" as const, time: d.sunset }] : []),
  ]);
  const eventsWithin = (h: HourlyForecast) => {
    const start = Date.parse(h.time);
    return sunEvents.filter((e) => {
      const t = Date.parse(e.time);
      return t >= start && t < start + 3_600_000;
    });
  };

  const scrollBy = (dir: 1 | -1) =>
    scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: "smooth" });

  const renderHour = (h: HourlyForecast, i: number, hourAi?: NowcastHour): ReactNode => (
    <Fragment key={h.time}>
      <HourChip
        hour={h}
        label={i === 0 ? m.hourly.now : f.hour(h.time, timeZone)}
        index={i}
        highlight={i === 0}
        ai={hourAi}
      />
      {eventsWithin(h).map((e) => (
        <motion.div
          key={e.time}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i, 12) * 0.03 }}
          className="flex w-[64px] shrink-0 snap-start flex-col items-center gap-2 rounded-2xl py-3 text-center"
        >
          <span className="text-xs font-medium text-amber-100/80">{f.clock(e.time, timeZone)}</span>
          {e.kind === "sunrise" ? (
            <Sunrise className="size-6 text-amber-200" aria-hidden />
          ) : (
            <Sunset className="size-6 text-orange-300" aria-hidden />
          )}
          <span className="text-xs text-white/70">{e.kind === "sunrise" ? m.hourly.sunrise : m.hourly.sunset}</span>
        </motion.div>
      ))}
    </Fragment>
  );

  return (
    <GlassCard className="p-5" index={2} aria-label={m.hourly.label}>
      <div className="flex items-center justify-between">
        <CardLabel icon={<Clock className="size-3.5" />}>{m.hourly.title}</CardLabel>
        <div className="hidden gap-1 sm:flex">
          {([-1, 1] as const).map((dir) => (
            <TapButton
              key={dir}
              tapScale={0.85}
              onClick={() => scrollBy(dir)}
              className="grid size-7 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
              aria-label={dir < 0 ? m.hourly.earlier : m.hourly.later}
            >
              {dir < 0 ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
            </TapButton>
          ))}
        </div>
      </div>

      <div
        ref={scroller}
        className="no-scrollbar -mx-2 mt-3 flex snap-x snap-mandatory gap-1 overflow-x-auto px-2 pb-1"
        tabIndex={0}
        aria-label={m.hourly.scrollLabel}
      >
        {lead > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex shrink-0 snap-start flex-col rounded-[20px] bg-gradient-to-b from-sky-400/15 via-indigo-400/10 to-transparent p-1 ring-1 ring-sky-300/30"
          >
            <span className="flex items-center gap-1 px-2 pt-1 text-[10px] font-semibold tracking-wide text-sky-100/90">
              <Sparkles className="size-3" aria-hidden />
              {m.hourly.nowcast.title}
            </span>
            <div className="flex gap-1">{hours.slice(0, lead).map((h, i) => renderHour(h, i, ai.get(h.time)))}</div>
          </motion.div>
        )}
        {hours.slice(lead).map((h, k) => renderHour(h, lead + k))}
      </div>

      {lead > 0 && nowcast ? (
        <NowcastLegend nowcast={nowcast} />
      ) : (
        nowcast?.reason && (
          <p className="mt-2 text-[11px] text-white/45">
            {m.hourly.nowcast.unavailable(m.hourly.nowcast.reasons[nowcast.reason])}
          </p>
        )
      )}
    </GlassCard>
  );
}

/** Under the strip while WeatherNext 3 is shown: what the bars mean, the run, and that it is experimental. */
function NowcastLegend({ nowcast }: { nowcast: Nowcast }) {
  const { m } = useI18n();
  const run = nowcast.initTime ? nowcast.initTime.slice(0, 16).replace("T", " ") : null;
  return (
    <div className="mt-3 space-y-1.5 text-[11px] text-white/55">
      <div className="flex items-center gap-2">
        <span>{m.hourly.nowcast.light}</span>
        <span className="h-1.5 w-24 rounded-full" style={{ background: legendGradient(PRECIP_SCALE) }} aria-hidden />
        <span>{m.hourly.nowcast.heavy}</span>
      </div>
      <p className="text-white/45">{m.hourly.nowcast.legend}</p>
      <p className="text-white/40">
        {m.hourly.nowcast.experimental}
        {run && <> · {m.hourly.nowcast.run(run)}</>}
      </p>
    </div>
  );
}

/** How much rain WeatherNext 3's runs give: the bar rises to the 90th percentile, the tick marks the median. */
function RainBar({ hour }: { hour: NowcastHour }) {
  const { m } = useI18n();
  const p90 = hour.p90Mm ?? 0;
  const p50 = hour.p50Mm ?? 0;
  const top = p90 >= RAIN_MM ? legendPosition(PRECIP_SCALE, p90) : 0;
  const mid = p50 >= RAIN_MM ? legendPosition(PRECIP_SCALE, p50) : 0;
  return (
    <span className="flex flex-col items-center gap-1">
      <span
        role="img"
        aria-label={m.hourly.nowcast.bar(mmText(p50), mmText(p90))}
        className="relative block w-1.5 overflow-hidden rounded-full bg-white/10"
        style={{ height: BAR_PX }}
      >
        {top > 0 && (
          <motion.span
            initial={{ height: 0 }}
            animate={{ height: Math.max(3, top * BAR_PX) }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="absolute inset-x-0 bottom-0 overflow-hidden rounded-full"
          >
            <span className="absolute inset-x-0 bottom-0" style={{ height: BAR_PX, background: VERTICAL_RAIN }} />
          </motion.span>
        )}
        {mid > 0 && (
          <span className="absolute inset-x-0 h-0.5 bg-white/90" style={{ bottom: Math.max(1, mid * BAR_PX - 1) }} />
        )}
      </span>
      <span className="text-[10px] tabular-nums text-white/60">
        {p90 >= RAIN_MM ? m.hourly.nowcast.p90(mmText(p90)) : "–"}
      </span>
    </span>
  );
}

/** A chance as WeatherNext 3 gives it: exact, or only bounded. */
function chanceText(hour: NowcastHour, m: Messages): string | null {
  if (hour.chance === null) return null;
  const percent = Math.round(hour.chance * 100);
  if (hour.chanceBound === "at-least") return m.hourly.nowcast.atLeast(percent);
  if (hour.chanceBound === "at-most") return m.hourly.nowcast.atMost(percent);
  return `${percent}%`;
}

function HourChip({
  hour,
  label,
  index,
  highlight,
  ai,
}: {
  hour: HourlyForecast;
  label: string;
  index: number;
  highlight: boolean;
  /** WeatherNext 3's numbers for the hour, when it has them. */
  ai?: NowcastHour;
}) {
  const { m, f } = useI18n();
  const aiChance = ai ? chanceText(ai, m) : null;
  const wet = (ai?.chance ?? hour.precipitationProbability / 100) >= 0.2;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.03, duration: 0.4 }}
      whileHover={{ y: -3 }}
      className={`flex w-[64px] shrink-0 snap-start flex-col items-center gap-2 rounded-2xl py-3 text-center ${
        highlight ? "bg-white/15 ring-1 ring-white/20" : ""
      }`}
    >
      <span className={`text-xs ${highlight ? "font-semibold text-white" : "font-medium text-white/65"}`}>{label}</span>
      <WeatherIcon condition={hour.condition} isDay={hour.isDay} className="size-7" />
      <span className="text-[17px] font-medium">{f.temp(hour.temperatureC)}</span>
      <span className={`flex items-center gap-0.5 text-[11px] ${wet ? "text-sky-200" : "text-white/35"}`}>
        <Droplet className="size-3" aria-hidden />
        {aiChance ?? `${hour.precipitationProbability}%`}
      </span>
      {ai && <RainBar hour={ai} />}
    </motion.div>
  );
}
