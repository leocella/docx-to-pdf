"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/dropzone";
import { postForm, download } from "@/lib/api-client";

export function ConvertTab() {
  const [docx, setDocx] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function run() {
    if (!docx) return toast.error("Selecione um arquivo .docx.");
    setLoading(true);
    const f = new FormData();
    f.append("file", docx);
    const r = await postForm("/api/convert", f);
    setLoading(false);
    if (r.error) return toast.error(r.error);
    download(r.blob!, docx.name.replace(/\.docx$/i, "") + ".pdf");
    toast.success("PDF gerado.");
  }

  return (
    <div className="space-y-4">
      <Dropzone accept=".docx" label="Documento .docx" file={docx} onFile={setDocx} />
      <Button className="w-full" disabled={loading} onClick={run}>
        {loading ? "Convertendo..." : "Converter para PDF"}
      </Button>
    </div>
  );
}
