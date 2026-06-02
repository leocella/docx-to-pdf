"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/dropzone";
import { postForm, download } from "@/lib/api-client";
import { SignFields, emptySignConfig, buildSignForm, validateSignConfig, type SignConfig } from "@/components/sign-fields";

export function CombinedTab() {
  const [docx, setDocx] = React.useState<File | null>(null);
  const [cfg, setCfg] = React.useState<SignConfig>(emptySignConfig);
  const [converted, setConverted] = React.useState<Blob | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Trocar o .docx invalida qualquer conversão anterior.
  React.useEffect(() => {
    setConverted(null);
  }, [docx]);

  async function convert(): Promise<Blob | null> {
    const f = new FormData();
    f.append("file", docx!);
    const r = await postForm("/api/convert", f);
    if (r.error) {
      toast.error(r.error);
      return null;
    }
    return r.blob!;
  }

  // Passo intermediário: para carimbo visível, precisamos do PDF antes de posicionar.
  async function prepare() {
    if (!docx) return toast.error("Selecione o arquivo .docx.");
    setLoading(true);
    const pdf = await convert();
    setLoading(false);
    if (pdf) {
      setConverted(pdf);
      toast.success("Convertido. Posicione o carimbo e finalize.");
    }
  }

  async function run() {
    if (!docx) return toast.error("Selecione o arquivo .docx.");
    const err = validateSignConfig(cfg);
    if (err) return toast.error(err);
    setLoading(true);
    const pdf = converted ?? (await convert());
    if (!pdf) return setLoading(false);
    const r = await postForm("/api/sign", buildSignForm(pdf, cfg));
    setLoading(false);
    if (r.error) return toast.error(r.error);
    download(r.blob!, docx.name.replace(/\.docx$/i, "") + "-assinado.pdf");
    toast.success("PDF convertido e assinado.");
  }

  const needsPrepare = cfg.visible && !converted;

  return (
    <div className="space-y-4">
      <Dropzone accept=".docx" label="Documento .docx" file={docx} onFile={setDocx} />
      <SignFields cfg={cfg} setCfg={setCfg} previewPdf={converted} />
      {needsPrepare ? (
        <Button className="w-full" variant="secondary" disabled={loading} onClick={prepare}>
          {loading ? "Convertendo..." : "Converter e mostrar preview p/ posicionar carimbo"}
        </Button>
      ) : (
        <Button className="w-full" disabled={loading} onClick={run}>
          {loading ? "Processando..." : "Converter + Assinar"}
        </Button>
      )}
    </div>
  );
}
