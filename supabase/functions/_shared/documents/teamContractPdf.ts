// Team engagement contract PDF generator (individual + company variants).
// Shares design tokens + rendering primitives with the v3 client agreement
// (./designTokens.ts, ./pdfPrimitives.ts) so the two document types look
// identical. Uses the embedded Tinos (SIL OFL) font so Bosnian/Croatian/
// Serbian diacritics (Đ, ć, č, š, ž …) render correctly — jsPDF's built-in
// fonts are WinAnsi-only and would mangle them.
//
// Clause language is adapted from the studio's Freelance Service Agreement so
// the engagement contract is consistent with the studio's vetted terms, and is
// self-contained (IP assignment, prohibitions, confidentiality, non-solicit,
// independent-contractor) — a per-project subcontractor needs no separate NDA.

// @ts-ignore - npm specifier resolved by Deno
import { jsPDF } from "npm:jspdf@2.5.1";
import { SILVERSHADOW_LOGO_DATA_URL } from "../brandLogo.ts";
import { paintPageBackground } from "../brand.ts";
import type { DocumentDesignConfig } from "../pdfUtils.ts";
import { STUDIO_PARTY } from "../agreements/common.ts";
import { hexToRgb, PDF_MARGIN, PDF_SIZE } from "./designTokens.ts";
import {
  type PdfContext,
  drawCoverLogo,
  drawGoldHairline,
  drawMutedHairline,
  ensureSpace,
  writeBody,
  writeClauseHeading,
  writeMetaLabel,
} from "./pdfPrimitives.ts";
import { TINOS_BOLD_B64, TINOS_ITALIC_B64, TINOS_REGULAR_B64 } from "./tinosFonts.ts";

export interface TeamContractData {
  entity_type: "individual" | "company";
  individual_full_name?: string | null;
  individual_address?: string | null;
  individual_nationality?: string | null;
  individual_ni_number?: string | null;
  company_name?: string | null;
  company_registered_office?: string | null;
  company_jurisdiction?: string | null;
  company_registration_number?: string | null;
  company_vat_number?: string | null;
  company_director_name?: string | null;
  company_director_title?: string | null;
  subject_line: string;
  scope_description: string;
  project_reference?: string | null;
  delivery_window_start?: string | null;
  delivery_window_end?: string | null;
  round_1_deadline?: string | null;
  round_2_deadline?: string | null;
  fee_amount: number;
  fee_currency: string;
  fee_scope_description?: string | null;
  payment_milestone_1_pct: number;
  payment_milestone_2_pct: number;
  payment_milestone_3_pct: number;
  signed_at?: string | null;
  signed_by_name?: string | null;
}

export interface TeamContractPdfOptions {
  /** Overlay "DRAFT — NOT YET SIGNED" on every page (unsigned preview). */
  watermark?: boolean;
}

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—";

const fmtMoney = (amount: number, currency: string) =>
  `${currency} ${(amount || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function recipientName(c: TeamContractData): string {
  return (c.entity_type === "company" ? c.company_director_name : c.individual_full_name)?.trim() || "Contractor";
}

function contractorBlock(c: TeamContractData): string {
  if (c.entity_type === "company") {
    const segs = [
      `${c.company_name}, a company organised under the laws of ${c.company_jurisdiction}`,
      `with registered office at ${c.company_registered_office}`,
      `registered under number ${c.company_registration_number}`,
    ];
    if (c.company_vat_number) segs.push(`VAT ${c.company_vat_number}`);
    segs.push(`acting through ${c.company_director_name}, ${c.company_director_title || "Director"} (the "Contractor")`);
    return segs.join(", ");
  }
  const segs = [`${c.individual_full_name}, resident at ${c.individual_address}`];
  if (c.individual_nationality) segs.push(`a national of ${c.individual_nationality}`);
  if (c.individual_ni_number) segs.push(`ID ${c.individual_ni_number}`);
  segs.push(`(the "Contractor")`);
  return segs.join(", ");
}

function buildClauses(c: TeamContractData): Array<{ title: string; body: string[] }> {
  const m1 = c.payment_milestone_1_pct, m2 = c.payment_milestone_2_pct, m3 = c.payment_milestone_3_pct;
  const amt = (pct: number) => fmtMoney((c.fee_amount * pct) / 100, c.fee_currency);
  const window = c.delivery_window_start || c.delivery_window_end
    ? `between ${fmtDate(c.delivery_window_start)} and ${fmtDate(c.delivery_window_end)}`
    : "within the timetable agreed with the Studio";
  return [
    { title: "Scope of Services", body: [
      `The Studio engages the Contractor to provide the following services: ${c.scope_description}`,
      c.project_reference ? `The engagement relates to project ${c.project_reference}.` : "",
      `The Contractor shall deliver the Services with due care, skill and diligence to the Studio's specifications, and shall not subcontract or substitute any other party to perform the Services without the Studio's prior written consent.`,
    ].filter(Boolean) },
    { title: "Rounds and Delivery", body: [
      `The Services shall be delivered ${window}.`,
      `Round 1 deliverables are due by ${fmtDate(c.round_1_deadline)}. Round 2 deliverables are due by ${fmtDate(c.round_2_deadline)}.`,
      `Time is of the essence in respect of these dates. The Contractor shall notify the Studio promptly if any deadline is at risk.`,
    ] },
    { title: "Fees", body: [
      `In consideration of the Services, the Studio shall pay the Contractor a fee of ${fmtMoney(c.fee_amount, c.fee_currency)}${c.fee_scope_description ? ` (${c.fee_scope_description})` : ""}.`,
      `The fee is inclusive of all of the Contractor's costs and expenses unless otherwise agreed in writing. The Contractor is solely responsible for all taxes, national insurance and statutory payments arising from the fee.`,
    ] },
    { title: "Payment Schedule", body: [
      `The fee is payable in three instalments: ${m1}% (${amt(m1)}) on signature of this agreement; ${m2}% (${amt(m2)}) on delivery and acceptance of Round 1; and ${m3}% (${amt(m3)}) on completion and acceptance of the final deliverables.`,
      `Each instalment is payable within 30 days of receipt of the Contractor's valid invoice. The Studio may withhold any instalment relating to deliverables not yet accepted.`,
    ] },
    { title: "Late Delivery", body: [
      `If the Contractor fails to deliver by an agreed deadline, the Studio may, without prejudice to its other rights, withhold the affected instalment until delivery, require remedial work at no additional cost, or terminate under clause 12. Repeated or material delay constitutes a material breach.`,
    ] },
    { title: "Intellectual Property Assignment", body: [
      `The Contractor assigns to the Studio, by present assignment of present and future rights and with full title guarantee, all Intellectual Property Rights in the deliverables, including all renewals, reversions, extensions and revivals and the right to bring proceedings for past infringement. The Contractor unconditionally and irrevocably waives all moral rights in the deliverables.`,
    ] },
    { title: "Absolute Prohibition on Use, Retention and Disclosure", body: [
      `The Contractor shall not use, reproduce, adapt, retain, publish or disclose the deliverables, any Studio materials, or any element of the Studio's proprietary systems, tools or processes for any purpose other than performing the Services, whether during or after the engagement. This includes an absolute prohibition on the use of the deliverables or Studio materials for the training of artificial intelligence systems.`,
      `On completion or on request, the Contractor shall return or irretrievably delete all such materials in any format and confirm compliance in writing.`,
    ] },
    { title: "Confidentiality", body: [
      `The Contractor shall keep confidential all information relating to the Studio's business, finances, clients, systems, personnel and partners that is not publicly available, and shall not disclose it to any third party. This obligation survives termination of this agreement.`,
    ] },
    { title: "Non-Solicitation", body: [
      `For a period of 24 months following completion or termination, the Contractor shall not, directly or indirectly, solicit or accept work from any client of the Studio, or any freelance contributor introduced by the Studio, without the Studio's prior written consent.`,
    ] },
    { title: "Warranties", body: [
      `The Contractor warrants that the deliverables are original and do not infringe the rights of any third party; that the Contractor is free to enter into this agreement; and that the Services will be performed to a professional standard. The Contractor shall indemnify the Studio against any losses arising from a breach of these warranties.`,
    ] },
    { title: "Independent Contractor", body: [
      `The Contractor is engaged as an independent contractor. Nothing in this agreement creates an employment relationship, partnership, joint venture or agency. The Contractor is solely responsible for the Contractor's own taxes and statutory obligations.`,
    ] },
    { title: "Termination", body: [
      `Either party may terminate this agreement on 7 days' written notice. The Studio may terminate immediately if the Contractor breaches confidentiality or the prohibitions in clause 7, fails to perform the Services to a reasonable standard, or acts in a manner that brings the Studio into disrepute.`,
      `On termination, the Contractor is entitled to payment for approved work completed up to the termination date. Clauses 6 to 10 survive termination.`,
    ] },
    { title: "Governing Law", body: [
      `This agreement is governed by the laws of England and Wales, and the parties submit to the exclusive jurisdiction of the courts of England and Wales.`,
    ] },
  ];
}

export function generateTeamContractPdf(
  c: TeamContractData,
  design: DocumentDesignConfig,
  opts: TeamContractPdfOptions = {},
): Uint8Array {
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });

  // Register Tinos (normal/bold/italic) so the primitives' setFont(..) calls
  // resolve to a Unicode-capable family.
  pdf.addFileToVFS("Tinos-Regular.ttf", TINOS_REGULAR_B64);
  pdf.addFont("Tinos-Regular.ttf", "Tinos", "normal");
  pdf.addFileToVFS("Tinos-Bold.ttf", TINOS_BOLD_B64);
  pdf.addFont("Tinos-Bold.ttf", "Tinos", "bold");
  pdf.addFileToVFS("Tinos-Italic.ttf", TINOS_ITALIC_B64);
  pdf.addFont("Tinos-Italic.ttf", "Tinos", "italic");

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const ctx: PdfContext = {
    pdf,
    pageWidth,
    pageHeight,
    contentWidth: pageWidth - PDF_MARGIN.x * 2,
    ink: hexToRgb(design.warm_black),
    muted: hexToRgb(design.warm_grey),
    gold: hexToRgb(design.gold),
    bodyFont: "Tinos",
    metaFont: "Tinos",
    backgroundColor: design.background_color,
  };

  paintPageBackground(pdf, design.background_color);
  let y = PDF_MARGIN.top;

  // ── Cover ──────────────────────────────────────────────────────────────────
  y = drawCoverLogo(ctx, y, SILVERSHADOW_LOGO_DATA_URL);

  y = writeMetaLabel(ctx, y, "Studio", { afterGap: 4 });
  const studioSegs = [
    STUDIO_PARTY.legalName,
    STUDIO_PARTY.country ? `Registered in ${STUDIO_PARTY.country}` : null,
    STUDIO_PARTY.registrationNumber || null,
    STUDIO_PARTY.registeredAddress || null,
  ].filter(Boolean) as string[];
  y = writeBody(ctx, y, studioSegs.join(" · "), { afterGap: 6 });

  y = writeMetaLabel(ctx, y, "Date", { afterGap: 4 });
  y = writeBody(ctx, y, fmtDate(c.signed_at ?? new Date().toISOString()), { afterGap: 6 });

  y = writeMetaLabel(ctx, y, "Contractor", { afterGap: 4 });
  y = writeBody(ctx, y, contractorBlock(c), { afterGap: 10 });

  y = ensureSpace(ctx, y, 10);
  drawGoldHairline(ctx, y);
  y += 6;
  y = writeMetaLabel(ctx, y, "Re", { afterGap: 4 });
  y = writeBody(ctx, y, c.subject_line, { size: 12, afterGap: 6 });

  // ── Body ────────────────────────────────────────────────────────────────────
  y = writeBody(ctx, y, `Dear ${recipientName(c)},`, { afterGap: 4 });
  y = writeBody(ctx, y,
    `This engagement letter sets out the terms on which ${STUDIO_PARTY.legalName} (the "Studio") engages the Contractor for the work described below. By signing, the Contractor agrees to the following terms.`,
    { afterGap: 2 });

  const clauses = buildClauses(c);
  clauses.forEach((clause, i) => {
    y = writeClauseHeading(ctx, y, String(i + 1), clause.title);
    for (const p of clause.body) {
      y = writeBody(ctx, y, p, { afterGap: 3 });
    }
  });

  // ── Signature page ───────────────────────────────────────────────────────────
  pdf.addPage();
  paintPageBackground(pdf, design.background_color);
  y = PDF_MARGIN.top;
  y = writeMetaLabel(ctx, y, "Accepted and agreed", { afterGap: 8 });
  y = writeBody(ctx, y,
    "By signing below, the parties accept and agree to be bound by the terms of this engagement letter.",
    { afterGap: 10 });

  // Contractor signing block (party-conditional).
  y = writeMetaLabel(ctx, y, "The Contractor", { afterGap: 6 });
  if (c.signed_at && c.signed_by_name) {
    y = writeBody(ctx, y, `Signed: ${c.signed_by_name}`, { afterGap: 2 });
    y = writeBody(ctx, y, `Date: ${fmtDate(c.signed_at)}`, { afterGap: 10 });
  } else {
    drawMutedHairline(ctx, y + 8); y += 12;
    y = writeBody(ctx, y, c.entity_type === "company"
      ? `${c.company_director_name}, ${c.company_director_title || "Director"}, for and on behalf of ${c.company_name}`
      : `${c.individual_full_name}`, { rgb: ctx.muted, size: 9.5, afterGap: 2 });
    y = writeBody(ctx, y, "Name and date", { rgb: ctx.muted, size: 9.5, afterGap: 10 });
  }

  // Studio signing block.
  y = writeMetaLabel(ctx, y, "The Studio", { afterGap: 6 });
  drawMutedHairline(ctx, y + 8); y += 12;
  y = writeBody(ctx, y, `For and on behalf of ${STUDIO_PARTY.legalName}`, { rgb: ctx.muted, size: 9.5, afterGap: 2 });
  y = writeBody(ctx, y, "Name and date", { rgb: ctx.muted, size: 9.5, afterGap: 4 });

  // ── Footer + optional watermark on every page ────────────────────────────────
  const totalPages = pdf.getNumberOfPages();
  // deno-lint-ignore no-explicit-any
  const GState = (pdf as any).GState;
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    // Footer
    pdf.setFontSize(8);
    pdf.setFont("Tinos", "normal");
    pdf.setTextColor(ctx.muted[0], ctx.muted[1], ctx.muted[2]);
    // deno-lint-ignore no-explicit-any
    (pdf as any).text(
      `Engagement letter · ${STUDIO_PARTY.legalName} · Page ${p} of ${totalPages}`,
      pageWidth / 2, pageHeight - 12, { align: "center" },
    );
    // Watermark
    if (opts.watermark) {
      try { if (GState) (pdf as any).setGState(new GState({ opacity: 0.18 })); } catch { /* best-effort */ }
      pdf.setFontSize(PDF_SIZE.watermark);
      pdf.setFont("Tinos", "bold");
      pdf.setTextColor(ctx.muted[0], ctx.muted[1], ctx.muted[2]);
      // deno-lint-ignore no-explicit-any
      (pdf as any).text("DRAFT — NOT YET SIGNED", pageWidth / 2, pageHeight / 2, { align: "center", angle: 45 });
      try { if (GState) (pdf as any).setGState(new GState({ opacity: 1 })); } catch { /* best-effort */ }
    }
  }

  return new Uint8Array(pdf.output("arraybuffer"));
}
