// Edge function: sign-freelancer-agreement
// Generates the Freelance Service Agreement PDF, uploads it, and records the signing.

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

function buildClauses(p: SignPayload, rateStr: string): Array<{ title: string; body: string }> {
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

function generatePdf(p: SignPayload, now: Date): Uint8Array {
  const ordDate   = formatOrdinalDate(now);
  const address   = formatAddress(p);
  const fullName  = `${p.firstName} ${p.lastName}`;
  const rateStr   = `${Number(p.rateAmount).toFixed(2)} ${p.rateCurrency} per ${p.ratePeriod.toLowerCase()}`;
  const clauses   = buildClauses(p, rateStr);

  const pdf        = new jsPDF("p", "mm", "a4");
  const pageWidth  = pdf.internal.pageSize.getWidth() as number;   // 210
  const pageHeight = pdf.internal.pageSize.getHeight() as number;  // 297
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

  const writeBody = (text: string, opts?: { indent?: number; size?: number; lineGap?: number; afterGap?: number; color?: number }) => {
    const size    = opts?.size    ?? 10;
    const indent  = opts?.indent  ?? 0;
    const color   = opts?.color   ?? 75;
    const lineGap = opts?.lineGap ?? size * 0.62;
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

  // ── Cover block ────────────────────────────────────────────────────────────
  writeLabel("FSA-1.0", 14);

  // Logo
  try {
    const lw = 45;
    const lh = lw * (91 / 600);
    pdf.addImage(SILVERSHADOW_LOGO_DATA_URL, "PNG", marginX, y - lh, lw, lh);
  } catch { /* logo optional */ }
  y += 10;

  // Title
  pdf.setFontSize(11);
  pdf.setFont("times", "italic");
  pdf.setTextColor(125, 125, 125);
  pdf.text("Freelance Service Agreement", marginX, y);
  y += 6;
  pdf.setFontSize(10.5);
  pdf.setFont("times", "normal");
  pdf.setTextColor(50, 50, 50);
  pdf.text(`${p.firstName} ${p.lastName}`, marginX, y);
  y += 8;

  pdf.setFontSize(7);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(150, 150, 150);
  pdf.text(ordDate.toUpperCase().split("").join(" "), marginX, y);
  y += 16;

  // ── Preamble / parties ─────────────────────────────────────────────────────
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

  // ── Clauses ────────────────────────────────────────────────────────────────
  for (const clause of clauses) {
    writeSectionHeading(clause.title);
    if (clause.title !== "15. Signatures") {
      writeBody(clause.body, { color: 70 });
    }
  }

  // ── Signature block ────────────────────────────────────────────────────────
  ensureSpace(70);
  y += 4;

  const sigColLeft  = marginX;
  const sigColRight = marginX + contentWidth / 2 + 10;

  // Left: Contractor
  pdf.setDrawColor(100, 100, 100);
  pdf.setLineWidth(0.3);
  pdf.line(sigColLeft, y, sigColLeft + 65, y);
  y += 6;
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(40, 40, 40);
  pdf.text(fullName, sigColLeft, y);
  y += 5;
  pdf.setFontSize(8);
  pdf.setTextColor(120, 120, 120);
  pdf.text(ordDate, sigColLeft, y);

  // Right: Studio — same y anchors
  const rightY = y - 11;
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

  y += 20;

  // ── Footer on every page ───────────────────────────────────────────────────
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

// ── Main handler ──────────────────────────────────────────────────────────────

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

    const now      = new Date();
    const pdfBytes = generatePdf(p, now);

    // Bucket created by migration; ignore error if it already exists.
    await admin.storage.createBucket("freelancer-agreements", { public: false }).catch(() => {});

    const fileName    = `FSA-${Date.now()}.pdf`;
    const storagePath = `${user.id}/${fileName}`;

    const { error: uploadErr } = await admin.storage
      .from("freelancer-agreements")
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });
    if (uploadErr) throw uploadErr;

    const address = formatAddress(p);

    const { error: profileErr } = await admin.from("freelancer_profiles").upsert({
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
    }, { onConflict: "user_id" });
    if (profileErr) throw profileErr;

    const { error: agrErr } = await admin.from("freelancer_agreements").insert({
      user_id:        user.id,
      signatory_name: `${p.firstName} ${p.lastName}`,
      storage_path:   storagePath,
      file_name:      fileName,
      file_size:      pdfBytes.byteLength,
      signed_at:      now.toISOString(),
    });
    if (agrErr) throw agrErr;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("sign-freelancer-agreement error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
