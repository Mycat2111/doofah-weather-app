"use client";

import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { useFavorites } from "@/hooks/useFavorites";
import { useI18n } from "@/i18n/I18nProvider";
import { favoriteName, placeLabel } from "@/i18n/places";
import {
  isSnoozed,
  MAX_PLACES,
  pushPlaces,
  pushState,
  sendTest,
  snooze,
  sync,
  turnOff,
  turnOn,
  type PushPlace,
  type PushState,
} from "@/lib/push";
import type { Place } from "@/services/weather/types";

export type StormAlertsMessage = "testSent" | "testWait" | "failed";
export type StormAlertsAction = "on" | "off" | "test";

export interface StormAlerts {
  state: PushState;
  /** How many places are (or would be) watched for this device. */
  places: number;
  /** The tap being worked on. */
  busy: StormAlertsAction | null;
  /** The outcome of the last tap in the card. */
  message: StormAlertsMessage | null;
  /** The card under the bell. */
  open: boolean;
  /**
   * Whether to offer alerts unasked (a link on the storm banner and in the
   * panel a star opens): they are off but could be on, and the card wasn't
   * closed with them off in the last 30 days.
   */
  canPrompt: boolean;
  show(): void;
  toggle(): void;
  /** Closing the card while alerts are off counts as "Not now". */
  close(): void;
  on(): void;
  off(): void;
  test(): void;
}

/** The dashboard's storm alerts, for the star's panel deep in the page. Null outside the dashboard. */
export const StormAlertsContext = createContext<StormAlerts | null>(null);

/**
 * Storm alerts for this device: its state, the card's open state, and the
 * taps that turn alerts on and off. The places watched are the saved ones,
 * or the place on screen when none are saved, in the reader's language;
 * while alerts are on they are sent again whenever they change.
 */
export function useStormAlerts(current: Place): StormAlerts {
  const { locale, m } = useI18n();
  const { favorites } = useFavorites();
  const [state, setState] = useState<PushState>("hidden");
  const [snoozed, setSnoozed] = useState(true);
  const [places, setPlaces] = useState<PushPlace[]>([]);
  const [busy, setBusy] = useState<StormAlertsAction | null>(null);
  const [message, setMessage] = useState<StormAlertsMessage | null>(null);
  const [open, setOpen] = useState(false);

  // Checked again on return to the page: the permission may have been changed in Settings meanwhile.
  useEffect(() => {
    let live = true;
    const check = () =>
      pushState().then((s) => {
        if (!live) return;
        setState(s);
        setSnoozed(isSnoozed());
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const named = useMemo(
    () =>
      favorites.length
        ? favorites.map((f) => ({ id: f.place.id, name: favoriteName(f, locale, m), point: f.place.point }))
        : [{ id: current.id, name: placeLabel(current, locale).name, point: current.point }],
    [favorites, current, locale, m],
  );
  useEffect(() => {
    let live = true;
    pushPlaces(named)
      .then((list) => live && setPlaces(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [named]);

  useEffect(() => {
    if (state === "on" && places.length) sync(places, locale).catch(() => undefined);
  }, [state, places, locale]);

  const canPrompt = (state === "ask" || state === "install") && !snoozed;

  const show = useCallback(() => {
    setMessage(null);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setMessage(null);
    if (state === "ask" || state === "install") {
      snooze();
      setSnoozed(true);
    }
  }, [state]);

  const toggle = useCallback(() => (open ? close() : show()), [open, close, show]);

  const on = useCallback(() => {
    setBusy("on");
    setMessage(null);
    // Nothing is awaited before turnOn: it asks for permission first, inside this tap.
    turnOn(places, locale)
      .then(setState)
      .catch(() => {
        setMessage("failed");
        return pushState().then(setState);
      })
      .finally(() => setBusy(null));
  }, [places, locale]);

  const off = useCallback(() => {
    setBusy("off");
    setMessage(null);
    turnOff()
      .then(() => setState("ask"))
      .catch(() => setMessage("failed"))
      .finally(() => setBusy(null));
  }, []);

  const test = useCallback(() => {
    setBusy("test");
    setMessage(null);
    sendTest(places, locale)
      .then((result) => {
        if (result === "gone") {
          // This device's subscription ended: alerts are off and can be turned on again.
          setMessage("failed");
          return pushState().then(setState);
        }
        setMessage(result === "sent" ? "testSent" : result === "wait" ? "testWait" : "failed");
      })
      .catch(() => setMessage("failed"))
      .finally(() => setBusy(null));
  }, [places, locale]);

  return useMemo(
    () => ({
      state,
      places: Math.min(named.length, MAX_PLACES),
      busy,
      message,
      open,
      canPrompt,
      show,
      toggle,
      close,
      on,
      off,
      test,
    }),
    [state, named.length, busy, message, open, canPrompt, show, toggle, close, on, off, test],
  );
}
