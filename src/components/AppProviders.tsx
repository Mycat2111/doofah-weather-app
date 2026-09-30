"use client";

import { MotionConfig } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/config";
import { registerServiceWorker } from "@/lib/pwa";

/** Client-side app setup: language, motion preferences and the offline worker. */
export function AppProviders({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => {
    if (document.readyState === "complete") registerServiceWorker();
    else window.addEventListener("load", registerServiceWorker, { once: true });
  }, []);

  // Safari on iPhone ignores user-scalable=no; its own pinch starts with a
  // "gesturestart" event, which Leaflet does not use, so cancelling it stops
  // the page zooming while the map keeps its pinch.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop, { passive: false });
    document.addEventListener("gesturechange", stop, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
    };
  }, []);

  return (
    // "user": movement is dropped (opacity kept) for readers who ask the OS for reduced motion.
    <MotionConfig reducedMotion="user">
      <I18nProvider initialLocale={locale}>{children}</I18nProvider>
    </MotionConfig>
  );
}
