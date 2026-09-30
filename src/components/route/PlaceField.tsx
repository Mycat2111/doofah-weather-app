"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Flag, LoaderCircle, LocateFixed, MapPin } from "lucide-react";
import { useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { FavoriteIcon } from "@/components/favorites/FavoriteIcon";
import { useFavorites } from "@/hooks/useFavorites";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useI18n } from "@/i18n/I18nProvider";
import { favoriteName, placeLabel } from "@/i18n/places";
import { isSamePlace } from "@/lib/favorites";
import { weatherNext3, type GeoPoint, type Place } from "@/services/WeatherNext3MockService";

interface Option {
  key: string;
  icon: ReactNode;
  label: string;
  detail?: string;
  /** A place, or null for "my location" (a GPS fix first). */
  place: Place | null;
}

interface PlaceFieldProps {
  label: string;
  role: "start" | "end";
  value: Place | null;
  placeholder: string;
  onChange: (place: Place) => void;
  /** The dashboard's place, offered first. */
  current: Place;
}

/** A place picker: your location, the dashboard's place and favorites at a tap, or search by name. */
export function PlaceField({ label, role, value, placeholder, onChange, current }: PlaceFieldProps) {
  const { locale, m } = useI18n();
  const { favorites } = useFavorites();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [active, setActive] = useState(0);
  const listId = useId();

  const onLocated = useCallback((point: GeoPoint) => onChange(weatherNext3.placeForPoint(point)), [onChange]);
  const geo = useGeolocation(onLocated);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    const timer = window.setTimeout(() => {
      if (!q) return setResults([]);
      weatherNext3.searchPlaces(q).then((found) => {
        if (!cancelled) {
          setResults(found);
          setActive(0);
        }
      });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const describe = (p: Place) => placeLabel(p, locale);
  const quick: Option[] = [
    { key: "gps", icon: <LocateFixed className="size-4 text-sky-300" />, label: m.route.myLocation, place: null },
    ...[current, ...favorites.map((f) => f.place)]
      .filter((p, i, all) => all.findIndex((q) => isSamePlace(q, p)) === i)
      .slice(0, 5)
      .map((p) => {
        const fav = favorites.find((f) => isSamePlace(f.place, p));
        return {
          key: p.id,
          icon: <FavoriteIcon kind={fav?.kind} className={`size-4 ${fav ? "text-amber-300" : "text-sky-300"}`} />,
          label: fav ? favoriteName(fav, locale, m) : describe(p).name,
          detail: describe(p).area,
          place: p,
        };
      }),
  ];
  const options: Option[] = query.trim()
    ? results.map((p) => ({
        key: p.id,
        icon: <MapPin className="size-4 text-sky-300" />,
        label: describe(p).name,
        detail: describe(p).area,
        place: p,
      }))
    : quick;

  const close = () => {
    setEditing(false);
    setQuery("");
    setResults([]);
  };
  const choose = (option: Option) => {
    if (option.place) onChange(option.place);
    else geo.locate();
    close();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && options[active]) {
      e.preventDefault();
      choose(options[active]);
    }
  };

  const shown = value ? describe(value).name : "";
  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-3">
      <span className="grid w-5 shrink-0 place-items-center" aria-hidden>
        {role === "start" ? (
          <span className="size-3 rounded-full border-[3px] border-sky-300 bg-slate-900" />
        ) : (
          <Flag className="size-4 fill-rose-400/80 text-rose-300" />
        )}
      </span>
      <label className="min-w-0 flex-1">
        <span className="block text-[10px] font-medium uppercase tracking-[0.12em] text-white/45 th:text-xs th:normal-case th:tracking-normal">
          {label}
        </span>
        <input
          value={editing ? query : shown}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            setEditing(true);
            setActive(0);
          }}
          onBlur={() => window.setTimeout(close, 150)}
          onKeyDown={onKeyDown}
          placeholder={editing ? shown || m.route.searchPlaceholder : placeholder}
          className="block h-7 w-full min-w-0 truncate bg-transparent text-[15px] font-medium text-white placeholder:font-normal placeholder:text-white/40 focus:outline-none"
          role="combobox"
          aria-expanded={editing && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          enterKeyHint="go"
        />
      </label>
      {geo.status === "locating" && <LoaderCircle className="size-4 shrink-0 animate-spin text-sky-200" />}

      <AnimatePresence>
        {editing && options.length > 0 && (
          <motion.ul
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="glass-dark absolute left-6 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl p-1.5 shadow-2xl"
            style={{ background: "rgba(12, 16, 34, 0.94)" }}
          >
            {options.map((option, i) => (
              <li key={option.key} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(option)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    i === active ? "bg-white/12" : ""
                  }`}
                >
                  <span className="shrink-0" aria-hidden>
                    {option.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{option.label}</span>
                    {option.detail && <span className="block truncate text-xs text-white/50">{option.detail}</span>}
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
