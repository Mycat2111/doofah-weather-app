"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { pickVoice } from "@/lib/speech";

const NO_VOICES: SpeechSynthesisVoice[] = [];
let voices: SpeechSynthesisVoice[] = NO_VOICES;

const synth = () => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);

/** Installed voices, which some browsers only list after a "voiceschanged" event. */
const voiceStore = {
  subscribe(onChange: () => void) {
    const s = synth();
    if (!s) return () => {};
    s.addEventListener("voiceschanged", onChange);
    return () => s.removeEventListener("voiceschanged", onChange);
  },
  getSnapshot() {
    const list = synth()?.getVoices() ?? NO_VOICES;
    // A new array on every call; keep the old one while nothing changed.
    if (list.length !== voices.length || list.some((v, i) => v !== voices[i])) voices = list;
    return voices;
  },
  getServerSnapshot: () => NO_VOICES,
};

const noSubscription = () => () => {};

/**
 * Reads text aloud with the browser's own speech (window.speechSynthesis),
 * one sentence at a time: short utterances start sooner, let the page follow
 * along, and avoid Chrome cutting long ones off after about 15 seconds.
 */
export function useSpeech(lang: string) {
  const supported = useSyncExternalStore(
    noSubscription,
    () => !!synth() && typeof SpeechSynthesisUtterance !== "undefined",
    () => false,
  );
  const installed = useSyncExternalStore(voiceStore.subscribe, voiceStore.getSnapshot, voiceStore.getServerSnapshot);
  const voice = pickVoice(installed, lang);
  const [speaking, setSpeaking] = useState(false);
  const [sentence, setSentence] = useState(-1);
  const [text, setText] = useState("");
  const run = useRef(0);

  const finish = useCallback(() => {
    setSpeaking(false);
    setSentence(-1);
  }, []);

  const stop = useCallback(() => {
    run.current++;
    synth()?.cancel();
    finish();
  }, [finish]);

  const speak = useCallback(
    (sentences: string[]) => {
      const s = synth();
      if (!s || !sentences.length) return;
      s.cancel();
      const id = ++run.current;
      const chosen = pickVoice(s.getVoices(), lang);
      sentences.forEach((line, i) => {
        const utterance = new SpeechSynthesisUtterance(line);
        // Without a Thai voice installed, the language still asks the browser for one.
        utterance.lang = chosen?.lang ?? lang;
        if (chosen) utterance.voice = chosen;
        utterance.rate = lang.startsWith("th") ? 0.95 : 1;
        utterance.onstart = () => {
          if (run.current === id) setSentence(i);
        };
        utterance.onend = () => {
          if (run.current === id && i === sentences.length - 1) finish();
        };
        utterance.onerror = (event) => {
          // Stopping or starting over cancels the queue; that is not a failure.
          if (run.current === id && event.error !== "interrupted" && event.error !== "canceled") finish();
        };
        s.speak(utterance);
      });
      // Chrome on Android can leave the queue paused after the page was in the background.
      s.resume();
      setText(sentences.join(" "));
      setSpeaking(true);
      setSentence(0);
    },
    [lang, finish],
  );

  // Safari sometimes never fires the last "end": check the queue while speaking.
  useEffect(() => {
    if (!speaking) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      const s = synth();
      if (Date.now() - started > 1500 && s && !s.speaking && !s.pending) finish();
    }, 500);
    return () => window.clearInterval(id);
  }, [speaking, finish]);

  // Silence when the page closes or the component leaves.
  useEffect(
    () => () => {
      run.current++;
      synth()?.cancel();
    },
    [],
  );

  return {
    supported,
    /** The voice that will read, or null if the device has none for the language. */
    voice,
    /** The device lists its voices and none speaks the language. */
    missingVoice: supported && installed.length > 0 && !voice,
    speaking,
    /** Index of the sentence being read, or -1. */
    sentence,
    /** What is being read. */
    text,
    speak,
    stop,
  };
}
