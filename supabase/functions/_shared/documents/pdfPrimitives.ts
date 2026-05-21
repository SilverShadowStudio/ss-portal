// Shared rendering primitives for Silvershadow PDF documents. Extracted from
// agreementPdfV3.ts so the v3 client agreement and team engagement contracts
// render identical headings, body text, meta labels, hairlines, and cover
// logo. Functional style: each primitive takes the current vertical cursor
// `y` (mm from the top) and returns the advanced cursor, so each generator
// threads its own `y` without shared mutable state.

// @ts-ignore - npm specifier resolved by Deno
import { jsPDF } from "npm:jspdf@2.5.1";
import { paintPageBackground } from "../brand.ts";
import { PDF_LOGO, PDF_MARGIN, PDF_RULE, PDF_SIZE, trackedUpper } from "./designTokens.ts";

/** Immutable per-render context: the jsPDF instance, resolved page geometry,
 *  resolved colours/fonts, and the background colour for new pages. */
export interface PdfContext {
  pdf: jsPDF;
  pageWidth: number;
  pageHeight: number;
  contentWidth: number;
  ink: [number, number, number];
  muted: [number, number, number];
  gold: [number, number, number];
  bodyFont: string;
  metaFont: string;
  backgroundColor: string;
}

export interface WriteBodyOptions {
  indent?: number;
  size?: number;
  lineGap?: number;
  afterGap?: number;
  italic?: boolean;
  rgb?: [number, number, number];
}

/** Page-break guard: if `needed` mm won't fit below the cursor, start a fresh
 *  painted page and return the reset cursor; otherwise return `y` unchanged. */
export function ensureSpace(ctx: PdfContext, y: number, needed: number): number {
  if (y + needed > ctx.pageHeight - PDF_MARGIN.bottom) {
    ctx.pdf.addPage();
    paintPageBackground(ctx.pdf, ctx.backgroundColor);
    return PDF_MARGIN.top;
  }
  return y;
}

/** Body paragraph(s), wrapped to the content width. Returns the new cursor. */
export function writeBody(ctx: PdfContext, y: number, text: string, opts?: WriteBodyOptions): number {
  const size = opts?.size ?? PDF_SIZE.body;
  const indent = opts?.indent ?? 0;
  const lineGap = opts?.lineGap ?? size * 0.62;
  const afterGap = opts?.afterGap ?? 3.6;
  const [r, g, b] = opts?.rgb ?? ctx.ink;
  ctx.pdf.setFontSize(size);
  ctx.pdf.setFont(ctx.bodyFont, opts?.italic ? "italic" : "normal");
  ctx.pdf.setTextColor(r, g, b);
  const lines = ctx.pdf.splitTextToSize(text, ctx.contentWidth - indent);
  for (const line of lines) {
    y = ensureSpace(ctx, y, lineGap);
    ctx.pdf.text(line, PDF_MARGIN.x + indent, y);
    y += lineGap;
  }
  return y + afterGap;
}

/** Tracked-uppercase meta label in the muted colour. Returns the new cursor. */
export function writeMetaLabel(ctx: PdfContext, y: number, text: string, opts?: { afterGap?: number }): number {
  ctx.pdf.setFontSize(PDF_SIZE.metaLabel);
  ctx.pdf.setFont(ctx.metaFont, "normal");
  ctx.pdf.setTextColor(ctx.muted[0], ctx.muted[1], ctx.muted[2]);
  y = ensureSpace(ctx, y, 5);
  ctx.pdf.text(trackedUpper(text), PDF_MARGIN.x, y);
  return y + (opts?.afterGap ?? 6);
}

/** Numbered clause heading: gold number + ink title. Returns the new cursor. */
export function writeClauseHeading(ctx: PdfContext, y: number, number: string, title: string): number {
  y = ensureSpace(ctx, y, 14);
  y += 8;
  ctx.pdf.setFontSize(PDF_SIZE.clauseHeading);
  ctx.pdf.setFont(ctx.bodyFont, "bold");
  ctx.pdf.setTextColor(ctx.gold[0], ctx.gold[1], ctx.gold[2]);
  ctx.pdf.text(`${number}.`, PDF_MARGIN.x, y);
  ctx.pdf.setTextColor(ctx.ink[0], ctx.ink[1], ctx.ink[2]);
  ctx.pdf.text(title, PDF_MARGIN.x + 7, y);
  return y + 7;
}

/** Tracked-uppercase label at (x, y) in a given colour. Does not advance y —
 *  for fixed-position labels such as certificate rows. Font size is left as
 *  set by the caller. */
export function writeTracked(ctx: PdfContext, y: number, text: string, x: number, rgb: [number, number, number]): void {
  ctx.pdf.setFont(ctx.metaFont, "normal");
  ctx.pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
  ctx.pdf.text(trackedUpper(text), x, y);
}

/** Full-width horizontal rule at the cursor in `rgb`/`width`. Does not advance y. */
export function drawHairline(ctx: PdfContext, y: number, rgb: [number, number, number], width: number): void {
  ctx.pdf.setDrawColor(rgb[0], rgb[1], rgb[2]);
  ctx.pdf.setLineWidth(width);
  ctx.pdf.line(PDF_MARGIN.x, y, ctx.pageWidth - PDF_MARGIN.x, y);
}

/** Gold accent rule. */
export function drawGoldHairline(ctx: PdfContext, y: number): void {
  drawHairline(ctx, y, ctx.gold, PDF_RULE.gold);
}

/** Muted divider rule. */
export function drawMutedHairline(ctx: PdfContext, y: number): void {
  drawHairline(ctx, y, ctx.muted, PDF_RULE.muted);
}

/** Centred cover logo. Returns the cursor advanced past the logo. */
export function drawCoverLogo(ctx: PdfContext, y: number, logoDataUrl: string): number {
  const w = PDF_LOGO.widthMm;
  const h = w * PDF_LOGO.aspect;
  ctx.pdf.addImage(logoDataUrl, "PNG", (ctx.pageWidth - w) / 2, y, w, h);
  return y + h + 18;
}
