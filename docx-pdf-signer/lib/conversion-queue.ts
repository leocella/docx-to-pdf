import { createSemaphore } from "./semaphore";
import { AppError } from "./errors";

const MAX = Number(process.env.MAX_CONCURRENT_CONVERSIONS ?? 2);
const QUEUE_TIMEOUT_MS = Number(process.env.QUEUE_TIMEOUT_MS ?? 30_000);

// Singleton do processo: limita conversões simultâneas no Gotenberg/LibreOffice.
const sem = createSemaphore(MAX);

/** Roda `fn` ocupando uma vaga da fila. Lança AppError("BUSY", 503) se a espera estourar. */
export async function withConversionSlot<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  try {
    release = await sem.acquire(QUEUE_TIMEOUT_MS);
  } catch {
    throw new AppError(
      "BUSY",
      "Servidor ocupado processando outras conversões. Tente em instantes.",
      503,
    );
  }
  try {
    return await fn();
  } finally {
    release();
  }
}
