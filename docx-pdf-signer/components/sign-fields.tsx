"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dropzone } from "@/components/dropzone";
import type { PdfRect } from "@/lib/coords";

// pdf.js é client-only (usa DOMMatrix/Canvas); carregado sem SSR para não quebrar o prerender.
const StampPositioner = dynamic(
  () => import("@/components/stamp-positioner").then((m) => m.StampPositioner),
  { ssr: false },
);

export interface SignConfig {
  pfx: File | null;
  password: string;
  tsaUrl: string;
  level: "B-B" | "B-T" | "B-LT" | "B-LTA";
  reason: string;
  location: string;
  visible: boolean;
  rect: PdfRect | null;
}

export const emptySignConfig: SignConfig = {
  pfx: null,
  password: "",
  tsaUrl: "",
  level: "B-B",
  reason: "",
  location: "",
  visible: false,
  rect: null,
};

export function SignFields({
  cfg,
  setCfg,
  previewPdf,
}: {
  cfg: SignConfig;
  setCfg: React.Dispatch<React.SetStateAction<SignConfig>>;
  previewPdf: Blob | null;
}) {
  // Identidade estável: o StampPositioner chama onChange dentro de um useEffect que
  // tem onChange nas deps; um arrow inline criaria novo identity a cada render → loop.
  const onStampChange = React.useCallback(
    (rect: PdfRect) => setCfg((c) => ({ ...c, rect })),
    [setCfg],
  );
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Certificado .pfx / .p12</Label>
        <Dropzone accept=".pfx,.p12" label="Certificado A1" file={cfg.pfx} onFile={(f) => setCfg((c) => ({ ...c, pfx: f }))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pw">Senha do certificado</Label>
          <Input id="pw" type="password" value={cfg.password} onChange={(e) => setCfg((c) => ({ ...c, password: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="level">Nível PAdES</Label>
          <select
            id="level"
            value={cfg.level}
            onChange={(e) => setCfg((c) => ({ ...c, level: e.target.value as SignConfig["level"] }))}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="B-B">B-B (sem carimbo de tempo)</option>
            <option value="B-T">B-T (com carimbo de tempo)</option>
            <option value="B-LT">B-LT (long-term)</option>
            <option value="B-LTA">B-LTA (long-term + archive)</option>
          </select>
        </div>
      </div>
      {cfg.level !== "B-B" && (
        <div className="space-y-1.5">
          <Label htmlFor="tsa">URL da TSA (carimbo de tempo) — obrigatória</Label>
          <Input id="tsa" type="url" placeholder="https://..." value={cfg.tsaUrl} onChange={(e) => setCfg((c) => ({ ...c, tsaUrl: e.target.value }))} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="reason">Motivo (opcional)</Label>
          <Input id="reason" value={cfg.reason} onChange={(e) => setCfg((c) => ({ ...c, reason: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loc">Local (opcional)</Label>
          <Input id="loc" value={cfg.location} onChange={(e) => setCfg((c) => ({ ...c, location: e.target.value }))} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cfg.visible} onChange={(e) => setCfg((c) => ({ ...c, visible: e.target.checked }))} />
        Carimbo visível no documento
      </label>
      {cfg.visible && previewPdf && (
        <StampPositioner pdf={previewPdf} onChange={onStampChange} />
      )}
      {cfg.visible && !previewPdf && (
        <p className="text-sm text-muted-foreground">O preview aparece após selecionar/gerar o PDF.</p>
      )}
    </div>
  );
}

/** Monta o FormData de assinatura a partir do PDF e da config. */
export function buildSignForm(pdf: Blob, cfg: SignConfig): FormData {
  const f = new FormData();
  f.append("pdf", pdf, "documento.pdf");
  f.append("pfx", cfg.pfx!);
  f.append("password", cfg.password);
  f.append("level", cfg.level);
  if (cfg.tsaUrl) f.append("tsa_url", cfg.tsaUrl);
  if (cfg.reason) f.append("reason", cfg.reason);
  if (cfg.location) f.append("location", cfg.location);
  if (cfg.visible && cfg.rect) {
    f.append("visible", "true");
    f.append("page", String(cfg.rect.page));
    f.append("x", String(cfg.rect.x));
    f.append("y", String(cfg.rect.y));
    f.append("width", String(cfg.rect.width));
    f.append("height", String(cfg.rect.height));
  }
  return f;
}

/** Valida a config; retorna mensagem PT-BR de erro ou null. */
export function validateSignConfig(cfg: SignConfig): string | null {
  if (!cfg.pfx) return "Selecione o certificado .pfx.";
  if (!cfg.password) return "Informe a senha do certificado.";
  if (cfg.level !== "B-B" && !cfg.tsaUrl) return "Informe a URL da TSA para o nível escolhido.";
  if (cfg.visible && !cfg.rect) return "Posicione o carimbo visível no documento.";
  return null;
}
