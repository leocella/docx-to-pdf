"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/dropzone";
import { postForm, download } from "@/lib/api-client";
import { SignFields, emptySignConfig, buildSignForm, validateSignConfig, type SignConfig } from "@/components/sign-fields";

export function SignTab() {
  const [pdf, setPdf] = React.useState<File | null>(null);
  const [cfg, setCfg] = React.useState<SignConfig>(emptySignConfig);
  const [loading, setLoading] = React.useState(false);

  async function run() {
    if (!pdf) return toast.error("Selecione o PDF a assinar.");
    const err = validateSignConfig(cfg);
    if (err) return toast.error(err);
    setLoading(true);
    const r = await postForm("/api/sign", buildSignForm(pdf, cfg));
    setLoading(false);
    if (r.error) return toast.error(r.error);
    download(r.blob!, pdf.name.replace(/\.pdf$/i, "") + "-assinado.pdf");
    toast.success("PDF assinado.");
  }

  return (
    <div className="space-y-4">
      <Dropzone accept=".pdf" label="PDF a assinar" file={pdf} onFile={setPdf} />
      <SignFields cfg={cfg} setCfg={setCfg} previewPdf={pdf} />
      <Button className="w-full" disabled={loading} onClick={run}>
        {loading ? "Assinando..." : "Assinar PDF"}
      </Button>
    </div>
  );
}
