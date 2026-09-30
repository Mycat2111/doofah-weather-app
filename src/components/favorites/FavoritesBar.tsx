"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Pencil, Star, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { FavoriteIcon } from "@/components/favorites/FavoriteIcon";
import { TapButton } from "@/components/ui/TapButton";
import { WeatherIcon } from "@/components/ui/WeatherIcon";
import { useFavorites } from "@/hooks/useFavorites";
import { useSpotWeather } from "@/hooks/useSpotWeather";
import { useI18n } from "@/i18n/I18nProvider";
import { favoriteName, placeLabel } from "@/i18n/places";
import { haptic } from "@/lib/haptics";
import type { WeatherService } from "@/services/weatherService";
import type { Place } from "@/services/WeatherNext3MockService";

interface FavoritesBarProps {
  place: Place;
  onSelectPlace: (place: Place) => void;
  weather: WeatherService;
  /** Time of the dashboard's current conditions, so the chips and the hero agree. */
  sampleTime?: number;
}

const noop = () => () => {};

/** One-tap chips for starred places, under the header. */
export function FavoritesBar({ place, onSelectPlace, weather, sampleTime }: FavoritesBarProps) {
  const { locale, m, f } = useI18n();
  const { favorites, find, remove } = useFavorites();
  const [editing, setEditing] = useState(false);
  // Favorites live in localStorage, so the server renders an empty bar. Wait
  // for the client before showing the "tap the star" hint to avoid a flash.
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const active = find(place);
  const isEditing = editing && favorites.length > 0;

  const samples = useSpotWeather(
    weather,
    favorites.map((fav) => fav.place.point),
    sampleTime,
  );

  return (
    <nav aria-label={m.favorites.label} className="mt-4 flex min-h-12 items-center gap-2">
      {/* Chips fade out at both ends while the row scrolls. */}
      <div className="no-scrollbar -ml-3 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1 pl-3 pr-6 [mask-image:linear-gradient(to_right,transparent,#000_12px,#000_calc(100%_-_24px),transparent)]">
        {hydrated && favorites.length === 0 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 px-1 text-sm text-white/60"
          >
            <Star className="size-4 shrink-0" aria-hidden />
            {m.favorites.empty}
          </motion.p>
        )}

        <AnimatePresence initial={false}>
          {favorites.map((fav, i) => {
            const name = favoriteName(fav, locale, m);
            const label = placeLabel(fav.place, locale);
            const sample = samples[i];
            const selected = fav === active;
            return (
              <motion.div
                key={fav.place.id}
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
                className={`flex h-10 shrink-0 items-center rounded-full border backdrop-blur-md transition-colors ${
                  selected ? "border-white/70 bg-white/28" : "border-white/16 bg-white/12 hover:bg-white/20"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!selected) haptic("selection");
                    onSelectPlace(fav.place);
                  }}
                  aria-current={selected ? "location" : undefined}
                  title={[label.name, label.area].filter(Boolean).join(" · ")}
                  className={`flex h-full items-center gap-2 pl-3 text-sm text-white ${isEditing ? "pr-1.5" : "pr-3.5"}`}
                >
                  <FavoriteIcon kind={fav.kind} className="size-4 shrink-0 text-white/75" />
                  <span className="max-w-[10rem] truncate font-medium">{name}</span>
                  {sample && (
                    <>
                      <WeatherIcon condition={sample.condition} isDay={sample.isDay} className="size-4 shrink-0" />
                      <span className="tabular-nums text-white/85">{f.temp(sample.temperatureC)}</span>
                    </>
                  )}
                </button>
                {isEditing && (
                  <button
                    type="button"
                    onClick={() => {
                      haptic("light");
                      remove(fav.place);
                    }}
                    aria-label={m.favorites.remove(name)}
                    title={m.favorites.remove(name)}
                    className="mr-1 grid size-8 place-items-center rounded-full text-white/80 hover:bg-white/15 hover:text-white"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {favorites.length > 0 && (
        <TapButton
          onClick={() => setEditing(!isEditing)}
          aria-pressed={isEditing}
          className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors ${
            isEditing
              ? "border-white bg-white font-medium text-slate-900"
              : "glass-chip text-white/85 hover:bg-white/20"
          }`}
        >
          {isEditing ? <Check className="size-4" aria-hidden /> : <Pencil className="size-3.5" aria-hidden />}
          {isEditing ? m.favorites.done : m.favorites.edit}
        </TapButton>
      )}
    </nav>
  );
}
