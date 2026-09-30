"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LOCALE_COOKIE, type Locale } from "./config";
import { createFormatters, type Formatters } from "./format";
import { MESSAGES, type Messages } from "./messages";

interface I18nContextValue {
  locale: Locale;
  /** UI text in the current language. */
  m: Messages;
  /** Dates, times and temperatures in the current language. */
  f: Formatters;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const ONE_YEAR_S = 60 * 60 * 24 * 365;

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    // Remembered for the next visit; the server reads it to render in this language.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_S}; samesite=lax`;
  }, []);

  // <html lang> drives the Thai typography rules and screen-reader voices.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = MESSAGES[locale].meta.title;
  }, [locale]);

  const value = useMemo(
    () => ({ locale, m: MESSAGES[locale], f: createFormatters(locale), setLocale }),
    [locale, setLocale],
  );
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside <I18nProvider>");
  return context;
}
