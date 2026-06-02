"use client";

import { useState } from "react";

type Mode = "convert" | "sign" | "both";

async function postFile(url: string, form: FormData): Promise<{ blob?: Blob; error?: string }> {
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    return { error: body?.message ?? "Falha na operação." };
  }
  return { blob: await res.blob() };
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("both");
  const [docx, setDocx] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [pfx, setPfx] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [tsaUrl, setTsaUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run() {
    setError(null);
    setDone(null);
    setLoading(true);
    try {
      let pdfFile: Blob | null = pdf;

      if (mode === "convert" || mode === "both") {
        if (!docx) throw new Error("Selecione o arquivo .docx.");
        const f = new FormData();
        f.append("file", docx);
        const r = await postFile("/api/convert", f);
        if (r.error) throw new Error(r.error);
        pdfFile = r.blob!;
        if (mode === "convert") {
          download(pdfFile, docx.name.replace(/\.docx$/i, "") + ".pdf");
          setDone("PDF gerado.");
          return;
        }
      }

      // assinar
      if (!pdfFile) throw new Error("Nenhum PDF para assinar.");
      if (!pfx) throw new Error("Selecione o certificado .pfx.");
      if (!password) throw new Error("Informe a senha do certificado.");

      const f = new FormData();
      f.append("pdf", pdfFile, "documento.pdf");
      f.append("pfx", pfx);
      f.append("password", password);
      if (tsaUrl) {
        f.append("tsa_url", tsaUrl);
        f.append("level", "B-T");
      }
      const r = await postFile("/api/sign", f);
      if (r.error) throw new Error(r.error);
      download(r.blob!, "documento-assinado.pdf");
      setDone("PDF assinado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">DocSign</h1>
      <p className="mb-6 text-sm text-neutral-600">Converte DOCX→PDF e assina com certificado A1.</p>

      <div className="mb-4 flex gap-2">
        {(["convert", "sign", "both"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded px-3 py-1 text-sm ${mode === m ? "bg-neutral-900 text-white" : "bg-neutral-200"}`}
          >
            {m === "convert" ? "Converter" : m === "sign" ? "Assinar" : "Converter + Assinar"}
          </button>
        ))}
      </div>

      <div className="space-y-3 rounded-lg border bg-white p-4">
        {(mode === "convert" || mode === "both") && (
          <label className="block text-sm">
            Arquivo .docx
            <input type="file" accept=".docx" onChange={(e) => setDocx(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
          </label>
        )}
        {mode === "sign" && (
          <label className="block text-sm">
            PDF a assinar
            <input type="file" accept=".pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
          </label>
        )}
        {(mode === "sign" || mode === "both") && (
          <>
            <label className="block text-sm">
              Certificado .pfx / .p12
              <input type="file" accept=".pfx,.p12" onChange={(e) => setPfx(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
            </label>
            <label className="block text-sm">
              Senha do certificado
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block w-full rounded border px-2 py-1" />
            </label>
            <label className="block text-sm">
              TSA (carimbo de tempo, opcional)
              <input type="url" value={tsaUrl} onChange={(e) => setTsaUrl(e.target.value)} placeholder="https://..." className="mt-1 block w-full rounded border px-2 py-1" />
            </label>
          </>
        )}

        <button onClick={run} disabled={loading} className="w-full rounded bg-neutral-900 py-2 text-white disabled:opacity-50">
          {loading ? "Processando..." : "Executar"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {done && <p className="text-sm text-green-700">{done}</p>}
      </div>
    </main>
  );
}
