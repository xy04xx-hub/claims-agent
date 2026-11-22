// Retry with full-jitter exponential backoff. Only throttling, 5xx and timeouts are retried.

export interface RetryOptions {
  /** Total tries, including the first. */
  tries: number;
  /** Upper bound of the delay before jitter, in ms. */
  capMs: number;
  /** First backoff step in ms. Default 250. */
  baseMs?: number;
}

export const DEFAULT_RETRY: RetryOptions = { tries: 3, capMs: 4000 };

const RETRYABLE_NAMES = new Set([
  "ThrottlingException",
  "TooManyRequestsException",
  "ServiceUnavailableException",
  "InternalServerException",
  "ModelTimeoutException",
  "ModelNotReadyException",
  "TimeoutError",
  "RequestTimeout",
  "RequestTimeoutException",
  "AbortError",
]);

const RETRYABLE_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ESOCKETTIMEDOUT", "EAI_AGAIN"]);

/** True for throttling (429 or a throttling name), 5xx, and timeouts. False for validation, access and unknown errors. */
export function isRetryable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; code?: unknown; $metadata?: { httpStatusCode?: unknown }; $retryable?: unknown };
  if (typeof e.name === "string" && RETRYABLE_NAMES.has(e.name)) return true;
  if (typeof e.code === "string" && RETRYABLE_CODES.has(e.code)) return true;
  const status = e.$metadata?.httpStatusCode;
  if (typeof status === "number" && (status === 429 || status >= 500)) return true;
  if (typeof e.$retryable === "object" && e.$retryable !== null && (e.$retryable as { throttling?: unknown }).throttling === true) return true;
  return false;
}

/** Delay before the next try. `attempt` is the number of tries already made (1 for the first failure). */
export function backoffDelayMs(attempt: number, opts: RetryOptions, random: () => number): number {
  const base = opts.baseMs ?? 250;
  return Math.min(opts.capMs, base * 2 ** attempt) * random();
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = DEFAULT_RETRY,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  random: () => number = Math.random,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.tries || !isRetryable(err)) throw err;
      await sleep(backoffDelayMs(attempt, opts, random));
    }
  }
}
