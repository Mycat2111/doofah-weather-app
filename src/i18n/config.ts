export const LOCALES = ["th", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Cookie that remembers the reader's choice from the header toggle. */
export const LOCALE_COOKIE = "doofah-locale";

/** Tags handed to Intl for dates and numbers. */
export const INTL_LOCALE: Record<Locale, string> = {
  en: "en-GB",
  th: "th-TH",
};

/** Each language's name, written in that language (for the toggle's labels). */
export const LANGUAGE_NAMES: Record<Locale, string> = {
  en: "English",
  th: "ภาษาไทย",
};

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

/** The supported language the browser ranks highest in `Accept-Language`, if any. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined;
  return header
    .split(",")
    .map((part, order) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { language: tag.trim().toLowerCase().split("-")[0], weight: q ? Number(q.slice(2)) : 1, order };
    })
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.order - b.order)
    .map((entry) => entry.language)
    .find(isLocale);
}
