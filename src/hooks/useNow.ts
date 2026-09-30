"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 15_000;

// One shared clock for every component that counts down.
let now = 0;
let timer: number | undefined;
const listeners = new Set<() => void>();

function tick() {
  now = Date.now();
  listeners.forEach((listener) => listener());
}

// A phone that wakes up should not show the time it went to sleep with.
function onVisible() {
  if (document.visibilityState === "visible") tick();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) {
    timer = window.setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      timer = undefined;
      now = 0;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

const getSnapshot = () => (now ||= Date.now());
const getServerSnapshot = () => null;

/** The current time in ms, refreshed every 15 seconds; null on the server and while hydrating. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
