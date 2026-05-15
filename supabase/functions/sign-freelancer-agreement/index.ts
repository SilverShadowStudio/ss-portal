// Edge function: sign-freelancer-agreement
// - Verifies JWT auth
// - Generates a freelancer services agreement PDF
// - Uploads to freelancer-agreements storage bucket
// - Upserts freelancer_profiles row
// - Inserts freelancer_agreements row

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
  dayRate: number;
  bankName: string;
  accountNumber: string;
  sortCode: string;
  accountHolder: string;
  address: string;
}

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

    const payload: SignPayload = await req.json();
    const { firstName, lastName, email, role, dayRate, bankName, accountNumber, sortCode, accountHolder, address } = payload;
    const fullName  = `${firstName} ${lastName}`;
    const now       = new Date();
    const signedDate = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

    // ── Generate PDF ────────────────────────────────────────────────────────
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const W   = doc.internal.pageSize.getWidth()  as number;
    const H   = doc.internal.pageSize.getHeight() as number;
    const mL  = 72;
    const mR  = 72;
    const cW  = W - mL - mR;

    const warmBlack: [number, number, number] = [26,  24,  20];
    const warmGrey:  [number, number, number] = [138, 128, 112];
    const gold:      [number, number, number] = [184, 154, 106];
    const bgColor:   [number, number, number] = [237, 232, 224];

    const newPage = () => {
      doc.addPage();
      doc.setFillColor(...bgColor);
      doc.rect(0, 0, W, H, "F");
      return 64;
    };

    const guard = (y: number) => y > H - 100 ? newPage() : y;

    doc.setFillColor(...bgColor);
    doc.rect(0, 0, W, H, "F");

    let y = 64;

    // Logo
    try {
      doc.addImage(SILVERSHADOW_LOGO_DATA_URL, "PNG", mL, y, 160, 22);
    } catch { /* logo optional */ }
    y += 48;

    // Title
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...warmBlack);
    doc.text("Freelancer Services Agreement", mL, y);
    y += 8;

    doc.setDrawColor(...gold);
    doc.setLineWidth(0.5);
    doc.line(mL, y, W - mR, y);
    y += 18;

    // Date
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...warmGrey);
    doc.text(`Dated ${signedDate}`, mL, y);
    y += 22;

    // Agreement clauses
    const sections = [
      {
        heading: "1. PARTIES",
        body: `This Freelancer Services Agreement ("Agreement") is between Silvershadow Studio Limited, a company incorporated in England and Wales ("the Studio"), and ${fullName} ("the Freelancer").`,
      },
      {
        heading: "2. SERVICES",
        body: "The Freelancer agrees to provide CGI production, architectural visualisation, or related creative services on a project-by-project basis as assigned by the Studio. The Studio makes no guarantee of minimum work volume.",
      },
      {
        heading: "3. DAY RATE AND PAYMENT",
        body: `The Freelancer's agreed day rate is £${Number(dayRate).toFixed(2)} GBP. The Studio will pay agreed invoices within 30 days of receipt, provided the Services have been delivered to the agreed standard.`,
      },
      {
        heading: "4. INTELLECTUAL PROPERTY",
        body: "All work product, deliverables, and creative output produced under this Agreement shall be the exclusive intellectual property of Silvershadow Studio Limited upon full payment. The Freelancer retains no licence to use, reproduce, or distribute work produced for the Studio without prior written consent.",
      },
      {
        heading: "5. CONFIDENTIALITY",
        body: "The Freelancer agrees to keep strictly confidential all client identities, project details, business information, and technical processes belonging to the Studio and its clients. This obligation survives termination of this Agreement for a period of five years.",
      },
      {
        heading: "6. INDEPENDENT CONTRACTOR",
        body: "The Freelancer is an independent contractor and not an employee of the Studio. The Freelancer is solely responsible for their own tax obligations, National Insurance contributions, and professional indemnity insurance.",
      },
      {
        heading: "7. TERMINATION",
        body: "Either party may terminate this Agreement with 14 days' written notice. The Studio may terminate immediately for material breach, including non-delivery, breach of confidentiality, or misconduct.",
      },
      {
        heading: "8. GOVERNING LAW",
        body: "This Agreement is governed by the laws of England and Wales. Both parties submit to the exclusive jurisdiction of the English courts.",
      },
    ];

    for (const s of sections) {
      y = guard(y);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...warmBlack);
      doc.text(s.heading, mL, y);
      y += 12;

      doc.setFont("Helvetica", "normal");
      doc.setTextColor(...warmBlack);
      const lines = doc.splitTextToSize(s.body, cW) as string[];
      for (const line of lines) {
        y = guard(y);
        doc.text(line, mL, y);
        y += 11;
      }
      y += 8;
    }

    // Schedule 1
    y = guard(y);
    y += 8;
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...warmBlack);
    doc.text("SCHEDULE 1 — FREELANCER DETAILS", mL, y);
    y += 16;

    const scheduleRows: [string, string][] = [
      ["Name",           fullName],
      ["Email",          email],
      ["Role",           role || "Freelancer"],
      ["Day Rate",       `£${Number(dayRate).toFixed(2)} GBP`],
      ["Address",        address || "—"],
      ["Bank",           bankName || "—"],
      ["Account Holder", accountHolder || "—"],
      ["Sort Code",      sortCode || "—"],
      ["Account Number", accountNumber || "—"],
    ];

    doc.setFontSize(8);
    for (const [label, value] of scheduleRows) {
      y = guard(y);
      doc.setFont("Helvetica", "bold");
      doc.setTextColor(...warmGrey);
      doc.text(label, mL, y);
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(...warmBlack);
      doc.text(value, mL + 110, y);
      y += 14;
    }

    // Signature block
    y = guard(y);
    y += 20;
    doc.setDrawColor(...gold);
    doc.line(mL, y, mL + 220, y);
    y += 13;
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...warmGrey);
    doc.text(`Signed by: ${fullName}`, mL, y);
    y += 11;
    doc.text(`Date: ${signedDate}`, mL, y);
    y += 11;
    const disclaimer = "By completing onboarding via the Silvershadow Studio portal, the Freelancer confirms";
    const disclaimer2 = "acceptance of all terms contained in this Agreement.";
    doc.text(disclaimer,  mL, y); y += 11;
    doc.text(disclaimer2, mL, y);

    const pdfBytes = doc.output("arraybuffer");
    const pdfUint8 = new Uint8Array(pdfBytes);

    // ── Upload PDF ─────────────────────────────────────────────────────────
    const bucketName  = "freelancer-agreements";
    // Bucket is created by the migration; ignore error if already exists.
    await admin.storage.createBucket(bucketName, { public: false }).catch(() => {});

    const fileName    = `SSS-FA-${Date.now()}.pdf`;
    const storagePath = `${user.id}/${fileName}`;

    const { error: uploadErr } = await admin.storage
      .from(bucketName)
      .upload(storagePath, pdfUint8, { contentType: "application/pdf", upsert: false });
    if (uploadErr) throw uploadErr;

    // ── Upsert freelancer profile ──────────────────────────────────────────
    const { error: profileErr } = await admin.from("freelancer_profiles").upsert({
      user_id:        user.id,
      first_name:     firstName,
      last_name:      lastName,
      email,
      role:           role     || null,
      day_rate:       dayRate  || null,
      bank_name:      bankName || null,
      account_number: accountNumber || null,
      sort_code:      sortCode || null,
      account_holder: accountHolder || null,
      address:        address  || null,
      updated_at:     now.toISOString(),
    }, { onConflict: "user_id" });
    if (profileErr) throw profileErr;

    // ── Insert agreement record ────────────────────────────────────────────
    const { error: agrErr } = await admin.from("freelancer_agreements").insert({
      user_id:        user.id,
      signatory_name: fullName,
      storage_path:   storagePath,
      file_name:      fileName,
      file_size:      pdfUint8.byteLength,
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
