// Shared v3.0 agreement PDF generator. Used by `accept-agreement` (to
// produce the immutable signed PDF) and by `preview-agreement-pdf` (to
// produce a watermarked preview before signing). Single source of truth so
// the preview matches the signed copy field-for-field aside from the
// signature embed and the certificate page metadata.
//
// Coexists with the older v2.x generator in `accept-agreement/index.ts` —
// that generator is still used for legacy onboarding/invite flows and is
// not modified.

// @ts-ignore - npm specifier resolved by Deno
import { jsPDF } from "npm:jspdf@2.5.1";
import { SILVERSHADOW_LOGO_DATA_URL } from "./brandLogo.ts";
import { paintPageBackground } from "./brand.ts";
import type { AgreementDocument, PartyBlock } from "./agreements/types.ts";
import type { DocumentDesignConfig } from "./pdfUtils.ts";

function jsPdfFontFor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("times")) return "times";
  if (lower.includes("courier")) return "courier";
  return "helvetica";
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

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
  const marginX = 28;
  const marginTop = 32;
  const marginBottom = 30;
  const contentWidth = pageWidth - marginX * 2;
  let y = marginTop;

  const ink = hexToRgb(design.warm_black);
  const muted = hexToRgb(design.warm_grey);
  const gold = hexToRgb(design.gold);
  const bodyFont = jsPdfFontFor(design.body_font);
  const metaFont = jsPdfFontFor(design.meta_font);

  paintPageBackground(pdf, design.background_color);

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - marginBottom) {
      pdf.addPage();
      paintPageBackground(pdf, design.background_color);
      y = marginTop;
    }
  };

  const writeBody = (text: string, body?: { indent?: number; size?: number; lineGap?: number; afterGap?: number; italic?: boolean; rgb?: [number, number, number] }) => {
    const size = body?.size ?? 10.5;
    const indent = body?.indent ?? 0;
    const lineGap = body?.lineGap ?? size * 0.62;
    const afterGap = body?.afterGap ?? 3.6;
    const [r, g, b] = body?.rgb ?? ink;
    pdf.setFontSize(size);
    pdf.setFont(bodyFont, body?.italic ? "italic" : "normal");
    pdf.setTextColor(r, g, b);
    const lines = pdf.splitTextToSize(text, contentWidth - indent);
    for (const line of lines) {
      ensureSpace(lineGap);
      pdf.text(line, marginX + indent, y);
      y += lineGap;
    }
    y += afterGap;
  };

  const writeMetaLabel = (text: string, body?: { afterGap?: number }) => {
    pdf.setFontSize(7.5);
    pdf.setFont(metaFont, "normal");
    pdf.setTextColor(muted[0], muted[1], muted[2]);
    const tracked = text.toUpperCase().split("").join(" ");
    ensureSpace(5);
    pdf.text(tracked, marginX, y);
    y += body?.afterGap ?? 6;
  };

  const writeClauseHeading = (number: string, title: string) => {
    ensureSpace(14);
    y += 8;
    pdf.setFontSize(11);
    pdf.setFont(bodyFont, "bold");
    pdf.setTextColor(gold[0], gold[1], gold[2]);
    pdf.text(`${number}.`, marginX, y);
    pdf.setTextColor(ink[0], ink[1], ink[2]);
    pdf.text(title, marginX + 7, y);
    y += 7;
  };

  const writePartyLine = (block: PartyBlock) => {
    const segments = [
      block.legalName,
      block.country ? `Registered in ${block.country}` : null,
      block.registrationNumber || null,
      block.registeredAddress || null,
    ].filter(Boolean) as string[];
    writeBody(segments.join(" · "), { size: 10.5, afterGap: 6 });
  };

  // ── Cover block ──────────────────────────────────────────────────────────
  {
    const logoWidthMm = 50;
    const logoHeightMm = logoWidthMm * (91 / 600);
    pdf.addImage(SILVERSHADOW_LOGO_DATA_URL, "PNG", (pageWidth - logoWidthMm) / 2, y, logoWidthMm, logoHeightMm);
    y += logoHeightMm + 18;
  }

  writeMetaLabel("Studio", { afterGap: 4 });
  writePartyLine(doc.cover.studio);
  writeMetaLabel("Client", { afterGap: 4 });
  writePartyLine(doc.cover.client);
  // Agreement Version is internal compliance metadata — hidden from the
  // cover and rendered in the document footer instead (matches the
  // on-screen acceptance gate). See the footer block below.
  writeMetaLabel("Effective Date", { afterGap: 4 });
  writeBody(doc.cover.effectiveDate, { afterGap: 4 });
  writeMetaLabel("Engagement Model", { afterGap: 4 });
  writeBody(doc.cover.engagementModel, { afterGap: 10 });

  ensureSpace(10);
  pdf.setDrawColor(muted[0], muted[1], muted[2]);
  pdf.setLineWidth(0.2);
  pdf.line(marginX, y, pageWidth - marginX, y);
  y += 6;
  writeBody(doc.cover.footer, { italic: true, size: 9.5, rgb: muted, afterGap: 4 });

  // ── Notice block ─────────────────────────────────────────────────────────
  // Cream-tinted background matching the on-screen acceptance gate. Filled
  // rect drawn first (so text renders on top), bracketed by the existing
  // gold rules above and below.
  {
    const tint = hexToRgb("#E5DFD4");
    const padMM = 8; // ≈24px at 72dpi
    const textX = marginX + padMM;
    const textWidth = contentWidth - padMM * 2;
    const lineGapMM = 6.5;
    const itemGapMM = 6;

    // Pre-compute block height so the fill rectangle can be sized before
    // text is drawn. splitTextToSize is deterministic for a given font +
    // size + width, so the line counts here match the render pass below.
    const heightMM = (() => {
      let h = padMM;
      h += 6; // eyebrow heading row
      pdf.setFontSize(10.5);
      pdf.setFont(bodyFont, "normal");
      const introLines = pdf.splitTextToSize(doc.notice.intro, textWidth) as string[];
      h += introLines.length * lineGapMM + 4;
      for (const item of doc.notice.items) {
        pdf.setFontSize(10.5);
        pdf.setFont(bodyFont, "bold");
        const labelW = pdf.getTextWidth(`Clause ${item.clauseRef} —`) + 2;
        pdf.setFont(bodyFont, "normal");
        const lines = pdf.splitTextToSize(item.text, textWidth - labelW) as string[];
        h += Math.max(lines.length, 1) * itemGapMM;
      }
      h += 4;
      pdf.setFontSize(10.5);
      pdf.setFont(bodyFont, "normal");
      const closingLines = pdf.splitTextToSize(doc.notice.closing, textWidth) as string[];
      h += closingLines.length * lineGapMM;
      h += padMM;
      return h;
    })();

    ensureSpace(heightMM + 8);
    y += 8;

    // Top gold rule
    pdf.setDrawColor(gold[0], gold[1], gold[2]);
    pdf.setLineWidth(0.25);
    pdf.line(marginX, y, pageWidth - marginX, y);

    // Tint fill — drawn first so text appears on top.
    pdf.setFillColor(tint[0], tint[1], tint[2]);
    pdf.rect(marginX, y, contentWidth, heightMM, "F");

    // Render content inside the tint.
    let ny = y + padMM;
    // Heading (tracked eyebrow)
    pdf.setFontSize(7.5);
    pdf.setFont(metaFont, "normal");
    pdf.setTextColor(muted[0], muted[1], muted[2]);
    pdf.text(doc.notice.heading.toUpperCase().split("").join(" "), textX, ny);
    ny += 6;

    // Intro
    pdf.setFontSize(10.5);
    pdf.setFont(bodyFont, "normal");
    pdf.setTextColor(ink[0], ink[1], ink[2]);
    const introLines = pdf.splitTextToSize(doc.notice.intro, textWidth) as string[];
    for (const line of introLines) {
      pdf.text(line, textX, ny);
      ny += lineGapMM;
    }
    ny += 4;

    // Items
    for (const item of doc.notice.items) {
      pdf.setFontSize(10.5);
      pdf.setFont(bodyFont, "bold");
      pdf.setTextColor(gold[0], gold[1], gold[2]);
      const label = `Clause ${item.clauseRef} —`;
      pdf.text(label, textX, ny);
      const labelW = pdf.getTextWidth(label) + 2;
      pdf.setFont(bodyFont, "normal");
      pdf.setTextColor(ink[0], ink[1], ink[2]);
      const lines = pdf.splitTextToSize(item.text, textWidth - labelW) as string[];
      for (let i = 0; i < lines.length; i++) {
        pdf.text(lines[i], textX + labelW, ny + i * itemGapMM);
      }
      ny += Math.max(lines.length, 1) * itemGapMM;
    }
    ny += 4;

    // Closing
    pdf.setFontSize(10.5);
    pdf.setFont(bodyFont, "normal");
    pdf.setTextColor(ink[0], ink[1], ink[2]);
    const closingLines = pdf.splitTextToSize(doc.notice.closing, textWidth) as string[];
    for (const line of closingLines) {
      pdf.text(line, textX, ny);
      ny += lineGapMM;
    }

    // Advance master y past the tint and draw the bottom gold rule.
    y += heightMM;
    pdf.line(marginX, y, pageWidth - marginX, y);
    y += 4;
  }

  // ── Clauses ──────────────────────────────────────────────────────────────
  for (const clause of doc.clauses) {
    writeClauseHeading(clause.number, clause.title);
    for (const p of clause.paragraphs) {
      if (p.type === "prose") {
        writeBody(p.text, { afterGap: 3 });
      } else if (p.type === "bullet_list") {
        for (const item of p.items) {
          writeBody(`·   ${item}`, { indent: 4, lineGap: 5.8, afterGap: 1.8 });
        }
        y += 1.5;
      } else if (p.type === "definition") {
        ensureSpace(6);
        pdf.setFontSize(10.5);
        pdf.setFont(bodyFont, "bold");
        pdf.setTextColor(ink[0], ink[1], ink[2]);
        pdf.text(p.term, marginX, y);
        const termWidth = pdf.getTextWidth(p.term) + 2;
        pdf.setFont(bodyFont, "normal");
        const full = ` — ${p.text}`;
        const lines = pdf.splitTextToSize(full, contentWidth - termWidth);
        for (let i = 0; i < lines.length; i++) {
          pdf.text(lines[i], marginX + termWidth, y + i * 5.8);
        }
        y += Math.max(lines.length, 1) * 5.8 + 2;
      } else {
        // note
        writeBody(p.text, { italic: true, rgb: muted, afterGap: 3 });
      }
    }
  }

  // ── Execution + signature ────────────────────────────────────────────────
  ensureSpace(20);
  y += 10;
  pdf.setDrawColor(muted[0], muted[1], muted[2]);
  pdf.setLineWidth(0.2);
  pdf.line(marginX, y, pageWidth - marginX, y);
  y += 6;
  writeMetaLabel("Execution", { afterGap: 4 });
  writeBody(doc.execution.intro, { afterGap: 3 });
  writeBody(doc.execution.confirmation, { afterGap: 8 });

  if (signaturePngDataUrl && signaturePngDataUrl.startsWith("data:image/png")) {
    const sigW = 70;
    const sigH = 24;
    ensureSpace(sigH + 18);
    pdf.setDrawColor(muted[0], muted[1], muted[2]);
    pdf.setLineWidth(0.15);
    pdf.line(marginX, y + sigH + 1, marginX + sigW, y + sigH + 1);
    pdf.addImage(signaturePngDataUrl, "PNG", marginX, y, sigW, sigH);
    y += sigH + 5;
    pdf.setFontSize(10);
    pdf.setFont(bodyFont, "normal");
    pdf.setTextColor(ink[0], ink[1], ink[2]);
    pdf.text(signatoryName, marginX, y);
    y += 5;
    pdf.setTextColor(muted[0], muted[1], muted[2]);
    pdf.text(signatoryPosition, marginX, y);
    y += 8;
  }

  // ── Certificate page ─────────────────────────────────────────────────────
  pdf.addPage();
  paintPageBackground(pdf, design.background_color);
  y = marginTop;
  writeMetaLabel("Acceptance certificate", { afterGap: 8 });
  pdf.setFontSize(16);
  pdf.setFont(bodyFont, "normal");
  pdf.setTextColor(ink[0], ink[1], ink[2]);
  pdf.text("Forensic record", marginX, y);
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

  pdf.setFontSize(9);
  for (const [label, val] of certRows) {
    ensureSpace(8);
    pdf.setFont(metaFont, "normal");
    pdf.setTextColor(muted[0], muted[1], muted[2]);
    pdf.text(label.toUpperCase().split("").join(" "), marginX, y);
    pdf.setFont(bodyFont, "normal");
    pdf.setTextColor(ink[0], ink[1], ink[2]);
    const valLines = pdf.splitTextToSize(val, contentWidth - 70);
    for (let i = 0; i < valLines.length; i++) {
      pdf.text(valLines[i], marginX + 70, y + i * 5);
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
      pdf.setFontSize(56);
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
