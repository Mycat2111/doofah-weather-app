"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AudioLines, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { TapButton } from "@/components/ui/TapButton";
import { useSpeech } from "@/hooks/useSpeech";
import { useI18n } from "@/i18n/I18nProvider";
import type { WeatherSummary } from "@/lib/voiceSummary";

/**
 * "Play AI summary": a floating button that reads the weather summary aloud
 * in Thai or English, with the words on a card that follows along.
 */
export function VoiceSummaryButton({ summary }: { summary: WeatherSummary | null }) {
  const { m } = useI18n();
  const speech = useSpeech(summary?.lang ?? "en-US");
  const [open, setOpen] = useState(false);
  const text = summary?.text ?? "";
  // Only the summary on screen counts as playing: a new place or language is a new summary.
  const playing = speech.speaking && speech.text === text;

  // A new place or language: stop reading the old summary.
  useEffect(
    () => () => {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    },
    [text],
  );

  if (!summary) return null;

  const play = () => {
    setOpen(true);
    if (speech.supported) speech.speak(summary.sentences);
  };
  const close = () => {
    speech.stop();
    setOpen(false);
  };

  return (
    <div className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+16px)] right-4 z-40 flex flex-col items-end gap-3 sm:right-6">
      <AnimatePresence>
        {open && (
          <motion.section
            key="panel"
            aria-label={m.voice.title}
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            style={{ transformOrigin: "bottom right", background: "rgb(12, 16, 34)" }}
            className="glass-dark pointer-events-auto max-h-[min(60vh,440px)] w-[min(calc(100vw-2rem),380px)] overflow-y-auto rounded-3xl p-4 shadow-2xl"
          >
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-sky-400 via-indigo-500 to-fuchsia-500">
                <Sparkles className="size-3.5 text-white" aria-hidden />
              </span>
              <h2 className="flex-1 text-sm font-semibold text-white">{m.voice.title}</h2>
              <TapButton
                tapScale={0.85}
                onClick={close}
                aria-label={m.voice.close}
                className="-mr-1 grid size-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" />
              </TapButton>
            </div>

            <p className="mt-3 text-[15px] leading-relaxed th:leading-loose" aria-live="polite">
              {summary.sentences.map((line, i) => (
                <motion.span
                  key={`${text}-${i}`}
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: 1,
                    color:
                      !playing || i === speech.sentence
                        ? "rgba(255, 255, 255, 0.95)"
                        : i < speech.sentence
                          ? "rgba(255, 255, 255, 0.7)"
                          : "rgba(255, 255, 255, 0.42)",
                  }}
                  transition={{ duration: 0.25, delay: playing ? 0 : i * 0.05 }}
                  className={`rounded-md ${playing && i === speech.sentence ? "bg-white/10 box-decoration-clone px-1 -mx-1" : ""}`}
                >
                  {line}{" "}
                </motion.span>
              ))}
            </p>

            {(!speech.supported || speech.missingVoice) && (
              <p className="mt-3 rounded-xl bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-100 th:text-[13px]">
                {speech.supported ? m.voice.noVoice : m.voice.noSpeech}
              </p>
            )}

            {speech.supported && (
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-[11px] text-white/40">{speech.voice?.name}</span>
                {!playing && (
                  <TapButton
                    onClick={play}
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 th:text-[13px]"
                  >
                    <RotateCcw className="size-3.5" aria-hidden /> {m.voice.replay}
                  </TapButton>
                )}
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      <TapButton
        haptic="light"
        tapScale={0.92}
        onClick={playing ? speech.stop : play}
        aria-label={playing ? m.voice.stop : m.voice.play}
        title={playing ? m.voice.stop : m.voice.play}
        className="group pointer-events-auto relative flex h-14 items-center gap-2.5 rounded-full pl-4 pr-5 text-sm font-semibold text-white shadow-[0_12px_40px_-8px_rgba(99,102,241,0.75)] th:text-[15px]"
      >
        {/* Gradient body with a slow shimmer, and a soft ring that breathes while idle. */}
        <span className="absolute inset-0 overflow-hidden rounded-full bg-gradient-to-br from-sky-400 via-indigo-500 to-fuchsia-500 ring-1 ring-white/30">
          <motion.span
            className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/35 to-transparent"
            animate={{ x: ["0%", "400%"] }}
            transition={{ duration: 2.8, repeat: Infinity, repeatDelay: 2.2, ease: "easeInOut" }}
          />
        </span>
        {!playing && (
          <motion.span
            className="absolute inset-0 rounded-full ring-2 ring-indigo-300/60 motion-reduce:hidden"
            animate={{ scale: [1, 1.18], opacity: [0.7, 0] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 1.5, ease: "easeOut" }}
            aria-hidden
          />
        )}
        <span className="relative grid size-7 place-items-center rounded-full bg-white/20">
          <AnimatePresence mode="wait" initial={false}>
            {playing ? (
              <motion.span
                key="stop"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="flex"
              >
                <Square className="size-3 fill-white" aria-hidden />
              </motion.span>
            ) : (
              <motion.span
                key="play"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="flex"
              >
                <Sparkles className="size-4" aria-hidden />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <span className="relative whitespace-nowrap">
          {playing ? (
            m.voice.stop
          ) : (
            <>
              <span className="sm:hidden">{m.voice.short}</span>
              <span className="hidden sm:inline">{m.voice.play}</span>
            </>
          )}
        </span>
        <span className="relative flex h-4 items-center gap-[3px]" aria-hidden>
          {playing ? (
            [0, 1, 2, 3].map((bar) => (
              <motion.span
                key={bar}
                className="w-[3px] rounded-full bg-white"
                animate={{ height: ["30%", "100%", "45%", "80%", "30%"] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: bar * 0.15, ease: "easeInOut" }}
              />
            ))
          ) : (
            <AudioLines className="size-4 opacity-80" />
          )}
        </span>
      </TapButton>
    </div>
  );
}
