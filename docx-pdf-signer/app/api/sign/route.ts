import { NextRequest } from "next/server";
import { signPdf } from "@/lib/signer-client";
import { readAndValidate } from "@/lib/validation";
import { AppError, toAppError } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const pdf = await readAndValidate(form.get("pdf") as File | null, "pdf", "PDF");
    const pfxFile = form.get("pfx") as File | null;
    const password = String(form.get("password") ?? "");

    if (!pfxFile || pfxFile.size === 0) {
      throw new AppError("MISSING_CERT", "Envie o certificado .pfx.", 400);
    }
    if (!password) throw new AppError("MISSING_PASSWORD", "Informe a senha do certificado.", 400);

    const pfxBytes = new Uint8Array(await pfxFile.arrayBuffer());

    const level = (form.get("level") as "B-B" | "B-T" | "B-LT" | null) ?? undefined;
    const tsaUrl = (form.get("tsa_url") as string | null) ?? process.env.DEFAULT_TSA_URL ?? undefined;

    const signed = await signPdf({
      pdf: pdf.bytes,
      pfx: pfxBytes,
      password,
      tsaUrl: tsaUrl || undefined,
      level,
      reason: (form.get("reason") as string | null) ?? undefined,
      location: (form.get("location") as string | null) ?? undefined,
      visible: form.get("visible") === "true",
    });

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
