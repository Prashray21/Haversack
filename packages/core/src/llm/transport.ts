/**
 * LLM transport seam (F2.2). The judge engine depends on this interface, never
 * on a vendor SDK. A transport is raw HTTP: request in, status + body out —
 * trivially mockable, and retries/timeouts live above it where they are
 * testable without network.
 */
export interface LlmHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface LlmHttpResponse {
  status: number;
  /** Retry-After header value when present (seconds, per HTTP semantics). */
  retryAfterSeconds: number | undefined;
  body: string;
}

export interface LlmTransport {
  complete(request: LlmHttpRequest): Promise<LlmHttpResponse>;
}

export interface RetryOptions {
  /** Total attempts = 1 + retries. Default 2 retries. */
  retries?: number;
  /** Base backoff in ms for 429/5xx/network errors without Retry-After. Default 500. */
  backoffMs?: number;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

export type LlmAttempt =
  | { ok: true; response: LlmHttpResponse }
  | { ok: false; status?: number; error: string };

/**
 * Bounded retry with backoff (F2.2): retries 429 and 5xx responses and network
 * failures; honors Retry-After on 429; never retries other 4xx (config errors
 * like 401 fail fast). Errors are returned, never thrown.
 */
export async function completeWithRetry(
  transport: LlmTransport,
  request: LlmHttpRequest,
  options: RetryOptions = {},
): Promise<LlmAttempt> {
  const retries = options.retries ?? 2;
  const backoffMs = options.backoffMs ?? 500;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await transport.complete(request);
      if (response.status >= 200 && response.status < 300) return { ok: true, response };
      if (response.status === 429 || response.status >= 500) {
        if (attempt < retries) {
          const wait = response.status === 429 && response.retryAfterSeconds !== undefined
            ? response.retryAfterSeconds * 1000
            : backoffMs * 2 ** attempt;
          await sleep(wait);
          continue;
        }
        return { ok: false, status: response.status, error: `HTTP ${response.status} after ${attempt + 1} attempt(s)` };
      }
      return { ok: false, status: response.status, error: `HTTP ${response.status} — not retried` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < retries) {
        await sleep(backoffMs * 2 ** attempt);
        continue;
      }
      return { ok: false, error: message };
    }
  }
}

/** Fetch-based transport with a per-attempt timeout (AbortController). */
export function fetchTransport(): LlmTransport {
  return {
    async complete(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const response = await fetch(request.url, {
          method: "POST",
          headers: request.headers,
          body: request.body,
          signal: controller.signal,
        });
        const retryAfter = response.headers.get("retry-after");
        const seconds = retryAfter === null ? undefined : Number(retryAfter);
        return {
          status: response.status,
          retryAfterSeconds: seconds !== undefined && Number.isFinite(seconds) ? seconds : undefined,
          body: await response.text(),
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`request timed out after ${request.timeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
