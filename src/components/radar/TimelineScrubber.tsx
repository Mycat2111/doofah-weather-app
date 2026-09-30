"use client";

import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { TapButton } from "@/components/ui/TapButton";
import { useI18n } from "@/i18n/I18nProvider";
import { haptic } from "@/lib/haptics";

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

/** A finger has to move this far sideways before it scrubs; up and down swipes scroll the page. */
const TOUCH_SLOP_PX = 6;

/** Hour a key moves to: arrows step one hour, Page Up / Page Down six. */
function keyTarget(key: string, index: number, last: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return index + 1;
    case "ArrowLeft":
    case "ArrowDown":
      return index - 1;
    case "PageUp":
      return index + 6;
    case "PageDown":
      return index - 6;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

interface Gesture {
  pointerId: number;
  startX: number;
  /** False while a touch has not yet moved sideways far enough to scrub. */
  scrubbing: boolean;
  /** Hour last selected during this gesture. */
  index: number;
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
  const last = Math.max(0, count - 1);
  const nowIndex = Math.max(0, offsets.indexOf(0));
  const offset = offsets[index] ?? 0;
  const pct = (i: number) => (last > 0 ? (i / last) * 100 : 0);
  const relative = offset === 0 ? m.radar.now : m.radar.offset(offset);
  const kind = offset < 0 ? m.radar.past : offset === 0 ? m.radar.analysis : m.radar.forecast;
  const clock = times[index] ? f.clock(times[index], timeZone) : "";

  const railRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const reduceMotion = useReducedMotion();
  // Thumb position along the rail, 0 to 1. It follows the finger while
  // scrubbing, then springs onto the selected hour.
  const progress = useMotionValue(last > 0 ? index / last : 0);
  const thumbX = useTransform(progress, (p) => `${p * 100}%`);

  useEffect(() => {
    if (scrubbing) return;
    const target = last > 0 ? index / last : 0;
    if (reduceMotion) {
      progress.set(target);
      return;
    }
    const controls = animate(progress, target, { type: "spring", stiffness: 520, damping: 42 });
    return () => controls.stop();
  }, [index, last, scrubbing, reduceMotion, progress]);

  const fractionAt = (clientX: number) => {
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const select = (g: Gesture, i: number) => {
    if (i === g.index) return;
    g.index = i;
    haptic("selection");
    onIndexChange(i);
  };

  const startScrub = (g: Gesture) => {
    g.scrubbing = true;
    setScrubbing(true);
    if (playing) onTogglePlay();
  };

  const scrubTo = (g: Gesture, clientX: number) => {
    const p = fractionAt(clientX);
    progress.set(p);
    select(g, Math.round(p * last));
  };

  const endGesture = () => {
    gesture.current = null;
    setScrubbing(false);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const g: Gesture = { pointerId: e.pointerId, startX: e.clientX, scrubbing: false, index };
    gesture.current = g;
    e.currentTarget.setPointerCapture(e.pointerId);
    // A mouse or pen scrubs at once; a finger waits to see which way it moves.
    if (e.pointerType !== "touch") {
      startScrub(g);
      scrubTo(g, e.clientX);
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (!g.scrubbing) {
      if (Math.abs(e.clientX - g.startX) < TOUCH_SLOP_PX) return;
      startScrub(g);
    }
    scrubTo(g, e.clientX);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    // A tap without sliding jumps to that hour.
    if (!g.scrubbing) select(g, Math.round(fractionAt(e.clientX) * last));
    endGesture();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const target = keyTarget(e.key, index, last);
    if (target === null) return;
    e.preventDefault();
    const next = Math.min(last, Math.max(0, target));
    if (next !== index) onIndexChange(next);
  };

  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <TapButton
        haptic="light"
        tapScale={0.88}
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
      </TapButton>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium" aria-live="polite">
            <span className={offset === 0 ? "text-sky-200" : ""}>{relative}</span>
            {clock && <span className="ml-2 tabular-nums text-white/80">{clock}</span>}
          </p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider th:text-[11.5px] th:tracking-normal ${
              offset < 0 ? "bg-white/10 text-white/70" : offset === 0 ? "bg-sky-300/20 text-sky-100" : "bg-amber-300/15 text-amber-100"
            }`}
          >
            {kind}
          </span>
        </div>

        {/* 44 px tall for fingers but laid out as 28 px: the extra overlaps the text above and below. */}
        <div
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={m.radar.mapTime}
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={index}
          aria-valuetext={clock ? `${relative}, ${clock}` : relative}
          aria-disabled={disabled || undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={endGesture}
          onLostPointerCapture={endGesture}
          onKeyDown={onKeyDown}
          className={`group relative -my-2 h-11 touch-pan-y select-none outline-none ${disabled ? "" : "cursor-pointer"}`}
        >
          {/* The thumb's centre travels the length of this rail. */}
          <div ref={railRef} className="pointer-events-none absolute inset-x-[10px] top-1/2 h-1 -translate-y-1/2">
            {/* Track: past section, then progress up to the selected hour */}
            <div className="absolute inset-0 overflow-hidden rounded-full bg-white/15">
              <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${pct(nowIndex)}%` }} />
              <motion.div
                className="absolute inset-0 origin-left bg-gradient-to-r from-sky-300 to-sky-200"
                style={{ scaleX: progress }}
              />
            </div>
            {/* Hour ticks */}
            {offsets.map((o, i) => (
              <span
                key={o}
                className={`absolute top-1/2 w-px -translate-y-1/2 ${
                  o === 0 ? "h-3.5 bg-sky-200" : o % 6 === 0 ? "h-2.5 bg-white/50" : "h-1.5 bg-white/25"
                }`}
                style={{ left: `${pct(i)}%` }}
              />
            ))}
            <motion.div className="absolute inset-0" style={{ x: thumbX }}>
              <motion.div
                className={`absolute left-0 top-1/2 -ml-2.5 -mt-2.5 size-5 rounded-full bg-white shadow-[0_0_0_5px_rgba(255,255,255,0.18),0_4px_14px_rgba(0,0,0,0.4)] group-focus-visible:shadow-[0_0_0_6px_rgba(125,211,252,0.55),0_4px_14px_rgba(0,0,0,0.4)] ${
                  disabled ? "opacity-40" : ""
                }`}
                animate={{ scale: scrubbing ? 1.3 : 1 }}
                transition={{ type: "spring", stiffness: 600, damping: 30 }}
              />
              {/* The finger covers the thumb, so show the hour above it while scrubbing. */}
              <AnimatePresence>
                {scrubbing && clock && (
                  <div key="hour" className="absolute bottom-5 left-0 -translate-x-1/2">
                    <motion.span
                      initial={{ opacity: 0, y: 6, scale: 0.8 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.8 }}
                      transition={{ type: "spring", stiffness: 600, damping: 32 }}
                      className="block origin-bottom whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-900 shadow-lg"
                    >
                      {clock}
                    </motion.span>
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>

        <div className="pointer-events-none relative mx-[10px] h-3.5 text-[10px] text-white/50">
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
