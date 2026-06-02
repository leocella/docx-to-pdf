import { NextRequest } from "next/server";
import { convertDocxToPdf } from "@/lib/gotenberg";
import { readAndValidate } from "@/lib/validation";
import { toAppError } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const { bytes, name } = await readAndValidate(form.get("file") as File | null, "docx", "documento .docx");

    const pdf = await convertDocxToPdf(bytes, name);
    const outName = name.replace(/\.docx$/i, "") + ".pdf";

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${outName}"`,
      },
    });
  } catch (err) {
    return toAppError(err).toResponse();
  }
}
