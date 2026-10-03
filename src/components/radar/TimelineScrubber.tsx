"use client";

import { AnimatePresence, motion, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { TapButton } from "@/components/ui/TapButton";
import { TIMELINE_STEP_MS, toStep } from "@/hooks/useRadarFrames";
import { useI18n } from "@/i18n/I18nProvider";
import { haptic } from "@/lib/haptics";

const HOUR_MS = 3_600_000;

interface TimelineScrubberProps {
  /** The first and last frames' times, ms. */
  start: number;
  end: number;
  /** The frames' hours (ms) and how many hours each is from the current hour, for the ticks and labels. */
  hours: { time: number; offset: number }[];
  /** Now, ms; null until the page runs in the browser. */
  now: number | null;
  /** The time shown, to the 10 minutes; null before the frames arrive. */
  time: number | null;
  /** The map's time, ms, moving smoothly while it plays. */
  playhead: MotionValue<number>;
  /** Go to a time (a whole step): "drag" follows a finger, "jump" glides there (a tap, a key). */
  onSeek: (time: number, how: "drag" | "jump") => void;
  playing: boolean;
  onTogglePlay: () => void;
  timeZone: string;
  disabled?: boolean;
}

/** A finger has to move this far sideways before it scrubs; up and down swipes scroll the page. */
const TOUCH_SLOP_PX = 6;

/** Time a key moves by: arrows step 10 minutes, Page Up / Page Down an hour. */
function keyTarget(key: string, time: number, start: number, end: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return time + TIMELINE_STEP_MS;
    case "ArrowLeft":
    case "ArrowDown":
      return time - TIMELINE_STEP_MS;
    case "PageUp":
      return time + HOUR_MS;
    case "PageDown":
      return time - HOUR_MS;
    case "Home":
      return start;
    case "End":
      return end;
    default:
      return null;
  }
}

interface Gesture {
  pointerId: number;
  startX: number;
  /** False while a touch has not yet moved sideways far enough to scrub. */
  scrubbing: boolean;
  /** Time last selected during this gesture. */
  time: number;
}

export function TimelineScrubber({
  start,
  end,
  hours,
  now,
  time,
  playhead,
  onSeek,
  playing,
  onTogglePlay,
  timeZone,
  disabled,
}: TimelineScrubberProps) {
  const { m, f } = useI18n();
  const span = Math.max(1, end - start);
  const fraction = (ms: number) => Math.min(1, Math.max(0, (ms - start) / span));
  const pct = (ms: number) => fraction(ms) * 100;
  const nowStep = now === null ? null : toStep(now);
  // Minutes from now, in whole steps.
  const minutes = time === null || nowStep === null ? 0 : Math.round((time - nowStep) / 60_000);
  const relative = minutes === 0 ? m.radar.now : m.radar.offset(minutes);
  const kind = minutes < 0 ? m.radar.past : minutes === 0 ? m.radar.analysis : m.radar.forecast;
  const clock = time === null ? "" : f.clock(time, timeZone);
  const steps = Math.round(span / TIMELINE_STEP_MS);

  const railRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  // The thumb's place along the rail, 0 to 1, following the map's time.
  const progress = useMotionValue(0);
  const thumbX = useTransform(progress, (p) => `${p * 100}%`);

  useEffect(() => {
    const follow = () => progress.set(Math.min(1, Math.max(0, (playhead.get() - start) / span)));
    follow();
    return playhead.on("change", follow);
  }, [playhead, progress, start, span]);

  /** The step under a pointer. */
  const timeAt = (clientX: number) => {
    const rect = railRef.current?.getBoundingClientRect();
    const p = !rect || rect.width === 0 ? 0 : Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(end, Math.max(start, toStep(start + p * span)));
  };

  const select = (g: Gesture, t: number, how: "drag" | "jump") => {
    if (t === g.time) return;
    // A tick under the finger on each whole hour, not every 10 minutes.
    if (Math.floor(t / HOUR_MS) !== Math.floor(g.time / HOUR_MS)) haptic("selection");
    g.time = t;
    onSeek(t, how);
  };

  const startScrub = (g: Gesture) => {
    g.scrubbing = true;
    setScrubbing(true);
    if (playing) onTogglePlay();
  };

  const endGesture = () => {
    gesture.current = null;
    setScrubbing(false);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const g: Gesture = { pointerId: e.pointerId, startX: e.clientX, scrubbing: false, time: time ?? start };
    gesture.current = g;
    e.currentTarget.setPointerCapture(e.pointerId);
    // A mouse or pen scrubs at once; a finger waits to see which way it moves.
    if (e.pointerType !== "touch") {
      startScrub(g);
      select(g, timeAt(e.clientX), "drag");
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (!g.scrubbing) {
      if (Math.abs(e.clientX - g.startX) < TOUCH_SLOP_PX) return;
      startScrub(g);
    }
    select(g, timeAt(e.clientX), "drag");
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    // A tap without sliding glides to that time.
    if (!g.scrubbing) select(g, timeAt(e.clientX), "jump");
    endGesture();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || time === null) return;
    const target = keyTarget(e.key, time, start, end);
    if (target === null) return;
    e.preventDefault();
    const next = Math.min(end, Math.max(start, target));
    if (next !== time) onSeek(next, "jump");
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
          <p className="truncate text-sm font-medium" aria-live={playing ? "off" : "polite"}>
            <span className={minutes === 0 ? "text-sky-200" : ""}>{relative}</span>
            {clock && <span className="ml-2 tabular-nums text-white/80">{clock}</span>}
          </p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider th:text-[11.5px] th:tracking-normal ${
              minutes < 0
                ? "bg-white/10 text-white/70"
                : minutes === 0
                  ? "bg-sky-300/20 text-sky-100"
                  : "bg-amber-300/15 text-amber-100"
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
          aria-valuemax={steps}
          aria-valuenow={time === null ? 0 : Math.round((time - start) / TIMELINE_STEP_MS)}
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
            {/* Track: the past, then progress up to the map's time */}
            <div className="absolute inset-0 overflow-hidden rounded-full bg-white/15">
              {now !== null && (
                <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${pct(now)}%` }} />
              )}
              <motion.div
                className="absolute inset-0 origin-left bg-gradient-to-r from-sky-300 to-sky-200"
                style={{ scaleX: progress }}
              />
            </div>
            {/* Hour ticks, and now */}
            {hours.map((h) => (
              <span
                key={h.time}
                className={`absolute top-1/2 w-px -translate-y-1/2 ${h.offset % 6 === 0 ? "h-2.5 bg-white/50" : "h-1.5 bg-white/25"}`}
                style={{ left: `${pct(h.time)}%` }}
              />
            ))}
            {now !== null && (
              <span
                className="absolute top-1/2 h-3.5 w-px -translate-y-1/2 bg-sky-200"
                style={{ left: `${pct(now)}%` }}
              />
            )}
            <motion.div className="absolute inset-0" style={{ x: thumbX }}>
              <motion.div
                className={`absolute left-0 top-1/2 -ml-2.5 -mt-2.5 size-5 rounded-full bg-white shadow-[0_0_0_5px_rgba(255,255,255,0.18),0_4px_14px_rgba(0,0,0,0.4)] group-focus-visible:shadow-[0_0_0_6px_rgba(125,211,252,0.55),0_4px_14px_rgba(0,0,0,0.4)] ${
                  disabled ? "opacity-40" : ""
                }`}
                animate={{ scale: scrubbing ? 1.3 : 1 }}
                transition={{ type: "spring", stiffness: 600, damping: 30 }}
              />
              {/* The finger covers the thumb, so show the time above it while scrubbing. */}
              <AnimatePresence>
                {scrubbing && clock && (
                  <div key="time" className="absolute bottom-5 left-0 -translate-x-1/2">
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
          {now !== null && (
            <span className="absolute -translate-x-1/2 text-sky-200/80" style={{ left: `${pct(now)}%` }}>
              {m.radar.now}
            </span>
          )}
          {hours.map((h) =>
            h.offset > 0 && h.offset % 6 === 0 ? (
              <span key={h.time} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${pct(h.time)}%` }}>
                {f.clock(h.time, timeZone)}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
