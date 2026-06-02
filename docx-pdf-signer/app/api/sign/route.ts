import { NextRequest } from "next/server";
import { signPdf, type SignParams } from "@/lib/signer-client";
import { readAndValidate } from "@/lib/validation";
import { AppError, toAppError } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 120;

const LEVELS = ["B-B", "B-T", "B-LT", "B-LTA"] as const;
type Level = (typeof LEVELS)[number];

function num(form: FormData, key: string): number | undefined {
  const v = form.get(key);
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const pdf = await readAndValidate(form.get("pdf") as File | null, "pdf", "PDF");
    const pfxFile = form.get("pfx") as File | null;
    const password = String(form.get("password") ?? "");

    if (!pfxFile || pfxFile.size === 0) throw new AppError("MISSING_CERT", "Envie o certificado .pfx.", 400);
    if (!password) throw new AppError("MISSING_PASSWORD", "Informe a senha do certificado.", 400);

    const pfxBytes = new Uint8Array(await pfxFile.arrayBuffer());

    const rawLevel = String(form.get("level") ?? "B-T").toUpperCase() as Level;
    if (!LEVELS.includes(rawLevel)) throw new AppError("INVALID_LEVEL", "Nível de assinatura inválido.", 400);

    const tsaUrl = (form.get("tsa_url") as string | null) || process.env.DEFAULT_TSA_URL || undefined;
    if (rawLevel !== "B-B" && !tsaUrl) {
      throw new AppError("TSA_REQUIRED", `O nível ${rawLevel} exige uma URL de carimbo de tempo (TSA).`, 400);
    }

    const visible = form.get("visible") === "true";
    const params: SignParams = {
      pdf: pdf.bytes,
      pfx: pfxBytes,
      password,
      tsaUrl,
      level: rawLevel,
      reason: (form.get("reason") as string | null) ?? undefined,
      location: (form.get("location") as string | null) ?? undefined,
      contact: (form.get("contact") as string | null) ?? undefined,
      visible,
    };

    if (visible) {
      const page = num(form, "page");
      const x = num(form, "x");
      const y = num(form, "y");
      const width = num(form, "width");
      const height = num(form, "height");
      for (const [k, v] of Object.entries({ page, x, y, width, height })) {
        if (v === undefined || Number.isNaN(v) || (v as number) < 0) {
          throw new AppError("INVALID_STAMP", `Posição do carimbo inválida (${k}).`, 400);
        }
      }
      if ((page as number) < 1) throw new AppError("INVALID_STAMP", "A página do carimbo deve ser ≥ 1.", 400);
      Object.assign(params, { page, x, y, width, height });
    }

    const signed = await signPdf(params);
    const outName = pdf.name.replace(/\.pdf$/i, "") + "-assinado.pdf";
    return new Response(new Uint8Array(signed), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${outName}"`,
      },
    });
  } catch (err) {
    return toAppError(err).toResponse();
  }
}
