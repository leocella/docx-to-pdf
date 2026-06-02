"use client";
import * as React from "react";
import * as pdfjsLib from "pdfjs-dist";
import { pxRectToPdf, presetRect, type PdfRect, type Corner } from "@/lib/coords";
import { Button } from "@/components/ui/button";

// Worker servido localmente (sem CDN externo).
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface Props {
  pdf: Blob; // PDF a posicionar o carimbo
  onChange: (rect: PdfRect) => void;
}

const RENDER_SCALE = 1.3;

export function StampPositioner({ pdf, onChange }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = React.useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [page, setPage] = React.useState(1);
  const [numPages, setNumPages] = React.useState(1);
  const [failed, setFailed] = React.useState(false);
  const [pageSizePts, setPageSizePts] = React.useState({ w: 595, h: 842 }); // A4 default
  // retângulo em px CSS relativo ao canvas
  const [box, setBox] = React.useState({ left: 40, top: 40, width: 200, height: 70 });
  const drag = React.useRef<{ mode: "move" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);

  // carregar o documento uma vez
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const buf = await pdf.arrayBuffer();
        const loaded = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        setDoc(loaded);
        setNumPages(loaded.numPages);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  // renderizar a página atual
  React.useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await doc.getPage(page);
        if (cancelled) return;
        const viewport = p.getViewport({ scale: RENDER_SCALE });
        setPageSizePts({ w: viewport.width / RENDER_SCALE, h: viewport.height / RENDER_SCALE });
        const canvas = canvasRef.current!;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await p.render({ canvas, viewport }).promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page]);

  // emitir o retângulo convertido sempre que box/page mudam
  React.useEffect(() => {
    if (failed) return;
    onChange(pxRectToPdf(box, RENDER_SCALE, pageSizePts.h, page));
  }, [box, page, pageSizePts.h, failed, onChange]);

  function onPointerDown(e: React.PointerEvent, mode: "move" | "resize") {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, ox: box.left, oy: box.top, ow: box.width, oh: box.height };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const canvas = canvasRef.current;
    const maxW = canvas?.width ?? 9999;
    const maxH = canvas?.height ?? 9999;
    if (d.mode === "move") {
      setBox((b) => ({
        ...b,
        left: clamp(d.ox + dx, 0, maxW - b.width),
        top: clamp(d.oy + dy, 0, maxH - b.height),
      }));
    } else {
      setBox((b) => ({
        ...b,
        width: clamp(d.ow + dx, 40, maxW - b.left),
        height: clamp(d.oh + dy, 24, maxH - b.top),
      }));
    }
  }
  function onPointerUp() {
    drag.current = null;
  }

  if (failed) {
    return <PresetFallback pageSize={pageSizePts} page={page} numPages={numPages} onPage={setPage} onChange={onChange} />;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Página</span>
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          −
        </Button>
        <span className="tabular-nums">{page} / {numPages}</span>
        <Button type="button" variant="outline" size="sm" disabled={page >= numPages} onClick={() => setPage((p) => p + 1)}>
          +
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">Arraste o selo; use o canto p/ redimensionar</span>
      </div>
      <div className="relative inline-block max-w-full overflow-auto rounded-md border" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <canvas ref={canvasRef} className="block" />
        <div
          onPointerDown={(e) => onPointerDown(e, "move")}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          className="absolute cursor-move rounded-sm border-2 border-primary bg-primary/15"
        >
          <div className="flex h-full items-center justify-center text-[10px] font-medium text-primary">ASSINATURA</div>
          <div
            onPointerDown={(e) => onPointerDown(e, "resize")}
            className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border-2 border-primary bg-background"
          />
        </div>
      </div>
    </div>
  );
}

function PresetFallback({
  pageSize,
  page,
  numPages,
  onPage,
  onChange,
}: {
  pageSize: { w: number; h: number };
  page: number;
  numPages: number;
  onPage: (p: number) => void;
  onChange: (r: PdfRect) => void;
}) {
  const [corner, setCorner] = React.useState<Corner>("bottom-left");
  React.useEffect(() => {
    onChange(presetRect(corner, pageSize.w, pageSize.h, page));
  }, [corner, pageSize.w, pageSize.h, page, onChange]);

  const corners: { value: Corner; label: string }[] = [
    { value: "bottom-left", label: "Inferior esquerdo" },
    { value: "bottom-right", label: "Inferior direito" },
    { value: "top-left", label: "Superior esquerdo" },
    { value: "top-right", label: "Superior direito" },
  ];
  return (
    <div className="space-y-2 rounded-md border border-dashed p-3 text-sm">
      <p className="text-muted-foreground">Preview indisponível — posicione por canto:</p>
      <div className="flex flex-wrap gap-2">
        {corners.map((c) => (
          <Button key={c.value} type="button" variant={corner === c.value ? "default" : "outline"} size="sm" onClick={() => setCorner(c.value)}>
            {c.label}
          </Button>
        ))}
      </div>
      <label className="flex items-center gap-2">
        Página
        <input type="number" min={1} max={numPages} value={page} onChange={(e) => onPage(Number(e.target.value))} className="h-9 w-20 rounded-md border border-input px-2" />
      </label>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
