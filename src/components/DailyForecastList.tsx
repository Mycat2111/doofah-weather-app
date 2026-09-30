"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ChevronDown, Droplet, Droplets, Navigation2, Sun, Sunrise, Sunset, Wind } from "lucide-react";
import { useState } from "react";
import { CardLabel, GlassCard } from "@/components/ui/GlassCard";
import { TapButton } from "@/components/ui/TapButton";
import { WeatherIcon } from "@/components/ui/WeatherIcon";
import { useI18n } from "@/i18n/I18nProvider";
import { temperatureColor } from "@/lib/colors";
import type { DailyForecast } from "@/services/WeatherNext3MockService";

interface DailyForecastListProps {
  days: DailyForecast[];
  timeZone: string;
  currentTempC: number;
}

export function DailyForecastList({ days, timeZone, currentTempC }: DailyForecastListProps) {
  const { m } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);
  const low = Math.min(...days.map((d) => d.minTempC));
  const high = Math.max(...days.map((d) => d.maxTempC));

  return (
    <GlassCard className="p-5" index={4} aria-label={m.daily.label}>
      <CardLabel icon={<CalendarDays className="size-3.5" />}>{m.daily.title}</CardLabel>
      <ul className="mt-2 divide-y divide-white/10">
        {days.map((day, i) => (
          <DayRow
            key={day.date}
            day={day}
            index={i}
            low={low}
            high={high}
            timeZone={timeZone}
            currentTempC={i === 0 ? currentTempC : undefined}
            open={expanded === day.date}
            onToggle={() => setExpanded((d) => (d === day.date ? null : day.date))}
          />
        ))}
      </ul>
    </GlassCard>
  );
}

interface DayRowProps {
  day: DailyForecast;
  index: number;
  low: number;
  high: number;
  timeZone: string;
  currentTempC?: number;
  open: boolean;
  onToggle: () => void;
}

function DayRow({ day, index, low, high, timeZone, currentTempC, open, onToggle }: DayRowProps) {
  const { m, f } = useI18n();
  const span = Math.max(1, high - low);
  const left = ((day.minTempC - low) / span) * 100;
  const width = Math.max(4, ((day.maxTempC - day.minTempC) / span) * 100);
  const panelId = `day-${day.date}`;

  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.15 + index * 0.035, duration: 0.4 }}
    >
      <TapButton
        haptic="selection"
        tapScale={0.985}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="grid w-full grid-cols-[76px_30px_44px_1fr_62px_16px] items-center gap-2 rounded-xl py-3 text-left transition-colors hover:bg-white/[0.06] sm:grid-cols-[96px_40px_52px_36px_1fr_36px_20px] sm:px-1"
      >
        <span className="text-[15px] font-medium leading-tight">
          {f.dayName(day.date, index)}
          <span className="mt-0.5 block text-xs font-normal text-white/55 th:text-[13px]">{f.shortDate(day.date)}</span>
        </span>
        <WeatherIcon condition={day.condition} className="size-6" />
        <span
          className={`flex items-center gap-0.5 text-xs ${day.precipitationProbability >= 30 ? "text-sky-200" : "text-white/35"}`}
        >
          <Droplet className="size-3" aria-hidden />
          {day.precipitationProbability}%
        </span>
        <span className="hidden text-right text-[15px] text-white/55 sm:block">{f.temp(day.minTempC)}</span>
        <span
          className="relative h-1.5 rounded-full bg-black/20"
          aria-label={m.daily.range(f.temp(day.minTempC), f.temp(day.maxTempC))}
        >
          <motion.span
            className="absolute inset-y-0 rounded-full"
            style={{
              background: `linear-gradient(90deg, ${temperatureColor(day.minTempC)}, ${temperatureColor(day.maxTempC)})`,
            }}
            initial={{ left: `${left}%`, width: 0 }}
            animate={{ left: `${left}%`, width: `${width}%` }}
            transition={{ delay: 0.25 + index * 0.035, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          />
          {currentTempC !== undefined && (
            <span
              className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90 bg-white shadow"
              style={{ left: `${Math.min(100, Math.max(0, ((currentTempC - low) / span) * 100))}%` }}
              title={m.daily.nowMarker(f.temp(currentTempC))}
            />
          )}
        </span>
        <span className="text-right text-[15px] font-medium sm:text-left">
          <span className="text-white/55 sm:hidden">{f.temp(day.minTempC)} </span>
          {f.temp(day.maxTempC)}
        </span>
        <ChevronDown
          className={`size-4 text-white/50 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </TapButton>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <DayDetails day={day} timeZone={timeZone} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function DayDetails({ day, timeZone }: { day: DailyForecast; timeZone: string }) {
  const { m, f } = useI18n();
  const stats = [
    {
      icon: <Droplets className="size-4 text-sky-200" />,
      label: m.daily.rain,
      value: `${day.precipitationMm} ${m.units.mm}`,
    },
    {
      icon: (
        <Navigation2
          className="size-4 text-teal-200"
          style={{ transform: `rotate(${day.dominantWindDirectionDeg + 180}deg)` }}
        />
      ),
      label: m.daily.wind,
      value: (
        <>
          <span className="whitespace-nowrap">
            {Math.round(day.maxWindKmh)} {m.units.kmh}
          </span>{" "}
          <span className="whitespace-nowrap">{m.compass(day.dominantWindDirectionDeg)}</span>
        </>
      ),
    },
    {
      icon: <Sun className="size-4 text-amber-200" />,
      label: m.daily.uv,
      value: `${Math.round(day.maxUvIndex)} ${m.uv(day.maxUvIndex)}`,
    },
    { icon: <Wind className="size-4 text-white/70" />, label: m.daily.humidity, value: `${day.meanHumidity}%` },
    {
      icon: <Sunrise className="size-4 text-amber-200" />,
      label: m.daily.sunrise,
      value: day.sunrise ? f.clock(day.sunrise, timeZone) : "—",
    },
    {
      icon: <Sunset className="size-4 text-orange-300" />,
      label: m.daily.sunset,
      value: day.sunset ? f.clock(day.sunset, timeZone) : "—",
    },
  ];

  return (
    <div className="mb-3 rounded-2xl bg-black/15 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-white/90">{m.daySummary(day.outlook)}</p>
        {day.confidence !== null && (
          <p className="text-[11px] text-white/45 th:text-xs">{m.daily.confidence(Math.round(day.confidence * 100))}</p>
        )}
      </div>
      <DaySparkline day={day} timeZone={timeZone} />
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            {s.icon}
            <dt className="text-xs text-white/50">{s.label}</dt>
            <dd className="ml-auto text-right text-sm text-white/90 sm:ml-0 sm:text-left">{s.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Temperature line with rain bars for the 24 hours of one day. */
function DaySparkline({ day, timeZone }: { day: DailyForecast; timeZone: string }) {
  const { m, f } = useI18n();
  const W = 480;
  const H = 86;
  const PAD = 14;
  const temps = day.hours.map((h) => h.temperatureC);
  const tMin = Math.min(...temps);
  const tMax = Math.max(...temps);
  const x = (i: number) => PAD + (i / Math.max(1, day.hours.length - 1)) * (W - PAD * 2);
  const y = (t: number) => 14 + (1 - (t - tMin) / Math.max(1, tMax - tMin)) * (H - 44);
  const path = day.hours.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h.temperatureC).toFixed(1)}`).join(" ");
  const maxRain = Math.max(4, ...day.hours.map((h) => h.precipitationMm));
  const gradientId = `spark-${day.date}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" role="img" aria-label={m.daily.sparkline}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1">
          {day.hours.map((h, i) => (
            <stop key={h.time} offset={`${(i / (day.hours.length - 1)) * 100}%`} stopColor={temperatureColor(h.temperatureC)} />
          ))}
        </linearGradient>
      </defs>
      {day.hours.map((h, i) =>
        h.precipitationMm >= 0.1 ? (
          <rect
            key={`r${h.time}`}
            x={x(i) - 5}
            width={10}
            y={H - 18 - (h.precipitationMm / maxRain) * 26}
            height={(h.precipitationMm / maxRain) * 26}
            rx={2}
            fill="rgba(125, 211, 252, 0.55)"
          />
        ) : null,
      )}
      <motion.path
        d={path}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={2.5}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      />
      {day.hours.map((h, i) =>
        i % 6 === 0 ? (
          <g key={`l${h.time}`}>
            <text x={x(i)} y={y(h.temperatureC) - 6} textAnchor="middle" className="fill-white/80 text-[10px]">
              {f.temp(h.temperatureC)}
            </text>
            <text x={x(i)} y={H - 3} textAnchor="middle" className="fill-white/40 text-[10px]">
              {f.hour(h.time, timeZone)}
            </text>
          </g>
        ) : null,
      )}
    </svg>
  );
}
