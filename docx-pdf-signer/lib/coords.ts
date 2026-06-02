// Conversão entre o retângulo desenhado no preview (px CSS, origem topo-esquerdo)
// e as coordenadas que o PDF/pyHanko espera (points, origem inferior-esquerdo).
export interface PdfRect {
  page: number; // 1-based
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * @param scale  px renderizados por point do PDF (escala do viewport do pdf.js)
 * @param pageHeightPts  altura da página em points (viewport.height / scale)
 */
export function pxRectToPdf(rect: PxRect, scale: number, pageHeightPts: number, page: number): PdfRect {
  const width = rect.width / scale;
  const height = rect.height / scale;
  const x = rect.left / scale;
  const y = pageHeightPts - rect.top / scale - height;
  return { page, x: round(x), y: round(y), width: round(width), height: round(height) };
}

export type Corner = "bottom-left" | "bottom-right" | "top-left" | "top-right";

/** Fallback quando o preview não carrega: posiciona por canto, em points. */
export function presetRect(
  corner: Corner,
  pageWidthPts: number,
  pageHeightPts: number,
  page: number,
  w = 200,
  h = 60,
  margin = 36,
): PdfRect {
  const left = corner.endsWith("left");
  const bottom = corner.startsWith("bottom");
  const x = left ? margin : pageWidthPts - w - margin;
  const y = bottom ? margin : pageHeightPts - h - margin;
  return { page, x: round(x), y: round(y), width: w, height: h };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
