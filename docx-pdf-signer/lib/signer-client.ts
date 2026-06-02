import { AppError } from "./errors";
import { withRetry } from "./retry";

const SIGNER_URL = process.env.SIGNER_URL ?? "http://signer:8000";
const TIMEOUT_MS = Number(process.env.SIGNER_TIMEOUT_MS ?? 60_000);

export interface SignParams {
  pdf: Uint8Array;
  pfx: Uint8Array;
  password: string;
  tsaUrl?: string;
  level?: "B-B" | "B-T" | "B-LT";
  reason?: string;
  location?: string;
  contact?: string;
  visible?: boolean;
  page?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/**
 * Encaminha a assinatura ao serviço pyHanko.
 * Atenção: NÃO logar password nem bytes do pfx (ver CLAUDE.md §6).
 * Não re-tenta erro 4xx (senha/cert inválidos) — só transitórios.
 */
export async function signPdf(p: SignParams): Promise<Uint8Array> {
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const form = new FormData();
      form.append("pdf", new Blob([p.pdf], { type: "application/pdf" }), "documento.pdf");
      form.append("pfx", new Blob([p.pfx]), "cert.pfx");
      form.append("password", p.password);
      form.append("level", p.level ?? (p.tsaUrl ? "B-T" : "B-B"));
      if (p.tsaUrl) form.append("tsa_url", p.tsaUrl);
      if (p.reason) form.append("reason", p.reason);
      if (p.location) form.append("location", p.location);
      if (p.contact) form.append("contact", p.contact);
      if (p.visible) {
        form.append("visible", "true");
        form.append("page", String(p.page ?? 1));
        form.append("x", String(p.x ?? 40));
        form.append("y", String(p.y ?? 40));
        form.append("width", String(p.width ?? 220));
        form.append("height", String(p.height ?? 70));
      }

      const res = await fetch(`${SIGNER_URL}/sign`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        const msg = body?.message ?? "Falha ao assinar o documento.";
        throw new AppError("SIGN_ERROR", msg, res.status);
      }
      return new Uint8Array(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function signerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${SIGNER_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
