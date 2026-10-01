"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeech } from "./useSpeech";

/** Sentences of audio kept for "Play again" and the next reading. */
const KEPT_SENTENCES = 40;

type Audio = { ctx: AudioContext; buffer: Promise<AudioBuffer> };

const audioContext = () =>
  typeof window === "undefined"
    ? null
    : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);

/**
 * Reads the summary aloud one sentence at a time. With `ai` (the site has a
 * Google Cloud Text-to-Speech key), each sentence comes from /api/voice in a
 * natural AI voice and plays through Web Audio; if that fails, the device's
 * own voice (useSpeech) reads the rest. Without it, the device's voice reads
 * it all.
 */
export function useVoiceReader(lang: string, ai: boolean) {
  const device = useSpeech(lang);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [aiSentence, setAiSentence] = useState(-1);
  const [aiText, setAiText] = useState("");
  /** The AI voice failed on this device or site, so the device reads from now on. */
  const [aiFailed, setAiFailed] = useState(false);
  const run = useRef(0);
  const ctx = useRef<AudioContext | null>(null);
  const playing = useRef<AudioBufferSourceNode | null>(null);
  /** Where the device took over from the AI voice, so its sentences line up with the summary's. */
  const [offset, setOffset] = useState(0);
  const kept = useRef(new Map<string, Audio>());
  const useAi = ai && !aiFailed && !!audioContext();

  /** Silences the AI voice, without touching state (safe in effect cleanups). */
  const cancelAi = useCallback(() => {
    run.current++;
    try {
      playing.current?.stop();
    } catch {
      // Already stopped.
    }
    playing.current = null;
  }, []);

  const stopDevice = device.stop;
  const stop = useCallback(() => {
    cancelAi();
    setAiSpeaking(false);
    setAiSentence(-1);
    stopDevice();
  }, [cancelAi, stopDevice]);

  /** A sentence's audio, downloaded and decoded once. */
  const audioFor = useCallback(
    (context: AudioContext, line: string): Promise<AudioBuffer> => {
      const key = `${lang}|${line}`;
      const hit = kept.current.get(key);
      if (hit && hit.ctx === context) return hit.buffer;
      const buffer = fetch(`/api/voice?${new URLSearchParams({ lang, text: line })}`)
        .then((response) => {
          if (!response.ok) throw new Error(`The voice answered ${response.status}`);
          return response.arrayBuffer();
        })
        .then((data) => context.decodeAudioData(data));
      kept.current.set(key, { ctx: context, buffer });
      buffer.catch(() => kept.current.delete(key));
      while (kept.current.size > KEPT_SENTENCES) kept.current.delete(kept.current.keys().next().value!);
      return buffer;
    },
    [lang],
  );

  const speakDevice = device.speak;
  const speak = useCallback(
    (sentences: string[]) => {
      if (!sentences.length) return;
      stop();
      const Context = audioContext();
      setOffset(0);
      if (!useAi || !Context) return speakDevice(sentences);

      // Made (or woken) inside the tap, or iOS keeps it silent.
      const context = (ctx.current ??= new Context());
      void context.resume();
      // The device's voice may have to take over later, and iOS only lets it speak after a tap: wake it now.
      const synth = window.speechSynthesis;
      if (synth && typeof SpeechSynthesisUtterance !== "undefined") {
        const silence = new SpeechSynthesisUtterance("");
        silence.volume = 0;
        synth.speak(silence);
      }
      const id = run.current;
      setAiText(sentences.join(" "));
      setAiSpeaking(true);
      // Every sentence downloads at once (and finishes even if stopped, for next time); each
      // plays when the one before it ends.
      const buffers = sentences.map((line) => audioFor(context, line));
      buffers.forEach((b) => b.catch(() => undefined));

      void (async () => {
        for (let i = 0; i < sentences.length; i++) {
          let buffer: AudioBuffer;
          try {
            buffer = await buffers[i];
          } catch {
            if (run.current !== id) return;
            // No AI voice (no key, offline, Google down): the device reads from this sentence on.
            setAiFailed(true);
            setAiSpeaking(false);
            setAiSentence(-1);
            setOffset(i);
            speakDevice(sentences.slice(i));
            return;
          }
          if (run.current !== id) return;
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          const ended = new Promise((resolve) => (source.onended = resolve));
          playing.current = source;
          source.start();
          setAiSentence(i);
          await ended;
          if (run.current !== id) return;
        }
        playing.current = null;
        setAiSpeaking(false);
        setAiSentence(-1);
      })();
    },
    [useAi, stop, speakDevice, audioFor],
  );

  // Silence when the component leaves, and let go of the audio hardware.
  useEffect(
    () => () => {
      cancelAi();
      void ctx.current?.close();
      ctx.current = null;
    },
    [cancelAi],
  );

  /** Stops reading without touching state, for effect cleanups. */
  const cancel = useCallback(() => {
    cancelAi();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, [cancelAi]);

  const speaking = aiSpeaking || device.speaking;
  return {
    /** The AI voice reads (else the device's own). */
    ai: useAi,
    /** Something can read aloud: the AI voice or the device. */
    supported: useAi || device.supported,
    /** The device's voice, when it is the one reading. */
    deviceVoice: device.voice,
    /** The device has no voice for the language (only matters when it reads). */
    missingVoice: !useAi && device.missingVoice,
    deviceSupported: device.supported,
    speaking,
    /** Index of the sentence being read, or -1 (also while the first one downloads). */
    sentence: aiSpeaking ? aiSentence : device.sentence < 0 ? -1 : device.sentence + offset,
    /** What is being read. */
    text: aiSpeaking || offset > 0 ? aiText : device.text,
    speak,
    stop,
    cancel,
  };
}
