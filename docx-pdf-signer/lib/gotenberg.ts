import { AppError } from "./errors";
import { withRetry } from "./retry";

const GOTENBERG_URL = process.env.GOTENBERG_URL ?? "http://gotenberg:3000";
const TIMEOUT_MS = Number(process.env.GOTENBERG_TIMEOUT_MS ?? 120_000);

/**
 * Converte um DOCX em PDF usando o LibreOffice headless do Gotenberg.
 * Alta fidelidade de layout. Robusto: timeout + retry em falhas transitórias.
 */
export async function convertDocxToPdf(bytes: Uint8Array, filename: string): Promise<Uint8Array> {
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const form = new FormData();
      const safe = filename.toLowerCase().endsWith(".docx") ? filename : `${filename}.docx`;
      form.append(
        "files",
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        safe,
      );

      const res = await fetch(`${GOTENBERG_URL}/forms/libreoffice/convert`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        if (res.status >= 400 && res.status < 500) {
          throw new AppError(
            "CONVERT_REJECTED",
            "Não foi possível converter este arquivo. Verifique se o .docx não está corrompido.",
            422,
            detail,
          );
        }
        // 5xx → transitório, withRetry vai re-tentar
        throw new AppError("GOTENBERG_ERROR", "Serviço de conversão indisponível.", res.status, detail);
      }

      return new Uint8Array(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function gotenbergHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${GOTENBERG_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
