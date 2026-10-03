"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle, LocateFixed, MapPin, Search, Star, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { LanguageToggle } from "@/components/LanguageToggle";
import { TapButton } from "@/components/ui/TapButton";
import { useFavorites } from "@/hooks/useFavorites";
import type { GeolocationStatus } from "@/hooks/useGeolocation";
import { useI18n } from "@/i18n/I18nProvider";
import { placeLabel } from "@/i18n/places";
import { searchPlaces } from "@/services/weather/places";
import type { Place } from "@/services/weather/types";

interface DooFahHeaderProps {
  place: Place;
  onSelectPlace: (place: Place) => void;
  onLocate: () => void;
  geoStatus: GeolocationStatus;
}

export function DooFahHeader({ place, onSelectPlace, onLocate, geoStatus }: DooFahHeaderProps) {
  const { locale, m } = useI18n();
  const favorites = useFavorites();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    const timer = window.setTimeout(() => {
      if (!q) {
        setResults([]);
        return;
      }
      setResults(searchPlaces(q));
      setActive(0);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setResults([]);
  };

  const choose = (p: Place) => {
    onSelectPlace(p);
    close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && results[active]) {
      choose(results[active]);
    }
  };

  const geoHint =
    geoStatus === "denied"
      ? m.header.locateDenied
      : geoStatus === "unavailable"
        ? m.header.locateUnavailable
        : m.header.locate;

  return (
    <header className="relative z-30 flex items-center gap-3">
      <motion.div
        className={`min-w-0 items-baseline gap-2 ${open ? "hidden sm:flex" : "flex"}`}
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <span
          lang="en"
          className="bg-gradient-to-r from-white via-sky-100 to-amber-100 bg-clip-text text-2xl font-semibold tracking-tight text-transparent sm:text-[28px]"
        >
          DooFah
        </span>
        <span lang="th" className="hidden text-sm font-medium text-white/55 sm:inline">
          ดูฟ้า
        </span>
      </motion.div>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <motion.div
            layout
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className={`glass-chip flex h-11 items-center overflow-hidden rounded-full ${
              open ? "w-[min(74vw,340px)] pl-4 pr-1.5" : "w-auto"
            }`}
          >
            {open ? (
              <>
                <Search className="size-4 shrink-0 text-white/60" aria-hidden />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  onBlur={() => window.setTimeout(close, 150)}
                  placeholder={m.header.searchPlaceholder}
                  className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm text-white placeholder:text-white/45 focus:outline-none"
                  role="combobox"
                  aria-expanded={results.length > 0}
                  aria-controls={listId}
                  aria-label={m.header.searchLabel}
                />
                <TapButton
                  tapScale={0.85}
                  onClick={close}
                  className="grid size-8 place-items-center rounded-full text-white/70 hover:bg-white/10"
                  aria-label={m.header.closeSearch}
                >
                  <X className="size-4" />
                </TapButton>
              </>
            ) : (
              <TapButton
                tapScale={0.92}
                onClick={() => setOpen(true)}
                className="flex h-full items-center gap-2 px-4 text-sm text-white/85 hover:text-white"
                aria-label={m.header.searchLabel}
              >
                <Search className="size-4" />
                <span className="hidden max-w-[160px] truncate md:inline">{placeLabel(place, locale).name}</span>
              </TapButton>
            )}
          </motion.div>

          <AnimatePresence>
            {open && results.length > 0 && (
              <motion.ul
                id={listId}
                role="listbox"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.18 }}
                className="glass-dark absolute right-0 mt-2 w-[min(74vw,340px)] overflow-hidden rounded-2xl p-1.5 shadow-2xl"
                style={{ background: "rgba(12, 16, 34, 0.9)" }}
              >
                {results.map((r, i) => {
                  const label = placeLabel(r, locale);
                  const saved = favorites.find(r) !== undefined;
                  return (
                    <li
                      key={r.id}
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      className={`flex items-center rounded-xl transition-colors ${i === active ? "bg-white/12" : ""}`}
                    >
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(r)}
                        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                      >
                        <MapPin className="size-4 shrink-0 text-sky-300" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-white">
                            {label.name}
                            {label.localName && <span className="ml-1.5 text-white/50">{label.localName}</span>}
                          </span>
                          <span className="block truncate text-xs text-white/50">{label.area}</span>
                        </span>
                      </button>
                      {/* Stars a result without leaving the search. */}
                      <TapButton
                        haptic={saved ? "light" : "success"}
                        tapScale={0.85}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => (saved ? favorites.remove(r) : favorites.add(r))}
                        aria-pressed={saved}
                        aria-label={saved ? m.favorites.remove(label.name) : m.favorites.save(label.name)}
                        title={saved ? m.favorites.remove(label.name) : m.favorites.save(label.name)}
                        className="mr-1 grid size-10 shrink-0 place-items-center rounded-full hover:bg-white/10"
                      >
                        <Star
                          className={`size-4 ${saved ? "fill-amber-300 text-amber-300" : "text-white/45"}`}
                          aria-hidden
                        />
                      </TapButton>
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        <TapButton
          haptic="light"
          tapScale={0.92}
          onClick={onLocate}
          disabled={geoStatus === "locating"}
          title={geoHint}
          aria-label={geoHint}
          className={`glass-chip grid size-11 place-items-center rounded-full transition-colors hover:bg-white/20 ${
            geoStatus === "denied" || geoStatus === "unavailable" ? "text-amber-200" : "text-white"
          }`}
        >
          {geoStatus === "locating" ? (
            <LoaderCircle className="size-[18px] animate-spin" />
          ) : (
            <LocateFixed className="size-[18px]" />
          )}
        </TapButton>

        {/* Makes room for the open search field on phones. */}
        <LanguageToggle className={open ? "hidden sm:flex" : "flex"} />
      </div>
    </header>
  );
}
