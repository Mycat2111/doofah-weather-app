"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BellRing, Star } from "lucide-react";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { FavoriteIcon } from "@/components/favorites/FavoriteIcon";
import { TapButton } from "@/components/ui/TapButton";
import { useFavorites } from "@/hooks/useFavorites";
import { StormAlertsContext } from "@/hooks/useStormAlerts";
import { useI18n } from "@/i18n/I18nProvider";
import { placeLabel } from "@/i18n/places";
import { FAVORITE_KINDS } from "@/lib/favorites";
import { haptic } from "@/lib/haptics";
import type { Place } from "@/services/weather/types";

/**
 * Star beside the place name. One tap saves the place; the panel that opens
 * lets the reader name it ("Home", "Office" or their own) or remove it, and
 * offers storm alerts for saved places while they are off.
 *
 * The panel is positioned against the nearest `relative` ancestor, so the
 * parent decides how wide it is. Key this component by place id so the panel
 * closes when the place changes.
 */
export function FavoriteStar({ place }: { place: Place }) {
  const { locale, m } = useI18n();
  const { find, add, remove, rename } = useFavorites();
  const stormAlerts = useContext(StormAlertsContext);
  const favorite = find(place);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const placeName = placeLabel(place, locale).name;
  const showPanel = open && favorite !== undefined;

  useEffect(() => {
    if (!showPanel) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showPanel]);

  const onStar = () => {
    if (favorite) {
      setOpen((o) => !o);
    } else {
      haptic("success");
      add(place);
      setOpen(true);
    }
  };

  return (
    <div ref={rootRef} className="shrink-0">
      <motion.button
        type="button"
        whileTap={{ scale: 0.85 }}
        onClick={onStar}
        aria-pressed={favorite !== undefined}
        aria-expanded={showPanel}
        aria-controls={showPanel ? panelId : undefined}
        aria-label={favorite ? m.favorites.editFavorite(placeName) : m.favorites.save(placeName)}
        title={favorite ? m.favorites.editFavorite(placeName) : m.favorites.save(placeName)}
        className="grid size-9 place-items-center rounded-full transition-colors hover:bg-white/12"
      >
        <motion.span
          key={favorite ? "on" : "off"}
          initial={{ scale: favorite ? 0.4 : 1, rotate: favorite ? -45 : 0 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 14 }}
        >
          <Star
            className={`size-5 ${
              favorite ? "fill-amber-300 text-amber-300 drop-shadow-[0_0_8px_rgba(252,211,77,0.55)]" : "text-white/70"
            }`}
            aria-hidden
          />
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {showPanel && (
          <motion.div
            id={panelId}
            role="dialog"
            aria-label={m.favorites.saved}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="glass-dark absolute inset-x-0 top-full z-20 mt-3 rounded-2xl p-4 shadow-2xl"
            style={{ background: "rgb(13, 18, 36)" }}
          >
            <p className="flex items-center gap-2 text-sm font-medium">
              <Star className="size-4 fill-amber-300 text-amber-300" aria-hidden />
              {m.favorites.saved}
            </p>

            <label className="mt-3 block text-xs text-white/60">
              {m.favorites.name}
              <input
                value={favorite.name ?? ""}
                // A typed name replaces the quick label.
                onChange={(e) => rename(place, { name: e.target.value, kind: null })}
                onKeyDown={(e) => e.key === "Enter" && setOpen(false)}
                placeholder={favorite.kind ? m.favorites[favorite.kind] : placeName}
                maxLength={40}
                enterKeyHint="done"
                className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-white/8 px-3 text-sm text-white placeholder:text-white/45 focus:border-sky-300/60 focus:outline-none"
              />
            </label>

            <div role="group" aria-label={m.favorites.quickLabels} className="mt-3 flex flex-wrap gap-2">
              {FAVORITE_KINDS.map((kind) => {
                const selected = favorite.kind === kind;
                return (
                  <TapButton
                    key={kind}
                    haptic="selection"
                    aria-pressed={selected}
                    // Stored as a kind, not text, so it follows the UI language.
                    onClick={() => rename(place, selected ? { kind: null } : { kind, name: "" })}
                    className={`flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors ${
                      selected
                        ? "border-white bg-white text-slate-900"
                        : "border-white/15 bg-white/8 text-white/85 hover:bg-white/15"
                    }`}
                  >
                    <FavoriteIcon kind={kind} className="size-4" />
                    {m.favorites[kind]}
                  </TapButton>
                );
              })}
            </div>

            {stormAlerts?.canPrompt && (
              <TapButton
                onClick={() => {
                  setOpen(false);
                  stormAlerts.show();
                }}
                className="mt-3 flex w-full items-center gap-2 rounded-xl border border-amber-200/25 bg-amber-200/10 px-3 py-2.5 text-left text-sm text-amber-50 hover:bg-amber-200/15"
              >
                <BellRing className="size-4 shrink-0 text-amber-200" aria-hidden />
                {m.push.chip}
              </TapButton>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <TapButton
                haptic="light"
                onClick={() => {
                  remove(place);
                  setOpen(false);
                }}
                className="rounded-full px-1 text-sm text-rose-200 hover:text-rose-100"
              >
                {m.favorites.removeShort}
              </TapButton>
              <TapButton
                onClick={() => setOpen(false)}
                className="h-9 rounded-full bg-white px-5 text-sm font-medium text-slate-900 hover:bg-white/90"
              >
                {m.favorites.done}
              </TapButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
