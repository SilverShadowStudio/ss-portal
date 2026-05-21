// Shared v3.0 agreement PDF generator. Used by `accept-agreement` (to
// produce the immutable signed PDF) and by `preview-agreement-pdf` (to
// produce a watermarked preview before signing). Single source of truth so
// the preview matches the signed copy field-for-field aside from the
// signature embed and the certificate page metadata.
//
// Coexists with the older v2.x generator in `accept-agreement/index.ts` —
// that generator is still used for legacy onboarding/invite flows and is
// not modified.
//
// Visual tokens + rendering primitives live in ./documents/* and are shared
// with the team engagement contract generator. This file only assembles the
// document-specific blocks.

// @ts-ignore - npm specifier resolved by Deno
import { jsPDF } from "npm:jspdf@2.5.1";
import { SILVERSHADOW_LOGO_DATA_URL } from "./brandLogo.ts";
import { paintPageBackground } from "./brand.ts";
import type { AgreementDocument, PartyBlock } from "./agreements/types.ts";
import type { DocumentDesignConfig } from "./pdfUtils.ts";
import { hexToRgb, jsPdfFontFor, PDF_MARGIN, PDF_SIZE, PDF_RULE } from "./documents/designTokens.ts";
import {
  type PdfContext,
  drawCoverLogo,
  drawGoldHairline,
  drawMutedHairline,
  ensureSpace,
  writeBody,
  writeClauseHeading,
  writeMetaLabel,
  writeTracked,
} from "./documents/pdfPrimitives.ts";

export interface AgreementPdfV3Args {
  doc: AgreementDocument;
  signaturePngDataUrl: string;       // empty for preview
  signatoryName: string;             // empty for preview
  signatoryPosition: string;         // empty for preview
  acceptedAt: string;                // ISO; for preview, use server now
  agreementUid: string;              // for preview, generate a UUID just for the file
  accountId: string;
  ipAddress: string;
  userAgent: string;
  scrolledToEndAt: string;           // preview can pass empty/'-'
  timeOnPageSeconds: number;         // preview can pass 0
  pdfDownloadedBeforeSigning: boolean;
  design: DocumentDesignConfig;
}

export interface AgreementPdfV3Options {
  /** If true, overlay "PREVIEW — NOT YET SIGNED" diagonally on every page. */
  watermark?: boolean;
}

/**
 * Render the v3 AgreementDocument as a PDF. With `watermark: true`, every
 * page gets a centred diagonal "PREVIEW — NOT YET SIGNED" overlay at low
 * opacity. With `watermark: false` (default), the PDF is the immutable
 * signed copy: the embedded signature + certificate page are included.
 */
export function generateAgreementPdfV3(
  args: AgreementPdfV3Args,
  opts: AgreementPdfV3Options = {},
): Uint8Array {
  const {
    doc, signaturePngDataUrl, signatoryName, signatoryPosition,
    acceptedAt, agreementUid, accountId, ipAddress, userAgent,
    scrolledToEndAt, timeOnPageSeconds, pdfDownloadedBeforeSigning, design,
  } = args;

  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PDF_MARGIN.x * 2;
  let y = PDF_MARGIN.top;

  const ink = hexToRgb(design.warm_black);
  const muted = hexToRgb(design.warm_grey);
  const gold = hexToRgb(design.gold);
  const bodyFont = jsPdfFontFor(design.body_font);
  const metaFont = jsPdfFontFor(design.meta_font);

  const ctx: PdfContext = {
    pdf, pageWidth, pageHeight, contentWidth,
    ink, muted, gold, bodyFont, metaFont,
    backgroundColor: design.background_color,
  };

  paintPageBackground(pdf, design.background_color);

  const writePartyLine = (cursor: number, block: PartyBlock): number => {
    const segments = [
      block.legalName,
      block.country ? `Registered in ${block.country}` : null,
      block.registrationNumber || null,
      block.registeredAddress || null,
    ].filter(Boolean) as string[];
    return writeBody(ctx, cursor, segments.join(" · "), { size: 10.5, afterGap: 6 });
  };

  // ── Cover block ──────────────────────────────────────────────────────────
  y = drawCoverLogo(ctx, y, SILVERSHADOW_LOGO_DATA_URL);

  y = writeMetaLabel(ctx, y, "Studio", { afterGap: 4 });
  y = writePartyLine(y, doc.cover.studio);
  y = writeMetaLabel(ctx, y, "Client", { afterGap: 4 });
  y = writePartyLine(y, doc.cover.client);
  y = writeMetaLabel(ctx, y, "Effective Date", { afterGap: 4 });
  y = writeBody(ctx, y, doc.cover.effectiveDate, { afterGap: 4 });
  y = writeMetaLabel(ctx, y, "Engagement Model", { afterGap: 4 });
  y = writeBody(ctx, y, doc.cover.engagementModel, { afterGap: 4 });
  y = writeMetaLabel(ctx, y, "Agreement Version", { afterGap: 4 });
  y = writeBody(ctx, y, doc.version, { afterGap: 10 });

  y = ensureSpace(ctx, y, 10);
  drawMutedHairline(ctx, y);
  y += 6;
  y = writeBody(ctx, y, doc.cover.footer, { italic: true, size: 9.5, rgb: muted, afterGap: 4 });

  // ── Notice block ─────────────────────────────────────────────────────────
  y = ensureSpace(ctx, y, 20);
  y += 8;
  drawGoldHairline(ctx, y);
  y += 6;
  y = writeMetaLabel(ctx, y, doc.notice.heading, { afterGap: 5 });
  y = writeBody(ctx, y, doc.notice.intro, { afterGap: 4 });
  for (const item of doc.notice.items) {
    y = ensureSpace(ctx, y, 7);
    pdf.setFontSize(PDF_SIZE.body);
    pdf.setFont(bodyFont, "bold");
    pdf.setTextColor(gold[0], gold[1], gold[2]);
    const label = `Clause ${item.clauseRef} —`;
    pdf.text(label, PDF_MARGIN.x, y);
    const labelWidth = pdf.getTextWidth(label) + 2;
    pdf.setFont(bodyFont, "normal");
    pdf.setTextColor(ink[0], ink[1], ink[2]);
    const lines = pdf.splitTextToSize(item.text, contentWidth - labelWidth);
    for (let i = 0; i < lines.length; i++) {
      pdf.text(lines[i], PDF_MARGIN.x + labelWidth, y + i * 6);
    }
    y += Math.max(lines.length, 1) * 6;
  }
  y += 4;
  y = writeBody(ctx, y, doc.notice.closing, { afterGap: 4 });
  y = ensureSpace(ctx, y, 4);
  // Inherits the gold pen set above — re-set explicitly for clarity (identical output).
  drawGoldHairline(ctx, y);
  y += 4;

  // ── Clauses ──────────────────────────────────────────────────────────────
  for (const clause of doc.clauses) {
    y = writeClauseHeading(ctx, y, clause.number, clause.title);
    for (const p of clause.paragraphs) {
      if (p.type === "prose") {
        y = writeBody(ctx, y, p.text, { afterGap: 3 });
      } else if (p.type === "bullet_list") {
        for (const item of p.items) {
          y = writeBody(ctx, y, `·   ${item}`, { indent: 4, lineGap: 5.8, afterGap: 1.8 });
        }
        y += 1.5;
      } else if (p.type === "definition") {
        y = ensureSpace(ctx, y, 6);
        pdf.setFontSize(PDF_SIZE.body);
        pdf.setFont(bodyFont, "bold");
        pdf.setTextColor(ink[0], ink[1], ink[2]);
        pdf.text(p.term, PDF_MARGIN.x, y);
        const termWidth = pdf.getTextWidth(p.term) + 2;
        pdf.setFont(bodyFont, "normal");
        const full = ` — ${p.text}`;
        const lines = pdf.splitTextToSize(full, contentWidth - termWidth);
        for (let i = 0; i < lines.length; i++) {
          pdf.text(lines[i], PDF_MARGIN.x + termWidth, y + i * 5.8);
        }
        y += Math.max(lines.length, 1) * 5.8 + 2;
      } else {
        // note
        y = writeBody(ctx, y, p.text, { italic: true, rgb: muted, afterGap: 3 });
      }
    }
  }

  // ── Execution + signature ────────────────────────────────────────────────
  y = ensureSpace(ctx, y, 20);
  y += 10;
  drawMutedHairline(ctx, y);
  y += 6;
  y = writeMetaLabel(ctx, y, "Execution", { afterGap: 4 });
  y = writeBody(ctx, y, doc.execution.intro, { afterGap: 3 });
  y = writeBody(ctx, y, doc.execution.confirmation, { afterGap: 8 });

  if (signaturePngDataUrl && signaturePngDataUrl.startsWith("data:image/png")) {
    const sigW = 70;
    const sigH = 24;
    y = ensureSpace(ctx, y, sigH + 18);
    pdf.setDrawColor(muted[0], muted[1], muted[2]);
    pdf.setLineWidth(PDF_RULE.signature);
    pdf.line(PDF_MARGIN.x, y + sigH + 1, PDF_MARGIN.x + sigW, y + sigH + 1);
    pdf.addImage(signaturePngDataUrl, "PNG", PDF_MARGIN.x, y, sigW, sigH);
    y += sigH + 5;
    pdf.setFontSize(10);
    pdf.setFont(bodyFont, "normal");
    pdf.setTextColor(ink[0], ink[1], ink[2]);
    pdf.text(signatoryName, PDF_MARGIN.x, y);
    y += 5;
    pdf.setTextColor(muted[0], muted[1], muted[2]);
    pdf.text(signatoryPosition, PDF_MARGIN.x, y);
    y += 8;
  }

  // ── Certificate page ─────────────────────────────────────────────────────
  pdf.addPage();
  paintPageBackground(pdf, design.background_color);
  y = PDF_MARGIN.top;
  y = writeMetaLabel(ctx, y, "Acceptance certificate", { afterGap: 8 });
  pdf.setFontSize(PDF_SIZE.certHeading);
  pdf.setFont(bodyFont, "normal");
  pdf.setTextColor(ink[0], ink[1], ink[2]);
  pdf.text("Forensic record", PDF_MARGIN.x, y);
  y += 10;

  const certRows: [string, string][] = [
    ["Agreement Version", doc.version],
    ["Schedule", doc.schedule],
    ["Agreement UID", agreementUid],
    ["Account ID", accountId],
    ["Signed by", signatoryName ? `${signatoryName} (${signatoryPosition})` : "(unsigned preview)"],
    ["Server timestamp", acceptedAt],
    ["Scrolled to end at", scrolledToEndAt || "—"],
    ["Time on page (seconds)", String(timeOnPageSeconds)],
    ["PDF downloaded before signing", pdfDownloadedBeforeSigning ? "yes" : "no"],
    ["Client IP", ipAddress],
    ["User agent", userAgent],
    ["PDF SHA-256", "(recorded in agreement record after assembly)"],
  ];

  pdf.setFontSize(PDF_SIZE.certRow);
  for (const [label, val] of certRows) {
    y = ensureSpace(ctx, y, 8);
    writeTracked(ctx, y, label, PDF_MARGIN.x, muted);
    pdf.setFont(bodyFont, "normal");
    pdf.setTextColor(ink[0], ink[1], ink[2]);
    const valLines = pdf.splitTextToSize(val, contentWidth - 70);
    for (let i = 0; i < valLines.length; i++) {
      pdf.text(valLines[i], PDF_MARGIN.x + 70, y + i * 5);
    }
    y += Math.max(valLines.length, 1) * 5 + 2.5;
  }

  // ── Watermark overlay (preview only) ─────────────────────────────────────
  if (opts.watermark) {
    const totalPages = pdf.getNumberOfPages();
    // deno-lint-ignore no-explicit-any
    const GState = (pdf as any).GState;
    for (let p = 1; p <= totalPages; p++) {
      pdf.setPage(p);
      try {
        if (GState) {
          // deno-lint-ignore no-explicit-any
          (pdf as any).setGState(new GState({ opacity: 0.2 }));
        }
      } catch { /* opacity is a nice-to-have; falls back to a light colour */ }
      pdf.setFontSize(PDF_SIZE.watermark);
      pdf.setFont(bodyFont, "bold");
      pdf.setTextColor(muted[0], muted[1], muted[2]);
      // deno-lint-ignore no-explicit-any
      (pdf as any).text("PREVIEW — NOT YET SIGNED", pageWidth / 2, pageHeight / 2, {
        align: "center",
        angle: 45,
      });
      try {
        if (GState) {
          // deno-lint-ignore no-explicit-any
          (pdf as any).setGState(new GState({ opacity: 1 }));
        }
      } catch { /* reset best-effort */ }
    }
  }

  const out = pdf.output("arraybuffer");
  return new Uint8Array(out);
}
