// Retry com backoff exponencial + jitter. Só re-tenta erros transitórios.
import { AppError } from "./errors";

const TRANSIENT_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "UND_ERR_CONNECT_TIMEOUT"]);

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export function isTransient(err: unknown): boolean {
  if (err instanceof AppError && err.httpStatus) return TRANSIENT_HTTP.has(err.httpStatus);
  const code = (err as { code?: string } | undefined)?.code;
  if (code && TRANSIENT_CODES.has(code)) return true;
  const name = (err as { name?: string } | undefined)?.name;
  return name === "AbortError"; // timeout
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 400, maxDelayMs = 4000 } = opts;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > retries || !isTransient(err)) throw err;
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.random() * exp * 0.3;
      await sleep(exp + jitter);
    }
  }
}
