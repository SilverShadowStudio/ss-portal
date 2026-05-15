// Edge function: sign-freelancer-documents
// Generates both an NDA PDF and a Freelance Service Agreement PDF, uploads both to
// the freelancer-documents bucket, upserts the freelancer profile, and inserts two
// rows into freelancer_documents.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
// @ts-ignore
import { jsPDF } from "npm:jspdf@2.5.1";
import { SILVERSHADOW_LOGO_DATA_URL } from "../_shared/brandLogo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SignPayload {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  rateAmount: number;
  rateCurrency: string;   // "GBP" | "EUR" | "USD"
  ratePeriod: string;     // "day" | "week" | "month"
  flatNumber?: string;
  houseNumber: string;
  streetName: string;
  city: string;
  postcode: string;
  country: string;
  bankName: string;
  accountNumber: string;
  sortCode: string;
  accountHolder: string;
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

function formatOrdinalDate(d: Date): string {
  const day = d.getDate();
  const month = d.toLocaleDateString("en-GB", { month: "long" });
  return `${day}${ordinalSuffix(day)} ${month} ${d.getFullYear()}`;
}

function formatAddress(p: SignPayload): string {
  const flat = p.flatNumber?.trim() ? `Flat ${p.flatNumber.trim()}, ` : "";
  return `${flat}${p.houseNumber} ${p.streetName}, ${p.city}, ${p.postcode}, ${p.country}`;
}

// ── PDF factory ────────────────────────────────────────────────────────────────
// Returns a jsPDF instance together with helper functions that share a y cursor.

function makePdfDoc() {
  const pdf        = new jsPDF("p", "mm", "a4");
  const pageWidth  = pdf.internal.pageSize.getWidth()  as number; // 210
  const pageHeight = pdf.internal.pageSize.getHeight() as number; // 297
  const marginX    = 34;
  const marginTop  = 42;
  const marginBottom = 30;
  const contentWidth = pageWidth - marginX * 2;
  let y = marginTop;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - marginBottom) {
      pdf.addPage();
      y = marginTop;
    }
  };

  const writeBody = (
    text: string,
    opts?: { indent?: number; size?: number; lineGap?: number; afterGap?: number; color?: number }
  ) => {
    const size     = opts?.size     ?? 10;
    const indent   = opts?.indent   ?? 0;
    const color    = opts?.color    ?? 75;
    const lineGap  = opts?.lineGap  ?? size * 0.62;
    const afterGap = opts?.afterGap ?? 3.6;
    pdf.setFontSize(size);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(color, color, color);
    const lines = pdf.splitTextToSize(text, contentWidth - indent) as string[];
    for (const line of lines) {
      ensureSpace(lineGap);
      pdf.text(line, marginX + indent, y);
      y += lineGap;
    }
    y += afterGap;
  };

  const writeLabel = (text: string, afterGap = 6) => {
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(140, 140, 140);
    const tracked = text.toUpperCase().split("").join(" ");
    ensureSpace(5);
    pdf.text(tracked, marginX, y);
    y += afterGap;
  };

  const writeSectionHeading = (text: string) => {
    ensureSpace(20);
    y += 12;
    pdf.setFontSize(8.5);
    pdf.setFont("times", "bold");
    pdf.setTextColor(50, 50, 50);
    pdf.text(text.toUpperCase().split("").join(" "), marginX, y);
    y += 8;
  };

  const writeSubHeading = (text: string) => {
    ensureSpace(10);
    y += 4;
    pdf.setFontSize(9.5);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(55, 55, 55);
    const lines = pdf.splitTextToSize(text, contentWidth) as string[];
    for (const line of lines) {
      ensureSpace(5.5);
      pdf.text(line, marginX, y);
      y += 5.5;
    }
    y += 2;
  };

  const writeItem = (prefix: string, text: string) => {
    const indentMm  = 6;
    const prefixMm  = 7;
    const size      = 10;
    const lineH     = 6.5;
    const afterGap  = 2;
    pdf.setFontSize(size);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(70, 70, 70);
    const lines = pdf.splitTextToSize(text, contentWidth - indentMm - prefixMm) as string[];
    ensureSpace(lineH);
    pdf.text(prefix, marginX + indentMm, y);
    for (let i = 0; i < lines.length; i++) {
      ensureSpace(lineH);
      pdf.text(lines[i], marginX + indentMm + prefixMm, y);
      if (i < lines.length - 1) y += lineH;
    }
    y += lineH;
    y += afterGap;
  };

  const addFooters = () => {
    const totalPages = (pdf as any).internal.pages.length - 1;
    for (let pg = 1; pg <= totalPages; pg++) {
      pdf.setPage(pg);
      const fy = pageHeight - 8;
      pdf.setFontSize(6);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(160, 160, 160);
      pdf.text(
        "SILVERSHADOW STUDIO LIMITED  |  REGISTERED IN ENGLAND & WALES: 9178937  |  VAT NUMBER: GB 232 8467 02",
        pageWidth / 2, fy - 4, { align: "center" }
      );
      pdf.text(
        "332 LADBROKE GROVE, LONDON, W10 5AD  |  +44(0)203 876 5980  |  SILVERSHADOWSTUDIO.COM",
        pageWidth / 2, fy, { align: "center" }
      );
    }
  };

  return {
    pdf,
    pageWidth,
    pageHeight,
    marginX,
    marginBottom,
    contentWidth,
    getY: () => y,
    setY: (val: number) => { y = val; },
    ensureSpace,
    writeBody,
    writeLabel,
    writeSectionHeading,
    writeSubHeading,
    writeItem,
    addFooters,
  };
}

// ── NDA generator ──────────────────────────────────────────────────────────────

function generateNdaPdf(p: SignPayload, now: Date): Uint8Array {
  const ordDate  = formatOrdinalDate(now);
  const address  = formatAddress(p);
  const fullName = `${p.firstName} ${p.lastName}`;

  const doc = makePdfDoc();
  const {
    pdf, pageWidth, pageHeight, marginX, contentWidth,
    getY, setY,
    ensureSpace, writeBody, writeLabel, writeSectionHeading, writeSubHeading, writeItem, addFooters,
  } = doc;

  // ── Cover block ──────────────────────────────────────────────────────────────
  writeLabel("MNDA-1.0", 14);

  // Logo
  try {
    const lw = 45;
    const lh = lw * (91 / 600);
    pdf.addImage(SILVERSHADOW_LOGO_DATA_URL, "PNG", marginX, getY() - lh, lw, lh);
  } catch { /* logo optional */ }
  setY(getY() + 10);

  // Title
  pdf.setFontSize(11);
  pdf.setFont("times", "italic");
  pdf.setTextColor(125, 125, 125);
  pdf.text("Mutual Non-Disclosure Agreement", marginX, getY());
  setY(getY() + 6);
  pdf.setFontSize(10.5);
  pdf.setFont("times", "normal");
  pdf.setTextColor(50, 50, 50);
  pdf.text(fullName, marginX, getY());
  setY(getY() + 8);

  pdf.setFontSize(7);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(150, 150, 150);
  pdf.text(ordDate.toUpperCase().split("").join(" "), marginX, getY());
  setY(getY() + 16);

  // ── Body ─────────────────────────────────────────────────────────────────────

  writeSectionHeading("Mutual Non-Disclosure Agreement");
  writeBody(`This Agreement is made on ${ordDate}`, { color: 60, afterGap: 8 });
  writeBody("Between:", { color: 60, afterGap: 4 });
  writeBody(
    `(1) Silvershadow Studio Limited, a company incorporated in England and Wales (registered number 09178937) whose registered office is at 332 Ladbroke Grove, London, W10 5AD ("Silvershadow"); and`,
    { color: 70, afterGap: 4 }
  );
  writeBody(
    `(2) ${fullName} of ${address} ("Counterparty"),`,
    { color: 70, afterGap: 4 }
  );
  writeBody(`each a "Party" and together the "Parties".`, { color: 70, afterGap: 8 });

  writeSectionHeading("Background");
  writeItem(
    "(A)",
    `The Parties wish to explore, negotiate and potentially perform a business engagement relating to CGI production services and related deliverables provided by the Counterparty to Silvershadow Studio Limited (the "Purpose").`
  );
  writeItem(
    "(B)",
    `In connection with the Purpose, each Party may disclose Confidential Information to the other. This Agreement sets out the terms on which such Confidential Information will be protected.`
  );

  writeSectionHeading("1. Definitions");
  writeSubHeading("1.1  In this Agreement:");
  writeBody(
    `"Affiliate" means, in relation to a Party, any entity that directly or indirectly controls, is controlled by, or is under common control with that Party.`,
    { indent: 5, color: 70, afterGap: 2.5 }
  );
  writeBody(
    `"Confidential Information" means any information disclosed by or on behalf of a Party (the "Disclosing Party") to the other Party (the "Receiving Party") before or after the date of this Agreement, in any form, that is either (a) marked or identified as confidential, or (b) would reasonably be understood to be confidential given its nature or the circumstances of disclosure. It includes, without limitation, business plans, client identities, project briefs, designs, renders, drawings, models, technical methods, pricing, financial information, software, source files, and any analyses or derivatives prepared by the Receiving Party that contain or reflect such information.`,
    { indent: 5, color: 70, afterGap: 2.5 }
  );
  writeBody(
    `"Group" means a Party and its Affiliates.`,
    { indent: 5, color: 70, afterGap: 2.5 }
  );
  writeBody(
    `"Permitted Recipients" means a Receiving Party's directors, officers, employees, professional advisers, and sub-contractors who (a) have a genuine need to know the Confidential Information for the Purpose, (b) have been informed of its confidential nature, and (c) are bound by written obligations of confidentiality no less protective than those in this Agreement.`,
    { indent: 5, color: 70, afterGap: 2.5 }
  );
  writeBody(
    `"Trade Secrets" means Confidential Information that constitutes a trade secret under the Trade Secrets (Enforcement, etc.) Regulations 2018.`,
    { indent: 5, color: 70, afterGap: 4 }
  );
  writeBody(
    `1.2  Headings are for convenience and do not affect interpretation. References to statutes include subsequent amendments. "Including" means including without limitation.`,
    { color: 70 }
  );

  writeSectionHeading("2. Confidentiality Obligations");
  writeSubHeading("2.1  The Receiving Party shall:");
  writeItem("(a)", "keep the Confidential Information strictly confidential;");
  writeItem("(b)", "use the Confidential Information solely for the Purpose;");
  writeItem(
    "(c)",
    "protect the Confidential Information using at least the same standard of care it applies to its own confidential information of similar importance, and in any event no less than a reasonable standard of care;"
  );
  writeItem(
    "(d)",
    "not copy, reproduce or reduce to writing any part of the Confidential Information except as reasonably necessary for the Purpose;"
  );
  writeItem("(e)", "disclose the Confidential Information only to Permitted Recipients; and");
  writeItem(
    "(f)",
    "remain liable for any breach of this Agreement by its Permitted Recipients as if such breach were its own."
  );
  writeBody(
    "2.2  The Receiving Party shall promptly notify the Disclosing Party on becoming aware of any unauthorised disclosure, loss or misuse of Confidential Information, and shall take reasonable steps requested by the Disclosing Party to mitigate it.",
    { color: 70 }
  );

  writeSectionHeading("3. Exceptions");
  writeSubHeading("3.1  The obligations in clause 2 do not apply to information that the Receiving Party can demonstrate:");
  writeItem(
    "(a)",
    "was lawfully in its possession before disclosure, free of any obligation of confidence;"
  );
  writeItem(
    "(b)",
    "is or becomes publicly available through no act or omission of the Receiving Party or its Permitted Recipients;"
  );
  writeItem(
    "(c)",
    "is lawfully obtained from a third party who is not under any obligation of confidence in respect of it; or"
  );
  writeItem(
    "(d)",
    "is independently developed by the Receiving Party without reference to the Confidential Information."
  );
  writeBody(
    "3.2  The Receiving Party may disclose Confidential Information to the extent required by law, regulation, court order, or any competent regulatory authority, provided that (where lawful and practicable) it first notifies the Disclosing Party and reasonably co-operates in any effort by the Disclosing Party to limit or contest the disclosure.",
    { color: 70 }
  );

  writeSectionHeading("4. Ownership");
  writeBody(
    "4.1  All Confidential Information remains the property of the Disclosing Party. Nothing in this Agreement transfers any intellectual property rights between the Parties.",
    { color: 70 }
  );
  writeBody(
    "4.2  No licence is granted under this Agreement except the limited right to use Confidential Information for the Purpose. Ownership of any deliverables, work product, or intellectual property created in connection with the Purpose is governed by the separate services or commercial agreement between the Parties.",
    { color: 70 }
  );

  writeSectionHeading("5. Marketing and Portfolio Rights");
  writeBody(
    "5.1  Neither Party shall use the name, trademarks, logos, or proprietary indicia of the other Party, or refer publicly to the existence or subject matter of the engagement, without the other Party's prior written consent. Consent shall not be unreasonably withheld or delayed.",
    { color: 70 }
  );
  writeBody(
    "5.2  Notwithstanding clause 5.1, on completion of any engagement Silvershadow may include the engagement in its portfolio and credentials, subject to the Counterparty's prior written approval of the specific imagery, wording, and channels used. Such approval shall not be unreasonably withheld or delayed.",
    { color: 70 }
  );

  writeSectionHeading("6. Return or Destruction");
  writeBody(
    "6.1  On written request by the Disclosing Party, or on expiry or termination of the engagement to which the Confidential Information relates, the Receiving Party shall promptly (at the Disclosing Party's option) return or destroy all Confidential Information in its possession or control, and certify in writing that it has done so.",
    { color: 70 }
  );
  writeBody(
    "6.2  The Receiving Party may retain (a) one copy of Confidential Information solely for legal, regulatory, or internal compliance purposes, and (b) copies held in routine electronic backup systems that are not practicable to delete, in each case subject to the continuing obligations of this Agreement.",
    { color: 70 }
  );
  writeBody(
    "6.3  The obligations in clause 6.1 do not require Silvershadow to return or destroy any working files, project archives, source files, or render data that are reasonably required to support, maintain, or amend deliverables that have been paid for in full, provided such materials continue to be held subject to this Agreement.",
    { color: 70 }
  );

  writeSectionHeading("7. Term and Survival");
  writeBody(
    "7.1  This Agreement takes effect on the date written above and continues in force for two years, unless terminated earlier by either Party on written notice.",
    { color: 70 }
  );
  writeBody(
    "7.2  The confidentiality obligations in clause 2 survive termination and continue for five years from the date of disclosure of each item of Confidential Information.",
    { color: 70 }
  );
  writeBody(
    "7.3  The confidentiality obligations in respect of Trade Secrets survive for as long as the relevant information continues to qualify as a Trade Secret.",
    { color: 70 }
  );

  writeSectionHeading("8. Remedies");
  writeBody(
    "8.1  Each Party acknowledges that damages alone may not be an adequate remedy for breach of this Agreement, and that the other Party shall be entitled to seek injunctive relief, specific performance, and other equitable remedies in addition to any other rights or remedies available at law.",
    { color: 70 }
  );
  writeBody(
    "8.2  The rights and remedies in this Agreement are cumulative and not exclusive of any rights or remedies provided by law.",
    { color: 70 }
  );

  writeSectionHeading("9. Warranties and Liability");
  writeBody(
    "9.1  Each Party warrants that it has the legal right and authority to enter into and perform this Agreement.",
    { color: 70 }
  );
  writeBody(
    "9.2  Save as set out in clause 9.1, no Party makes any representation or warranty, express or implied, as to the accuracy, completeness, or fitness for purpose of any Confidential Information disclosed, and no Party shall be liable to the other in respect of any reliance placed on such information beyond the use of it for the Purpose.",
    { color: 70 }
  );
  writeBody(
    "9.3  Nothing in this Agreement limits or excludes any liability for fraud, fraudulent misrepresentation, death or personal injury caused by negligence, or any other liability that cannot lawfully be excluded.",
    { color: 70 }
  );

  writeSectionHeading("10. Notices");
  writeBody(
    "10.1  Notices under this Agreement shall be in writing and delivered by hand, by pre-paid first-class post, or by email to the registered office address or principal business email of the receiving Party.",
    { color: 70 }
  );
  writeSubHeading("10.2  Notices shall be deemed received:");
  writeItem("(a)", "if delivered by hand, on delivery;");
  writeItem(
    "(b)",
    "if posted within the UK, on the second working day after posting, and if posted internationally, on the tenth working day;"
  );
  writeItem("(c)", "if sent by email, on the next working day after sending.");

  writeSectionHeading("11. General");
  writeBody(
    "11.1  Assignment. Neither Party may assign, transfer or sub-contract its rights or obligations under this Agreement without the other Party's prior written consent, save that either Party may assign to an Affiliate or to a successor of all or substantially all of its business.",
    { color: 70 }
  );
  writeBody(
    "11.2  Variation. No variation of this Agreement is effective unless in writing and signed by or on behalf of both Parties.",
    { color: 70 }
  );
  writeBody(
    "11.3  Waiver. No failure or delay in exercising any right or remedy operates as a waiver of that or any other right or remedy.",
    { color: 70 }
  );
  writeBody(
    "11.4  Severance. If any provision of this Agreement is held to be invalid, illegal or unenforceable, that provision shall be severed and the remainder of this Agreement shall continue in full force and effect.",
    { color: 70 }
  );
  writeBody(
    "11.5  Entire Agreement. This Agreement constitutes the entire agreement between the Parties in relation to its subject matter and supersedes all prior discussions, representations and agreements relating to it. This clause does not exclude liability for fraud or fraudulent misrepresentation.",
    { color: 70 }
  );
  writeBody(
    `11.6  Third-Party Rights. The Contracts (Rights of Third Parties) Act 1999 does not apply to this Agreement, save that each Party's Affiliates may enforce its provisions directly.`,
    { color: 70 }
  );
  writeBody(
    "11.7  Counterparts and Electronic Signature. This Agreement may be executed in counterparts, each of which constitutes an original. Electronic signatures and scanned copies have the same effect as original wet-ink signatures.",
    { color: 70 }
  );

  writeSectionHeading("12. Governing Law and Jurisdiction");
  writeBody(
    "This Agreement and any dispute or claim arising out of or in connection with it (including non-contractual disputes and claims) shall be governed by and construed in accordance with the laws of England and Wales, and the Parties submit to the exclusive jurisdiction of the courts of England and Wales.",
    { color: 70 }
  );

  // ── Signature block ──────────────────────────────────────────────────────────
  ensureSpace(80);
  const sigY = getY();

  const sigColLeft  = marginX;
  const sigColRight = marginX + contentWidth / 2 + 10;

  pdf.setDrawColor(100, 100, 100);
  pdf.setLineWidth(0.3);

  // Left: Silvershadow
  pdf.line(sigColLeft, sigY, sigColLeft + 65, sigY);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(40, 40, 40);
  pdf.text("Silvershadow Studio Limited", sigColLeft, sigY + 6);
  pdf.setFontSize(8.5);
  pdf.text("Fred Colomb — Director", sigColLeft, sigY + 11);
  pdf.setFontSize(8);
  pdf.setTextColor(150, 150, 150);
  pdf.text(ordDate, sigColLeft, sigY + 16);

  // Right: Counterparty
  pdf.line(sigColRight, sigY, sigColRight + 65, sigY);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(40, 40, 40);
  pdf.text(fullName, sigColRight, sigY + 6);
  pdf.setFontSize(8);
  pdf.setTextColor(150, 150, 150);
  pdf.text(ordDate, sigColRight, sigY + 11);

  setY(sigY + 30);

  addFooters();

  return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer);
}

// ── FSA generator ──────────────────────────────────────────────────────────────
// Copied verbatim from sign-freelancer-agreement/index.ts.

function buildFsaClauses(p: SignPayload, rateStr: string): Array<{ title: string; body: string }> {
  return [
    {
      title: "1. Nature of Engagement",
      body: "The Contractor is engaged by the Client as an independent contractor to provide freelance services. Nothing in this Agreement shall be deemed to create an employment relationship, joint venture, agency or partnership. The Contractor is solely responsible for all taxes, national insurance, and any other statutory payments.",
    },
    {
      title: "2. Scope of Services",
      body: "The Contractor shall provide CGI production services including 3D modelling, texturing, lighting, rendering, and post-production as directed per project brief. The Contractor shall report directly to the Production Director. Work is delivered via agreed file transfer to studio specifications. The Contractor is responsible for meeting agreed deadlines and quality standards. The Contractor shall deliver services with due care, skill and diligence and may not subcontract or substitute another party to perform the Services without prior written consent of the Client.",
    },
    {
      title: "3. Term",
      body: "This Agreement shall commence on the date first above written and shall continue on a rolling monthly basis unless terminated earlier in accordance with Clause 11.",
    },
    {
      title: "4. Compensation",
      body: `The Contractor shall be paid ${rateStr}. The Contractor shall invoice the Client monthly in arrears. Payment will be made by bank transfer within 30 days of receipt of a valid invoice. If the Client disputes any portion of an invoice, the Client shall pay the undisputed portion and notify the Contractor in writing. The disputed portion shall be paid within 30 days of dispute resolution.`,
    },
    {
      title: "5. VAT",
      body: "The Contractor shall notify the Client immediately upon VAT registration. Where applicable, VAT will be added to invoices at the prevailing rate.",
    },
    {
      title: "6. Confidentiality",
      body: "The Contractor agrees to keep confidential any information relating to the Client's business, finances, clients, systems, employees, or partners that is not publicly available. This obligation shall survive termination of this Agreement. Upon termination or on request, the Contractor shall return or delete all confidential information held in any format and confirm compliance in writing.",
    },
    {
      title: "7. Data Protection",
      body: "The Contractor agrees to comply with all applicable UK data protection laws, including the UK GDPR. The Contractor must implement adequate measures to safeguard personal data and shall not share any such data with third parties.",
    },
    {
      title: "8. Intellectual Property",
      body: "The Contractor assigns by present assignment of future rights all Intellectual Property Rights in the Deliverables to the Client with full title guarantee, including any renewals, reversions, extensions or revivals and including the right to take action for past acts of infringement. The Contractor unconditionally and irrevocably waives all moral rights in relation to the Deliverables. The Contractor agrees not to use, replicate, or derive from any proprietary internal tools, systems, or processes developed by the Client, including any elements of the Silvershadow Proprietary App System, either during or after the term of this Agreement.",
    },
    {
      title: "9. Non-Solicitation",
      body: "The Contractor agrees not to directly solicit or accept work from any Client of Silvershadow Studio Limited or freelance contributor introduced by the Client for a period of 24 months following termination, without prior written consent.",
    },
    {
      title: "10. Non-Disparagement",
      body: "The Contractor agrees not to make or publish any disparaging, defamatory, or negative statements about the Client, its directors, employees, services, or clients, whether during or after the term of this Agreement.",
    },
    {
      title: "11. Termination",
      body: "This Agreement may be terminated by either party with 7 days' written notice. The Client may terminate the agreement immediately if the Contractor breaches confidentiality, fails to perform services to a reasonable standard, or acts in a manner that brings the Client into disrepute. Upon termination, the Contractor shall be entitled to payment for all approved work completed up to the termination date.",
    },
    {
      title: "12. Bank Holidays and Weekends",
      body: "The Contractor is not required to work on weekends or during the eight standard UK Bank Holidays: New Year's Day, Good Friday, Easter Monday, Early May Bank Holiday, Spring Bank Holiday, Summer Bank Holiday, Christmas Day, Boxing Day.",
    },
    {
      title: "13. Entire Agreement",
      body: "This Agreement constitutes the entire agreement between the Parties and supersedes all prior oral or written understandings. Any changes must be made in writing and signed by both Parties.",
    },
    {
      title: "14. Governing Law",
      body: "This Agreement shall be governed by the laws of England and Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of England.",
    },
    {
      title: "15. Signatures",
      body: "IN WITNESS WHEREOF, the parties have executed this Agreement on the date first above written.",
    },
  ];
}

function generateFsaPdf(p: SignPayload, now: Date): Uint8Array {
  const ordDate      = formatOrdinalDate(now);
  const address      = formatAddress(p);
  const fullName     = `${p.firstName} ${p.lastName}`;
  const rateStr      = `${Number(p.rateAmount).toFixed(2)} ${p.rateCurrency} per ${p.ratePeriod.toLowerCase()}`;
  const clauses      = buildFsaClauses(p, rateStr);

  const doc = makePdfDoc();
  const {
    pdf, pageWidth, pageHeight, marginX, contentWidth,
    getY, setY,
    ensureSpace, writeBody, writeLabel, writeSectionHeading, addFooters,
  } = doc;

  // ── Cover block ──────────────────────────────────────────────────────────────
  writeLabel("FSA-1.0", 14);

  try {
    const lw = 45;
    const lh = lw * (91 / 600);
    pdf.addImage(SILVERSHADOW_LOGO_DATA_URL, "PNG", marginX, getY() - lh, lw, lh);
  } catch { /* logo optional */ }
  setY(getY() + 10);

  pdf.setFontSize(11);
  pdf.setFont("times", "italic");
  pdf.setTextColor(125, 125, 125);
  pdf.text("Freelance Service Agreement", marginX, getY());
  setY(getY() + 6);
  pdf.setFontSize(10.5);
  pdf.setFont("times", "normal");
  pdf.setTextColor(50, 50, 50);
  pdf.text(fullName, marginX, getY());
  setY(getY() + 8);

  pdf.setFontSize(7);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(150, 150, 150);
  pdf.text(ordDate.toUpperCase().split("").join(" "), marginX, getY());
  setY(getY() + 16);

  // ── Preamble / parties ───────────────────────────────────────────────────────
  writeBody(
    `This Freelance Services Agreement ("Agreement") is made and entered into on ${ordDate} by and between:`,
    { color: 60, afterGap: 8 }
  );
  writeBody("Client:  Silvershadow Studio Limited",            { color: 45 });
  writeBody("332 Ladbroke Grove, London, W10 5AD",             { color: 75, size: 9.5, afterGap: 1.6 });
  writeBody("Company No: 9178937",                             { color: 75, size: 9.5, afterGap: 1.6 });
  writeBody("VAT Number: GB 232 8467 02",                      { color: 75, size: 9.5, afterGap: 1.6 });
  writeBody("(\"Client\")",                                     { color: 75, size: 9.5, afterGap: 8 });

  writeBody("and",                                             { color: 100, afterGap: 8 });

  writeBody(`Contractor:  ${fullName}`,                        { color: 45 });
  writeBody(address,                                           { color: 75, size: 9.5, afterGap: 1.6 });
  writeBody("(\"Contractor\")",                                 { color: 75, size: 9.5, afterGap: 10 });

  writeBody(
    "The Client and the Contractor (collectively, the \"Parties\") agree as follows:",
    { color: 60, afterGap: 4 }
  );

  // ── Clauses ──────────────────────────────────────────────────────────────────
  for (const clause of clauses) {
    writeSectionHeading(clause.title);
    if (clause.title !== "15. Signatures") {
      writeBody(clause.body, { color: 70 });
    }
  }

  // ── Signature block ──────────────────────────────────────────────────────────
  ensureSpace(70);
  setY(getY() + 4);

  const sigColLeft  = marginX;
  const sigColRight = marginX + contentWidth / 2 + 10;

  pdf.setDrawColor(100, 100, 100);
  pdf.setLineWidth(0.3);

  // Left: Contractor
  pdf.line(sigColLeft, getY(), sigColLeft + 65, getY());
  setY(getY() + 6);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(40, 40, 40);
  pdf.text(fullName, sigColLeft, getY());
  setY(getY() + 5);
  pdf.setFontSize(8);
  pdf.setTextColor(120, 120, 120);
  pdf.text(ordDate, sigColLeft, getY());

  // Right: Studio — same y anchors
  const rightY = getY() - 11;
  pdf.line(sigColRight, rightY, sigColRight + 65, rightY);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(40, 40, 40);
  pdf.text("Silvershadow Studio Limited", sigColRight, rightY + 6);
  pdf.setFontSize(8.5);
  pdf.text("Fred Colomb — Director", sigColRight, rightY + 11);
  pdf.setFontSize(8);
  pdf.setTextColor(120, 120, 120);
  pdf.text(ordDate, sigColRight, rightY + 16);

  setY(getY() + 20);

  // ── Footer on every page ─────────────────────────────────────────────────────
  const totalPages = (pdf as any).internal.pages.length - 1;
  for (let pg = 1; pg <= totalPages; pg++) {
    pdf.setPage(pg);
    const fy = pageHeight - 8;
    pdf.setFontSize(6);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(160, 160, 160);
    pdf.text(
      "SILVERSHADOW STUDIO LIMITED  |  REGISTERED IN ENGLAND & WALES: 9178937  |  VAT NUMBER: GB 232 8467 02",
      pageWidth / 2, fy - 4, { align: "center" }
    );
    pdf.text(
      "332 LADBROKE GROVE, LONDON, W10 5AD  |  +44(0)203 876 5980  |  SILVERSHADOWSTUDIO.COM",
      pageWidth / 2, fy, { align: "center" }
    );
  }

  return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer);
}

// ── Main handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin       = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const p: SignPayload = await req.json();
    const now = new Date();

    const ndaBytes = generateNdaPdf(p, now);
    const fsaBytes = generateFsaPdf(p, now);

    // Bucket created by migration; ignore error if it already exists.
    await admin.storage.createBucket("freelancer-documents", { public: false }).catch(() => {});

    const ts      = Date.now();
    const ndaPath = `${user.id}/MNDA-${ts}.pdf`;
    const fsaPath = `${user.id}/FSA-${ts + 1}.pdf`;

    const { error: ndaErr } = await admin.storage
      .from("freelancer-documents")
      .upload(ndaPath, ndaBytes, { contentType: "application/pdf", upsert: false });
    if (ndaErr) throw ndaErr;

    const { error: fsaErr } = await admin.storage
      .from("freelancer-documents")
      .upload(fsaPath, fsaBytes, { contentType: "application/pdf", upsert: false });
    if (fsaErr) throw fsaErr;

    const address = formatAddress(p);

    const { data: profile, error: profileErr } = await admin
      .from("freelancer_profiles")
      .upsert({
        user_id:        user.id,
        first_name:     p.firstName,
        last_name:      p.lastName,
        email:          p.email,
        role:           p.role          || null,
        day_rate:       p.rateAmount    || null,
        rate_currency:  p.rateCurrency  || "GBP",
        rate_period:    p.ratePeriod    || "day",
        flat_number:    p.flatNumber    || null,
        house_number:   p.houseNumber   || null,
        street_name:    p.streetName    || null,
        city:           p.city          || null,
        postcode:       p.postcode      || null,
        country:        p.country       || null,
        address,
        bank_name:      p.bankName      || null,
        account_number: p.accountNumber || null,
        sort_code:      p.sortCode      || null,
        account_holder: p.accountHolder || null,
        updated_at:     now.toISOString(),
      }, { onConflict: "user_id" })
      .select("id")
      .single();
    if (profileErr) throw profileErr;

    // Look up account membership (may not exist for freelancers).
    const { data: membership } = await admin
      .from("account_members")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const accountId = membership?.account_id ?? null;

    const { error: docsErr } = await admin.from("freelancer_documents").insert([
      {
        account_id:     accountId,
        profile_id:     profile?.id ?? null,
        document_type:  "nda",
        signed_at:      now.toISOString(),
        signed_by_name: `${p.firstName} ${p.lastName}`,
        pdf_url:        ndaPath,
      },
      {
        account_id:     accountId,
        profile_id:     profile?.id ?? null,
        document_type:  "service_agreement",
        signed_at:      now.toISOString(),
        signed_by_name: `${p.firstName} ${p.lastName}`,
        pdf_url:        fsaPath,
      },
    ]);
    if (docsErr) throw docsErr;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("sign-freelancer-documents error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
