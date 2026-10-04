"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, BellOff, BellRing, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { CycloneIcon } from "@/components/ui/CycloneIcon";
import { TapButton } from "@/components/ui/TapButton";
import type { StormAlerts } from "@/hooks/useStormAlerts";
import { useI18n } from "@/i18n/I18nProvider";
import { ALERT_KM } from "@/lib/cyclones";

interface StormAlertsButtonProps {
  alerts: StormAlerts;
  /** Display classes, so the header can hide the bell while the search is open on phones. */
  className?: string;
}

/**
 * The bell in the header and its card: what storm alerts do and what DooFah
 * keeps, then Turn on / Not now; how to get them on an iPhone; where to allow
 * them again when blocked; and, once on, a test and Turn off. The card is
 * placed against the header (the nearest positioned box), so it fits on a
 * narrow phone wherever the bell sits.
 */
export function StormAlertsButton({ alerts, className = "" }: StormAlertsButtonProps) {
  const { m } = useI18n();
  const bell = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { state, open, close } = alerts;

  // A tap anywhere else or Escape closes the card; a card opened unasked is brought into view.
  useEffect(() => {
    if (!open) return;
    const box = card.current?.getBoundingClientRect();
    if (box && (box.top < 0 || box.bottom > window.innerHeight)) {
      card.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!card.current?.contains(target) && !bell.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      bell.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (state === "hidden") return null;

  const label = state === "on" ? m.push.bellOn : m.push.title;
  const BellIcon = state === "on" ? BellRing : state === "denied" ? BellOff : Bell;

  return (
    <>
      <TapButton
        ref={bell}
        tapScale={0.92}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={alerts.toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        title={label}
        className={`glass-chip size-11 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/20 max-[379px]:size-10 ${
          open ? "bg-white/20" : ""
        } ${className}`}
      >
        <BellIcon
          className={`size-[18px] ${state === "on" ? "text-amber-200" : state === "denied" ? "text-white/60" : "text-white"}`}
          aria-hidden
        />
      </TapButton>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={card}
            role="dialog"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="glass-dark absolute right-0 top-full z-40 mt-2 w-[min(100%,360px)] origin-top-right rounded-3xl p-4 shadow-2xl"
            // Solid, like the star's panel: the blur does not reach through the header.
            style={{ background: "rgb(13, 18, 36)" }}
          >
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-200 text-amber-950">
                <CycloneIcon className="size-5" aria-hidden />
              </span>
              <h2 id={titleId} className="min-w-0 flex-1 text-base font-semibold">
                {m.push.title}
              </h2>
              <TapButton
                tapScale={0.85}
                onClick={() => {
                  close();
                  bell.current?.focus();
                }}
                aria-label={m.push.close}
                title={m.push.close}
                className="-mr-1 grid size-9 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" aria-hidden />
              </TapButton>
            </div>

            <div className="mt-3 space-y-3 text-sm leading-relaxed text-white/80">
              <CardBody alerts={alerts} />
            </div>

            {alerts.message && (
              <p
                role="status"
                className={`mt-3 rounded-2xl px-3 py-2 text-sm ${
                  alerts.message === "testSent"
                    ? "bg-emerald-400/15 text-emerald-100"
                    : alerts.message === "testWait"
                      ? "bg-amber-300/15 text-amber-100"
                      : "bg-rose-400/15 text-rose-100"
                }`}
              >
                {m.push[alerts.message]}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function CardBody({ alerts }: { alerts: StormAlerts }) {
  const { m } = useI18n();
  switch (alerts.state) {
    case "install":
      return <p>{m.push.install}</p>;
    case "denied":
      return <p>{m.push.blocked}</p>;
    case "ask":
      return (
        <>
          <p>{m.push.why(ALERT_KM)}</p>
          <details className="group rounded-2xl bg-white/[0.06] px-3 py-2 text-[13px] text-white/70">
            <summary className="cursor-pointer select-none font-medium text-white/85">{m.push.detailsLabel}</summary>
            <p className="mt-1.5">{m.push.details}</p>
          </details>
          <div className="flex flex-wrap gap-2 pt-1">
            <CardButton primary haptic onClick={alerts.on} busy={alerts.busy === "on"} disabled={alerts.busy !== null}>
              {m.push.turnOn}
            </CardButton>
            <CardButton onClick={alerts.close} disabled={alerts.busy !== null}>
              {m.push.notNow}
            </CardButton>
          </div>
        </>
      );
    case "on":
      return (
        <>
          <p className="flex items-center gap-2 font-medium text-white">
            <BellRing className="size-4 shrink-0 text-amber-200" aria-hidden />
            {m.push.on(alerts.places)}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <CardButton onClick={alerts.test} busy={alerts.busy === "test"} disabled={alerts.busy !== null}>
              {m.push.sendTest}
            </CardButton>
            <CardButton haptic onClick={alerts.off} busy={alerts.busy === "off"} disabled={alerts.busy !== null}>
              {m.push.turnOff}
            </CardButton>
          </div>
        </>
      );
    default:
      return null;
  }
}

interface CardButtonProps {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  /** A toggle (on or off): it ticks when tapped. */
  haptic?: boolean;
  /** Working: disabled, with a spinner. */
  busy?: boolean;
  disabled?: boolean;
}

function CardButton({ children, onClick, primary, haptic, busy, disabled }: CardButtonProps) {
  return (
    <TapButton
      haptic={haptic ? (primary ? "success" : "light") : undefined}
      onClick={onClick}
      disabled={busy || disabled}
      className={`flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-opacity disabled:opacity-60 ${
        primary ? "bg-white text-slate-900" : "border border-white/20 bg-white/10 text-white hover:bg-white/15"
      }`}
    >
      {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </TapButton>
  );
}
