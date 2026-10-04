import { timingSafeEqual } from "node:crypto";

/**
 * Whether `header` is `Bearer <secret>`, compared in constant time. The
 * scheduled callers (the health check and the storm alert job) send
 * CRON_SECRET this way; without a secret nobody is let in.
 */
export function allowed(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const given = Buffer.from(header);
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
