/**
 * Cache headers for answers that are the same for everyone, split in two:
 * Vercel's CDN reads `Vercel-CDN-Cache-Control` (and never passes it on),
 * and the browser gets `Cache-Control` exactly as written. With only
 * `Cache-Control`, Vercel would keep `s-maxage` for itself and send the
 * browser `max-age=0`, so the browser could not reuse anything.
 */

/** Headers for an answer that is the same for everyone: a short life in the browser, a longer one at Vercel's edge. */
export function cacheHeaders(options: {
  /** Seconds the browser may reuse it without asking. */
  browser: number;
  /** Seconds Vercel's CDN serves it as fresh. */
  fresh: number;
  /** Seconds after that the CDN may still serve it while it fetches a new one in the background. */
  stale: number;
  /** Seconds the CDN may keep serving it when a refresh fails. */
  ifError?: number;
}): Record<string, string> {
  const cdn = [`max-age=${options.fresh}`, `stale-while-revalidate=${options.stale}`];
  if (options.ifError) cdn.push(`stale-if-error=${options.ifError}`);
  return {
    "Cache-Control": `public, max-age=${options.browser}`,
    // Only Vercel reads this one; it is never sent on to the browser.
    "Vercel-CDN-Cache-Control": cdn.join(", "),
  };
}
