"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface TimelineScrubberProps {
  /** ISO times of every frame, one per hour. */
  times: string[];
  /** Hour offsets matching `times` (e.g. -3 … 24). */
  offsets: number[];
  index: number;
  onIndexChange: (index: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  timeZone: string;
  disabled?: boolean;
}

export function TimelineScrubber({
  times,
  offsets,
  index,
  onIndexChange,
  playing,
  onTogglePlay,
  timeZone,
  disabled,
}: TimelineScrubberProps) {
  const { m, f } = useI18n();
  const count = times.length;
  const nowIndex = Math.max(0, offsets.indexOf(0));
  const offset = offsets[index] ?? 0;
  const pct = (i: number) => (count > 1 ? (i / (count - 1)) * 100 : 0);
  const relative = offset === 0 ? m.radar.now : m.radar.offset(offset);
  const kind = offset < 0 ? m.radar.past : offset === 0 ? m.radar.analysis : m.radar.forecast;

  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        onClick={onTogglePlay}
        disabled={disabled}
        aria-label={playing ? m.radar.pause : m.radar.play}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-slate-900 shadow-lg transition-opacity disabled:opacity-40"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={playing ? "pause" : "play"}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {playing ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium" aria-live="polite">
            <span className={offset === 0 ? "text-sky-200" : ""}>{relative}</span>
            {times[index] && <span className="ml-2 tabular-nums text-white/80">{f.clock(times[index], timeZone)}</span>}
          </p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider th:text-[11.5px] th:tracking-normal ${
              offset < 0 ? "bg-white/10 text-white/70" : offset === 0 ? "bg-sky-300/20 text-sky-100" : "bg-amber-300/15 text-amber-100"
            }`}
          >
            {kind}
          </span>
        </div>

        <div className="relative mt-1">
          {/* Track: past section, then forecast section */}
          <div className="pointer-events-none absolute inset-x-[10px] top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/15">
            <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${pct(nowIndex)}%` }} />
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-300 to-sky-200"
              style={{ width: `${pct(index)}%` }}
            />
          </div>
          {/* Hour ticks */}
          <div className="pointer-events-none absolute inset-x-[10px] top-1/2 h-3 -translate-y-1/2">
            {offsets.map((o, i) => (
              <span
                key={o}
                className={`absolute top-1/2 w-px -translate-y-1/2 ${
                  o === 0 ? "h-3.5 bg-sky-200" : o % 6 === 0 ? "h-2.5 bg-white/50" : "h-1.5 bg-white/25"
                }`}
                style={{ left: `${pct(i)}%` }}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, count - 1)}
            step={1}
            value={index}
            disabled={disabled}
            onChange={(e) => onIndexChange(Number(e.target.value))}
            className="doofah-range relative"
            aria-label={m.radar.mapTime}
            aria-valuetext={`${relative}${times[index] ? `, ${f.clock(times[index], timeZone)}` : ""}`}
          />
        </div>

        <div className="relative mx-[10px] h-3.5 text-[10px] text-white/50">
          {offsets.map((o, i) =>
            o === 0 || (o % 6 === 0 && o > 0) ? (
              <span key={o} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${pct(i)}%` }}>
                {o === 0 ? m.radar.now : times[i] ? f.clock(times[i], timeZone) : ""}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
