// Semáforo assíncrono genérico, em memória, com fila FIFO e timeout de espera.
// Não conhece HTTP nem conversão — só controla N permissões concorrentes.
export interface Semaphore {
  /** Resolve com uma função `release` quando há vaga. Rejeita com Error("QUEUE_TIMEOUT") se a espera estourar. */
  acquire(timeoutMs: number): Promise<() => void>;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createSemaphore(max: number): Semaphore {
  let active = 0;
  const queue: Waiter[] = [];

  // Cada release é idempotente: só age na primeira chamada.
  const makeRelease = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = queue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(makeRelease()); // passa a vaga adiante; active não muda
      } else {
        active -= 1;
      }
    };
  };

  return {
    acquire(timeoutMs: number): Promise<() => void> {
      if (active < max) {
        active += 1;
        return Promise.resolve(makeRelease());
      }
      return new Promise<() => void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = queue.findIndex((w) => w.timer === timer);
          if (idx >= 0) queue.splice(idx, 1);
          reject(new Error("QUEUE_TIMEOUT"));
        }, timeoutMs);
        queue.push({ resolve, reject, timer });
      });
    },
  };
}
