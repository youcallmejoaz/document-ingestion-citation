/**
 * Retries rate-limit and transient server errors with exponential backoff.
 * The Gemini free tier has low per-minute limits, so ingestion of a large
 * document routinely hits 429s and needs to wait them out.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 6, baseMs = 2000, isRetryable = defaultRetryable } = {},
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i === attempts - 1 || !isRetryable(err)) break;
      const delay = baseMs * 2 ** i + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function defaultRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 429 || status === 408 || (typeof status === "number" && status >= 500);
}
