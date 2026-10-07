/**
 * Calling DooFah's Supabase functions (supabase/migrations) through
 * Supabase's REST API, from the server only: `POST /rest/v1/rpc/<function>`
 * with the project's secret key, which only DooFah's server holds.
 *
 * Set up with SUPABASE_URL and SUPABASE_SECRET_KEY (README: "Shared reports
 * on Supabase"); a project that still uses the older service_role key works
 * with SUPABASE_SERVICE_ROLE_KEY instead.
 */

/** No answer in this long counts as a failure; the page has its own copy meanwhile. */
const TIMEOUT_MS = 8000;

/** Supabase answered with an error, or not at all (status 502). */
export class SupabaseError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseError";
  }
}

export interface Supabase {
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
}

/** Supabase's REST API for the project in `env`, or null while it isn't set up. */
export function supabaseFrom(
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Supabase | null {
  const url = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL)?.trim().replace(/\/+$/, "");
  const key = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !key) return null;
  const headers: Record<string, string> = {
    // Secret keys (sb_secret_…) go in `apikey` only; they aren't JWTs. The older service_role key is one,
    // and goes in both.
    apikey: key,
    ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
    "Content-Type": "application/json",
  };

  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      let response: Response;
      try {
        response = await fetcher(`${url}/rest/v1/rpc/${fn}`, {
          method: "POST",
          headers,
          body: JSON.stringify(args),
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new SupabaseError(502, `no answer: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!response.ok) {
        // PostgREST says what went wrong in `message`; the rest can quote the call's arguments.
        const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
        const message = typeof body?.message === "string" ? body.message.slice(0, 160) : response.statusText;
        throw new SupabaseError(response.status, `${fn} answered ${response.status}: ${message}`);
      }
      return (await response.json()) as T;
    },
  };
}
