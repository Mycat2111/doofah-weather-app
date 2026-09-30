"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle, LocateFixed, MapPin, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { GeolocationStatus } from "@/hooks/useGeolocation";
import { weatherNext3, type Place } from "@/services/WeatherNext3MockService";

interface DooFahHeaderProps {
  place: Place;
  onSelectPlace: (place: Place) => void;
  onLocate: () => void;
  geoStatus: GeolocationStatus;
}

export function DooFahHeader({ place, onSelectPlace, onLocate, geoStatus }: DooFahHeaderProps) {
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
    let cancelled = false;
    const q = query.trim();
    const timer = window.setTimeout(() => {
      if (!q) {
        setResults([]);
        return;
      }
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
      ? "Location permission was denied"
      : geoStatus === "unavailable"
        ? "Location is unavailable"
        : "Use my location";

  return (
    <header className="relative z-30 flex items-center gap-3">
      <motion.div
        className="flex min-w-0 items-baseline gap-2"
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="bg-gradient-to-r from-white via-sky-100 to-amber-100 bg-clip-text text-2xl font-semibold tracking-tight text-transparent sm:text-[28px]">
          DooFah
        </span>
        <span className="hidden text-sm font-medium text-white/55 sm:inline">ดูฟ้า</span>
      </motion.div>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <motion.div
            layout
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className={`glass-chip flex h-11 items-center overflow-hidden rounded-full ${
              open ? "w-[min(78vw,340px)] pl-4 pr-1.5" : "w-auto"
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
                  placeholder="Search a city… (e.g. Chiang Mai)"
                  className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm text-white placeholder:text-white/45 focus:outline-none"
                  role="combobox"
                  aria-expanded={results.length > 0}
                  aria-controls={listId}
                  aria-label="Search for a place"
                />
                <button
                  type="button"
                  onClick={close}
                  className="grid size-8 place-items-center rounded-full text-white/70 hover:bg-white/10"
                  aria-label="Close search"
                >
                  <X className="size-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex h-full items-center gap-2 px-4 text-sm text-white/85 hover:text-white"
                aria-label="Search for a place"
              >
                <Search className="size-4" />
                <span className="hidden max-w-[160px] truncate md:inline">{place.name}</span>
              </button>
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
                className="glass-dark absolute right-0 mt-2 w-[min(78vw,340px)] overflow-hidden rounded-2xl p-1.5 shadow-2xl"
                style={{ background: "rgba(12, 16, 34, 0.9)" }}
              >
                {results.map((r, i) => (
                  <li key={r.id} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(r)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                        i === active ? "bg-white/12" : ""
                      }`}
                    >
                      <MapPin className="size-4 shrink-0 text-sky-300" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-white">
                          {r.name}
                          {r.localName && <span className="ml-1.5 text-white/50">{r.localName}</span>}
                        </span>
                        <span className="block truncate text-xs text-white/50">
                          {[r.region, r.country].filter(Boolean).join(", ")}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
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
        </motion.button>
      </div>
    </header>
  );
}
