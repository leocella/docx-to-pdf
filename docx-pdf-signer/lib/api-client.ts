// Helpers de client. Lê a mensagem PT-BR de erro da API ({code, message}).
export interface ApiResult {
  blob?: Blob;
  error?: string;
}

export async function postForm(url: string, form: FormData): Promise<ApiResult> {
  try {
    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return { error: body?.message ?? "Falha na operação. Tente novamente." };
    }
    return { blob: await res.blob() };
  } catch {
    return { error: "Não foi possível contatar o servidor." };
  }
}

export function download(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
