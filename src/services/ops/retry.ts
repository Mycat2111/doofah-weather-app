/** Asking a source again after a failure that may pass: a timeout, a dropped connection or a 5xx. */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  /** Tries in all, the first included. */
  tries?: number;
  /** Wait before the next try, ms (±25%, so many servers don't ask again at the same moment). */
  delayMs?: number;
  /** Whether this failure may pass if asked again. */
  retryable: (error: unknown) => boolean;
  wait?: (ms: number) => Promise<void>;
}

/** `attempt` until it succeeds, a failure isn't retryable, or the tries run out (then its last error). */
export async function withRetry<T>(
  attempt: (n: number) => Promise<T>,
  { tries = 2, delayMs = 500, retryable, wait = sleep }: RetryOptions,
): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await attempt(n);
    } catch (error) {
      if (n >= tries || !retryable(error)) throw error;
      await wait(delayMs * (0.75 + Math.random() * 0.5));
    }
  }
}

/** A source's error with an HTTP status (no answer at all counts as 502): worth asking again for 5xx only, never 4xx or 429. */
export const isTransient = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "status" in error && Number(error.status) >= 500;
