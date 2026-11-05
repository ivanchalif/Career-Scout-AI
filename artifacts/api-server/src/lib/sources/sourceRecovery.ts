type Observer = { onRecovery?: (message: string) => void; onRetry?: () => void };
type Clock = { now: () => number; sleep: (milliseconds: number) => Promise<void> };
const clock: Clock = { now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRY_WAIT_MS = 5_000;

export function retryAfterMilliseconds(value: string | null, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export class SourceRequestError extends Error {
  readonly retryAfterMs: number | null;
  constructor(message: string, readonly status: number, retryAfter: string | null = null, now = Date.now()) {
    super(`${message} (${status}).`);
    this.name = "SourceRequestError";
    this.retryAfterMs = retryAfterMilliseconds(retryAfter, now);
  }
}

function transient(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof SourceRequestError) return TRANSIENT_STATUSES.has(error.status);
  return /\((?:408|425|429|500|502|503|504)\)/.test(error.message) ||
    ["AbortError", "TimeoutError"].includes(error.name) ||
    /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(error.message);
}

/** Retry one temporary failure; never retry validation, parsing, or access denial. */
export async function withSourceRecovery<T>(
  operation: () => Promise<T>, onRecovery?: (message: string) => void, timer = clock,
): Promise<T> {
  try { return await operation(); } catch (error) {
    if (!transient(error)) throw error;
    const wait = error instanceof SourceRequestError ? error.retryAfterMs ?? 750 : 750;
    if (wait > MAX_RETRY_WAIT_MS) throw error;
    await timer.sleep(wait);
    const result = await operation();
    onRecovery?.("Automatically recovered a temporary source request failure with one retry.");
    return result;
  }
}

type HttpResult = {
  ok: boolean; status: number;
  headers?: { get: (name: string) => string | null };
  body?: { cancel: () => Promise<void> } | null;
};

/** The installed search connection is shared by sources and users in this process. */
export function createSearchRequestQueue(options: Partial<Clock> & {
  intervalMs?: number; maxPending?: number; maxQueueWaitMs?: number;
} = {}) {
  const timer = { ...clock, ...options };
  const interval = options.intervalMs ?? 1_100;
  const maxPending = options.maxPending ?? 64;
  const maxQueueWait = options.maxQueueWaitMs ?? 60_000;
  let tail = Promise.resolve();
  let pending = 0;
  let nextStart = 0;
  let cooldownError: Error | null = null;
  return async function request<T extends HttpResult>(operation: () => Promise<T>, observer: Observer = {}): Promise<T> {
    if (pending >= maxPending) throw new Error("Web search is busy; retry on the next discovery run.");
    pending++;
    const queuedAt = timer.now();
    const task = tail.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const wait = Math.max(0, nextStart - timer.now());
        if (cooldownError && wait > MAX_RETRY_WAIT_MS) {
          throw new Error(`${cooldownError.message} Search is cooling down; retry after ${Math.ceil(wait / 1000)} seconds.`);
        }
        if (timer.now() - queuedAt + wait > maxQueueWait) throw new Error("Web search queue reached its time limit; retry on the next discovery run.");
        if (wait) await timer.sleep(wait);
        nextStart = timer.now() + interval;
        if (attempt) observer.onRetry?.();
        try {
          const response = await operation();
          if (!response.ok) {
            const error = new SourceRequestError("Web search request failed", response.status, response.headers?.get("retry-after") ?? null, timer.now());
            await response.body?.cancel().catch(() => {});
            throw error;
          }
          cooldownError = null;
          if (attempt) observer.onRecovery?.("Automatically recovered web search after a temporary failure; shared search requests are paced to prevent rate limits.");
          return response;
        } catch (error) {
          if (!transient(error)) throw error;
          const delay = error instanceof SourceRequestError ? error.retryAfterMs ?? interval * 2 ** attempt : interval * 2 ** attempt;
          nextStart = Math.max(nextStart, timer.now() + delay);
          cooldownError = error instanceof Error ? error : null;
          if (attempt === 2) throw error;
        }
      }
      throw new Error("Web search retry limit reached.");
    });
    tail = task.then(() => undefined, () => undefined);
    return task.finally(() => { pending--; });
  };
}

export const pacedSearchRequest = createSearchRequestQueue();
