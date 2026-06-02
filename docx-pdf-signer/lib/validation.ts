import { AppError } from "./errors";

const MAX_MB = Number(process.env.MAX_UPLOAD_MB ?? 25);
export const MAX_BYTES = MAX_MB * 1024 * 1024;

const MAGIC = {
  docx: [0x50, 0x4b, 0x03, 0x04], // PK.. (zip/ooxml)
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
} as const;

function startsWith(buf: Uint8Array, sig: readonly number[]): boolean {
  if (buf.length < sig.length) return false;
  return sig.every((b, i) => buf[i] === b);
}

export async function readAndValidate(
  file: File | null,
  kind: keyof typeof MAGIC,
  label: string,
): Promise<{ bytes: Uint8Array; name: string }> {
  if (!file) throw new AppError("MISSING_FILE", `Envie o arquivo ${label}.`, 400);
  if (file.size === 0) throw new AppError("EMPTY_FILE", `O arquivo ${label} está vazio.`, 400);
  if (file.size > MAX_BYTES) {
    throw new AppError("TOO_LARGE", `O arquivo ${label} excede ${MAX_MB} MB.`, 413);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!startsWith(bytes, MAGIC[kind])) {
    throw new AppError("INVALID_FILE", `O arquivo enviado não é um ${label} válido.`, 415);
  }
  return { bytes, name: sanitizeName(file.name || `${label}.${kind}`) };
}

export function sanitizeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}
