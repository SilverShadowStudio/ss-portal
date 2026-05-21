// Shared visual + layout tokens for Silvershadow PDF documents — the v3
// client agreement (agreementPdfV3.ts) and team engagement contracts
// (teamContractPdf.ts). Colours are runtime-configurable via
// DocumentDesignConfig (app_settings → document_design_config); these are the
// structural constants that were previously inlined in agreementPdfV3.ts so
// both document types stay visually identical.

/** Page margins in mm (A4 portrait). */
export const PDF_MARGIN = {
  x: 28,
  top: 32,
  bottom: 30,
} as const;

/** Font sizes (pt). */
export const PDF_SIZE = {
  body: 10.5,
  metaLabel: 7.5,
  clauseHeading: 11,
  certHeading: 16,
  certRow: 9,
  watermark: 56,
} as const;

/** Hairline rule widths (mm). */
export const PDF_RULE = {
  muted: 0.2,
  gold: 0.25,
  signature: 0.15,
} as const;

/** Centred cover logo (the SVG wordmark is 600×91). */
export const PDF_LOGO = { widthMm: 50, aspect: 91 / 600 } as const;

/** Embedded signature image box. */
export const PDF_SIGNATURE = { widthMm: 70, heightMm: 24 } as const;

/** #RRGGBB → [r, g, b]. Returns black on a malformed value. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Map a configured font name to a jsPDF built-in family. */
export function jsPdfFontFor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("times")) return "times";
  if (lower.includes("courier")) return "courier";
  return "helvetica";
}

/** Tracked uppercase ("A B C") for meta labels. */
export function trackedUpper(text: string): string {
  return text.toUpperCase().split("").join(" ");
}
