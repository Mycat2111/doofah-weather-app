"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Clock, Droplet, Sunrise, Sunset } from "lucide-react";
import { Fragment, useRef } from "react";
import { CardLabel, GlassCard } from "@/components/ui/GlassCard";
import { TapButton } from "@/components/ui/TapButton";
import { WeatherIcon } from "@/components/ui/WeatherIcon";
import { useI18n } from "@/i18n/I18nProvider";
import type { DailyForecast, HourlyForecast } from "@/services/WeatherNext3MockService";

interface HourlyForecastSliderProps {
  hours: HourlyForecast[];
  days: DailyForecast[];
  timeZone: string;
}

type SunEvent = { kind: "sunrise" | "sunset"; time: string };

export function HourlyForecastSlider({ hours, days, timeZone }: HourlyForecastSliderProps) {
  const { m, f } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);

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

  // Live forecasts: each hour's model, named where it starts (and where WRF eases into ECMWF).
  const tagged = hours.some((h) => h.modelUsed);
  const runStarts = (i: number) => i === 0 || hours[i - 1].modelUsed !== hours[i].modelUsed;

  const scrollBy = (dir: 1 | -1) =>
    scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: "smooth" });

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
        {hours.map((h, i) => (
          <Fragment key={h.time}>
            <HourChip
              hour={h}
              label={i === 0 ? m.hourly.now : f.hour(h.time, timeZone)}
              index={i}
              highlight={i === 0}
              model={tagged ? (runStarts(i) ? (h.modelUsed ?? null) : null) : undefined}
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
                <span className="text-xs text-white/70">
                  {e.kind === "sunrise" ? m.hourly.sunrise : m.hourly.sunset}
                </span>
              </motion.div>
            ))}
          </Fragment>
        ))}
      </div>
    </GlassCard>
  );
}

function HourChip({
  hour,
  label,
  index,
  highlight,
  model,
}: {
  hour: HourlyForecast;
  label: string;
  index: number;
  highlight: boolean;
  /** The model's tag where its hours start; null to keep the tag's room; undefined, no tags at all. */
  model?: string | null;
}) {
  const { m, f } = useI18n();
  const wet = hour.precipitationProbability >= 20;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.03, duration: 0.4 }}
      whileHover={{ y: -3 }}
      className={`flex w-[64px] shrink-0 snap-start flex-col items-center gap-2 rounded-2xl py-3 text-center ${
        highlight ? "bg-white/15 ring-1 ring-white/20" : ""
      }`}
      title={hour.modelUsed ? `${m.forecastModel.label}: ${m.forecastModel.about[hour.modelUsed]}` : undefined}
    >
      <span className={`text-xs ${highlight ? "font-semibold text-white" : "font-medium text-white/65"}`}>{label}</span>
      <WeatherIcon condition={hour.condition} isDay={hour.isDay} className="size-7" />
      <span className="text-[17px] font-medium">{f.temp(hour.temperatureC)}</span>
      <span className={`flex items-center gap-0.5 text-[11px] ${wet ? "text-sky-200" : "text-white/35"}`}>
        <Droplet className="size-3" aria-hidden />
        {hour.precipitationProbability}%
      </span>
      {model !== undefined && (
        <span
          className={`h-4 whitespace-nowrap rounded-full px-0.5 text-[9px] font-medium leading-4 ${
            model ? "bg-white/12 text-white/75" : ""
          }`}
        >
          {model}
        </span>
      )}
    </motion.div>
  );
}
