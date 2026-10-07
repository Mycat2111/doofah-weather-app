"use client";

import { CloudRain, MapPin, RotateCw, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CardLabel, GlassCard } from "@/components/ui/GlassCard";
import { TapButton } from "@/components/ui/TapButton";
import { useNow } from "@/hooks/useNow";
import { useWxPoint } from "@/hooks/useWxPoint";
import { useI18n } from "@/i18n/I18nProvider";
import type { Formatters } from "@/i18n/format";
import type { Messages } from "@/i18n/messages/types";
import { rainRate, WX_TIME_ZONE, type WxPoint, type WxStep } from "@/lib/wxPoint";
import type { GeoPoint } from "@/services/weather/types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Thai time has no daylight saving: always UTC+7. */
const THAI_OFFSET = 7 * HOUR;
/** How far ahead the graph reaches (ECMWF's 06 and 18 UTC runs end a little sooner). */
const AHEAD = 6 * DAY;
/** Narrower than this per hour and the hourly bars would vanish, so the graph scrolls sideways instead. */
const MIN_PX_PER_HOUR = 6;
const AXIS_W = 36;
/** Day names along the top, the rain below them, hours along the bottom. */
const TOP = 22;
const PLOT_H = 112;
const BOTTOM = 18;
const HEIGHT = TOP + PLOT_H + BOTTOM;
/** The surface gap between touching bars, and the radius of their rounded tops. */
const GAP = 2;
const RADIUS = 4;
/** The rain scale's top, mm/h, with a gridline at half and full: the smallest that holds the wettest bar. */
const TOPS = [2, 4, 10, 20, 40, 100, 200];
/** Checked against the dark glass with the dataviz palette validator (lightness band, contrast ≥ 3:1). */
const BAR = "#2f95dc";
/** The bar being read: one lighter step of the same blue. */
const BAR_ACTIVE = "#7dd3fc";

interface Bar {
  step: WxStep;
  /** The step's span, ms: rain fell between `start` and `end`. */
  start: number;
  end: number;
  /** mm per hour over the step. */
  rate: number | null;
}

/** The steps from the one under way now to 6 days ahead. */
function barsFrom(point: WxPoint, now: number): Bar[] {
  const limit = now + AHEAD;
  return point.steps.flatMap((step) => {
    const end = Date.parse(step.time);
    const start = end - step.periodMinutes * MINUTE;
    if (step.periodMinutes <= 0 || end <= now || start >= limit) return [];
    return [{ step, start, end, rate: rainRate(step) }];
  });
}

const thaiDayStart = (ms: number) => Math.floor((ms + THAI_OFFSET) / DAY) * DAY - THAI_OFFSET;
const thaiDateKey = (ms: number) => new Date(ms + THAI_OFFSET).toISOString().slice(0, 10);
const thaiHour = (ms: number) => new Date(ms + THAI_OFFSET).getUTCHours();

/** "Today", "Tomorrow", then the weekday, for the day `ms` falls on. */
function dayOf(ms: number, now: number, f: Formatters) {
  const index = Math.round((thaiDayStart(ms) - thaiDayStart(now)) / DAY);
  return f.dayName(thaiDateKey(ms), index);
}

/** A bar with a 4 px rounded top, square on the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}

const oneDecimal = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

interface PointForecastCardProps {
  /** The spot the graph is for. */
  point: GeoPoint;
  /** Its name: the place's, or "Tapped spot". */
  name: string;
  /** For a tapped spot: back to the place, with the button's label. */
  back?: { label: string; onBack: () => void };
  className?: string;
}

/**
 * v2 preview (`?v2=1`): rain at a place over the coming days from the v2
 * forecast store, as mm per hour so 1-, 3- and 6-hour steps compare (a 3-hour
 * step is a bar three hours wide). Tap or hover a bar for its rain,
 * temperature, wind and cloud; tap the map to see another spot.
 */
export function PointForecastCard({ point, name, back, className = "" }: PointForecastCardProps) {
  const { m, f, locale } = useI18n();
  const { data, failed, loading, retry } = useWxPoint(point);
  // Bars move on every 10 minutes, not on every tick of the shared clock.
  const clock = useNow();
  const now = clock === null ? null : Math.floor(clock / (10 * MINUTE)) * 10 * MINUTE;
  const bars = useMemo(() => (data && now !== null ? barsFrom(data, now) : []), [data, now]);

  // Nothing there, or not set up: an older spot's graph would only mislead.
  const refused = failed === 404 || failed === 503;
  let body;
  if (refused || (failed !== null && !data)) {
    body = (
      <div className="mt-4 flex min-h-[120px] flex-col items-center justify-center gap-2 text-center text-sm text-white/70">
        <p>{failed === 404 ? m.v2.none : failed === 503 ? m.v2.notSetUp : m.v2.failed}</p>
        {!refused && (
          <TapButton onClick={retry} className="flex items-center gap-1 text-sky-200 hover:text-white">
            <RotateCw className="size-3.5" /> {m.errors.retry}
          </TapButton>
        )}
      </div>
    );
  } else if (!data || now === null || !bars.length) {
    body = (
      <p className="mt-4 flex items-center justify-center text-sm text-white/55" style={{ minHeight: HEIGHT + 32 }}>
        {m.v2.loading}
      </p>
    );
  } else {
    body = (
      <div className={`transition-opacity duration-300 ${loading ? "opacity-60" : ""}`}>
        <RainGraph bars={bars} now={now} name={name} />
        <p className="mt-3 text-xs text-white/50">
          {data.source.label[locale]} ·{" "}
          {m.v2.run(
            f.clock(data.run.time, WX_TIME_ZONE),
            m.v2.ago(Math.floor((now - Date.parse(data.run.time)) / HOUR)),
          )}{" "}
          · {m.v2.gridPoint(data.point.distanceKm.toFixed(1))} · ECMWF {m.footer.via}{" "}
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline decoration-white/30">
            Open-Meteo.com
          </a>{" "}
          (
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-white/30"
          >
            {data.source.licence}
          </a>
          )
        </p>
        <StepTable bars={bars} now={now} />
      </div>
    );
  }

  return (
    <GlassCard className={`p-4 sm:p-5 ${className}`} aria-label={m.v2.title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardLabel icon={<CloudRain className="size-3.5" />}>{m.v2.title}</CardLabel>
        <span className="rounded-full bg-sky-400/15 px-2.5 py-0.5 text-[11px] font-medium text-sky-100 ring-1 ring-sky-300/30">
          {m.v2.preview}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="flex min-w-0 items-center gap-1 font-medium text-white/90">
          <MapPin className="size-3.5 shrink-0 text-sky-200" aria-hidden />
          <span className="truncate">{name}</span>
        </span>
        {back && (
          <TapButton onClick={back.onBack} className="flex items-center gap-1 text-sky-200 hover:text-white">
            <Undo2 className="size-3.5" aria-hidden /> {back.label}
          </TapButton>
        )}
        <span className="text-white/50">{m.v2.tapHint}</span>
      </div>
      {body}
    </GlassCard>
  );
}

/** What one step brings, value first: "1.2 mm (0.4 mm/h) · 31° · Wind 11 km/h from NE · Cloud 80%". */
function stepFacts(step: WxStep, m: Messages, f: Formatters): string[] {
  const rate = rainRate(step);
  const facts = [rate === null || rate < 0.05 ? m.v2.dry : m.v2.rain(oneDecimal(step.precipMm ?? 0), oneDecimal(rate))];
  if (step.tempC !== null) facts.push(f.temp(step.tempC));
  if (step.windMs !== null && step.windDir !== null) {
    const kmh = Math.round(step.windMs * 3.6);
    facts.push(kmh < 1 ? m.v2.calm : m.v2.wind(kmh, m.compass(step.windDir)));
  }
  if (step.cloudPct !== null) facts.push(m.v2.cloud(step.cloudPct));
  return facts;
}

function spanOf(bar: Bar, now: number, m: Messages, f: Formatters) {
  return `${dayOf(bar.start, now, f)} ${m.v2.span(f.clock(bar.start, WX_TIME_ZONE), f.clock(bar.end, WX_TIME_ZONE))}`;
}

function RainGraph({ bars, now, name }: { bars: Bar[]; now: number; name: string }) {
  const { m, f } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const from = bars[0].start;
  const to = bars[bars.length - 1].end;
  const plotW = Math.max(width, ((to - from) / HOUR) * MIN_PX_PER_HOUR);
  const x = (t: number) => ((t - from) / (to - from)) * plotW;
  const wettest = bars.reduce<Bar | null>((a, b) => ((b.rate ?? 0) > (a?.rate ?? 0) ? b : a), null);
  const maxRate = wettest?.rate ?? 0;
  const top = TOPS.find((t) => t >= maxRate) ?? Math.ceil(maxRate / 100) * 100;
  const y = (rate: number) => TOP + PLOT_H - (Math.min(rate, top) / top) * PLOT_H;
  const ticks = [top / 2, top];

  const midnights: number[] = [];
  for (let d = thaiDayStart(from) + DAY; d < to; d += DAY) midnights.push(d);
  // Each day's name at its start (today's at the left edge), where its part of the graph has room for it.
  const days = [from, ...midnights]
    .map((start, i) => ({ start, end: midnights[i] ?? to }))
    .filter((d) => x(d.end) - x(d.start) > 64);
  // 06, 12 and 18 along the bottom (midnight is the line between days), clear of the edges.
  const hours: number[] = [];
  for (let t = thaiDayStart(from) + 6 * HOUR; t < to; t += 6 * HOUR) {
    if (thaiHour(t) !== 0 && x(t) >= 10 && x(t) <= plotW - 10) hours.push(t);
  }

  const shown = active === null ? null : bars[active];
  const readout = shown
    ? `${spanOf(shown, now, m, f)} · ${stepFacts(shown.step, m, f).join(" · ")}`
    : wettest && maxRate >= 0.05
      ? m.v2.wettest(spanOf(wettest, now, m, f), oneDecimal(maxRate))
      : m.v2.noRain;

  // Arrow keys step through the bars, keeping the one being read in view.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = bars.length - 1;
    const next =
      e.key === "ArrowRight"
        ? Math.min(last, (active ?? -1) + 1)
        : e.key === "ArrowLeft"
          ? Math.max(0, (active ?? 1) - 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : e.key === "Escape"
                ? null
                : undefined;
    if (next === undefined) return;
    e.preventDefault();
    setActive(next);
    const el = scroller.current;
    if (el && next !== null) {
      const left = x(bars[next].start);
      const right = x(bars[next].end);
      if (left < el.scrollLeft) el.scrollLeft = left - 8;
      else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth + 8;
    }
  };

  return (
    <div className="mt-3">
      <p aria-live="polite" className="min-h-[2.5rem] text-sm leading-5 text-white/85">
        {readout}
      </p>
      <div className="mt-1 flex">
        {/* The rain scale stays put while the graph scrolls. */}
        <svg width={AXIS_W} height={HEIGHT} className="shrink-0 overflow-visible" aria-hidden>
          <text x={AXIS_W - 6} y={12} textAnchor="end" className="fill-white/45 text-[10px]">
            {m.units.mmPerHour}
          </text>
          {[0, ...ticks].map((t) => (
            <text
              key={t}
              x={AXIS_W - 6}
              y={y(t) + 3.5}
              textAnchor="end"
              className="fill-white/55 text-[10px] tabular-nums"
            >
              {t}
            </text>
          ))}
        </svg>
        <div
          ref={scroller}
          tabIndex={0}
          role="group"
          aria-label={m.v2.chart(name)}
          onKeyDown={onKeyDown}
          onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
          className="no-scrollbar min-w-0 flex-1 overflow-x-auto overscroll-x-contain rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60"
        >
          <svg width={plotW} height={HEIGHT} className="block" aria-hidden>
            {/* Gridlines: hairlines, recessive; the baseline a step stronger. */}
            {ticks.map((t) => (
              <line key={t} x1={0} x2={plotW} y1={y(t)} y2={y(t)} className="stroke-white/10" strokeWidth={1} />
            ))}
            <line x1={0} x2={plotW} y1={y(0) + 0.5} y2={y(0) + 0.5} className="stroke-white/25" strokeWidth={1} />
            {midnights.map((d) => (
              <line
                key={d}
                x1={x(d)}
                x2={x(d)}
                y1={4}
                y2={HEIGHT - BOTTOM}
                className="stroke-white/20"
                strokeWidth={1}
              />
            ))}
            {days.map((d) => (
              <text key={d.start} x={x(d.start) + 5} y={14} className="fill-white/70 text-[11px] font-medium">
                {dayOf(d.start, now, f)}
              </text>
            ))}
            {hours.map((t) => (
              <text
                key={t}
                x={x(t)}
                y={HEIGHT - 4}
                textAnchor="middle"
                className="fill-white/45 text-[10px] tabular-nums"
              >
                {f.hour(t, WX_TIME_ZONE)}
              </text>
            ))}
            {shown && (
              <rect
                x={x(shown.start)}
                y={TOP}
                width={x(shown.end) - x(shown.start)}
                height={PLOT_H}
                className="fill-white/[0.07]"
              />
            )}
            {bars.map((bar, i) => {
              if (bar.rate === null || bar.rate < 0.05) return null;
              const left = x(bar.start) + GAP / 2;
              const w = Math.max(1, x(bar.end) - x(bar.start) - GAP);
              const h = Math.max(1, y(0) - y(bar.rate));
              return <path key={bar.end} d={barPath(left, y(0) - h, w, h)} fill={i === active ? BAR_ACTIVE : BAR} />;
            })}
            {/* Each step's whole column answers the pointer, not only its bar. */}
            {bars.map((bar, i) => (
              <rect
                key={bar.end}
                x={x(bar.start)}
                y={0}
                width={x(bar.end) - x(bar.start)}
                height={HEIGHT}
                fill="transparent"
                onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)}
                onClick={() => setActive(i)}
              />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}

/** Every step as a row, for screen readers and anyone who wants the numbers. */
function StepTable({ bars, now }: { bars: Bar[]; now: number }) {
  const { m, f } = useI18n();
  const { columns } = m.v2;
  return (
    <details className="mt-2 text-xs text-white/60">
      <summary className="cursor-pointer select-none py-1 hover:text-white/80">{m.v2.table}</summary>
      <div className="mt-1 max-h-64 overflow-y-auto rounded-xl bg-white/[0.04]">
        <table className="w-full text-left tabular-nums">
          <thead className="sticky top-0 bg-slate-900/80 text-white/55 backdrop-blur">
            <tr>
              <th className="px-3 py-1.5 font-medium">{columns.time}</th>
              <th className="px-3 py-1.5 text-right font-medium">{columns.rain}</th>
              <th className="px-3 py-1.5 text-right font-medium">{columns.temp}</th>
              <th className="px-3 py-1.5 text-right font-medium">{columns.wind}</th>
              <th className="px-3 py-1.5 text-right font-medium">{columns.cloud}</th>
            </tr>
          </thead>
          <tbody className="text-white/75">
            {bars.map((bar) => {
              const { step } = bar;
              return (
                <tr key={bar.end} className="border-t border-white/5">
                  <td className="px-3 py-1">{spanOf(bar, now, m, f)}</td>
                  <td className="px-3 py-1 text-right">{step.precipMm === null ? "–" : oneDecimal(step.precipMm)}</td>
                  <td className="px-3 py-1 text-right">{step.tempC === null ? "–" : f.temp(step.tempC)}</td>
                  <td className="px-3 py-1 text-right">
                    {step.windMs === null
                      ? "–"
                      : `${Math.round(step.windMs * 3.6)}${step.windDir === null ? "" : ` ${m.compass(step.windDir)}`}`}
                  </td>
                  <td className="px-3 py-1 text-right">{step.cloudPct === null ? "–" : `${step.cloudPct}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
