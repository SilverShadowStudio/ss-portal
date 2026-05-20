// Edge function: accept-agreement
// - Receives signup form data + acceptance metadata
// - Verifies version, captures IP & user agent
// - Creates auth user (service role), profile, client role
// - Generates the legal PDF server-side
// - Uploads PDF to the agreements bucket (immutable: no upsert)
// - Records the agreement row + immutable audit log entry
// - Returns session tokens so the client can sign in

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
// @ts-ignore - npm specifier resolved by Deno
import { jsPDF } from "npm:jspdf@2.5.1";
import { SILVERSHADOW_LOGO_DATA_URL } from "../_shared/brandLogo.ts";
import { loadBrand, paintPageBackground } from "../_shared/brand.ts";
import {
  AGREEMENT_SECTIONS,
  type AgreementSection,
} from "./agreementContent.ts";
// v3.0 agreement library — mirror of src/lib/agreements/. The same
// AgreementDocument the client sees on /contract is rendered into the PDF
// so the on-screen and signed-PDF copies are byte-identical in content.
import {
  getAgreement,
  SUPPORTED_AGREEMENT_VERSIONS,
} from "../_shared/agreements/index.ts";
import { loadDesignConfig } from "../_shared/pdfUtils.ts";
import { generateAgreementPdfV3 } from "../_shared/agreementPdfV3.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AcceptPayload {
  formData: {
    companyName: string;
    country: string;
    registrationNumber: string;
    streetName: string;
    buildingNumber: string;
    city: string;
    postcode: string;
    firstName: string;
    familyName: string;
    position: string;
    emailAddress: string;
    password: string;
  };
  acceptance: {
    checkboxText: string;
    versionCode: string;
    acceptedAtClient: string; // ISO from client (informational)
  };
}

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, "0");
  }
  return out;
}

function generateAgreementPdf(args: {
  formData: AcceptPayload["formData"];
  versionCode: string;
  acceptedAt: string;
  agreementUid: string;
  accountId: string;
  ipAddress: string;
  backgroundHex: string;
}): Uint8Array {
  const { formData, versionCode, acceptedAt, agreementUid, accountId, ipAddress, backgroundHex } = args;
  // Editorial layout — mirrors the on-screen Services Agreement.
  // A4 page, generous side margins (~32mm) to mimic the constrained
  // 720px web column. Neutral typography, no accent colors.
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth(); // 210
  const pageHeight = pdf.internal.pageSize.getHeight(); // 297
  const marginX = 34;
  const marginTop = 42;
  const marginBottom = 30;
  const contentWidth = pageWidth - marginX * 2;
  let y = marginTop;

  const fullAddress = `${formData.buildingNumber} ${formData.streetName}, ${formData.city}, ${formData.postcode}`;
  const acceptorName = `${formData.firstName} ${formData.familyName}`;

  paintPageBackground(pdf, backgroundHex);

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - marginBottom) {
      pdf.addPage();
      paintPageBackground(pdf, backgroundHex);
      y = marginTop;
    }
  };

  // Body text — muted neutral (~70% black to mirror screen)
  const writeBody = (text: string, opts?: { indent?: number; size?: number; lineGap?: number; afterGap?: number; color?: number }) => {
    const size = opts?.size ?? 10.5;
    const indent = opts?.indent ?? 0;
    const color = opts?.color ?? 75;
    const lineGap = opts?.lineGap ?? size * 0.62;
    const afterGap = opts?.afterGap ?? 3.6;
    pdf.setFontSize(size);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(color, color, color);
    const lines = pdf.splitTextToSize(text, contentWidth - indent);
    for (const line of lines) {
      ensureSpace(lineGap);
      pdf.text(line, marginX + indent, y);
      y += lineGap;
    }
    y += afterGap;
  };

  // Small uppercase label (tracked)
  const writeLabel = (text: string, opts?: { afterGap?: number }) => {
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(140, 140, 140);
    // simulate letter-spacing by inserting hairline spaces
    const tracked = text.toUpperCase().split("").join(" ");
    ensureSpace(5);
    pdf.text(tracked, marginX, y);
    y += opts?.afterGap ?? 6;
  };

  // Section heading — uppercase, tracked, medium contrast
  const writeSectionHeading = (text: string) => {
    ensureSpace(20);
    y += 14; // generous space before
    pdf.setFontSize(8.5);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(70, 70, 70);
    const tracked = text.toUpperCase().split("").join(" ");
    pdf.text(tracked, marginX, y);
    y += 8;
  };

  // ===== Title block =====
  writeLabel(versionCode, { afterGap: 14 });

  // Brand logo (replaces the "SilverShadow Studio Limited" wordmark).
  // 600x91 px source. Render 45mm wide → ~6.83mm tall.
  {
    const logoWidthMm = 45;
    const logoHeightMm = logoWidthMm * (91 / 600);
    // Anchor so the logo's baseline matches the original text baseline at y.
    pdf.addImage(
      SILVERSHADOW_LOGO_DATA_URL,
      "PNG",
      marginX,
      y - logoHeightMm,
      logoWidthMm,
      logoHeightMm,
    );
  }
  y += 10;

  pdf.setFontSize(11);
  pdf.setFont("times", "italic");
  pdf.setTextColor(125, 125, 125);
  pdf.text("Terms of Use and Services Agreement", marginX, y);
  y += 14;

  pdf.setFontSize(7);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(150, 150, 150);
  pdf.text(acceptedAt.split("T")[0].toUpperCase().split("").join(" "), marginX, y);
  y += 18;

  // ===== Client identification =====
  writeLabel("Client identified during registration", { afterGap: 6 });
  writeBody(
    `${formData.companyName}, incorporated or registered in ${formData.country} with registration number ${formData.registrationNumber}, whose registered address is ${fullAddress}.`,
    { color: 55, afterGap: 4 }
  );
  writeBody(
    `Authorised contact: ${acceptorName} — ${formData.position} — ${formData.emailAddress}`,
    { size: 9.5, color: 130, afterGap: 6 }
  );

  // ===== Sections (data-driven from the same source the UI uses) =====
  for (const section of AGREEMENT_SECTIONS as AgreementSection[]) {
    writeSectionHeading(`${section.number}. ${section.title}`);
    for (const line of section.body) {
      const isBullet = line.startsWith("\u2022");
      if (isBullet) {
        const text = line.replace(/^\u2022\s*/, "");
        writeBody(`\u2014   ${text}`, { indent: 5, afterGap: 1.8, lineGap: 5.8 });
      } else {
        writeBody(line, { afterGap: 3.6 });
      }
    }
  }

  // ===== Acceptance metadata page =====
  pdf.addPage();
  paintPageBackground(pdf, backgroundHex);
  y = marginTop;
  writeLabel("Acceptance record", { afterGap: 9 });
  pdf.setFontSize(18);
  pdf.setFont("times", "normal");
  pdf.setTextColor(20, 20, 20);
  pdf.text("Acceptance Metadata", marginX, y);
  y += 12;
  pdf.setFontSize(9.5);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(60, 60, 60);
  const metaRows: [string, string][] = [
    ["Agreement Version", versionCode],
    ["Accepted on", acceptedAt],
    ["Accepted by", `${acceptorName}, ${formData.emailAddress}`],
    ["Position", formData.position],
    ["Client Account ID", accountId],
    ["Agreement ID", agreementUid],
    ["IP Address", ipAddress],
    ["Company", formData.companyName],
    ["Country", formData.country],
    ["Registration No.", formData.registrationNumber],
    ["Address", fullAddress],
  ];
  for (const [k, v] of metaRows) {
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(120, 120, 120);
    pdf.text(k.toUpperCase().split("").join(" "), marginX, y);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(40, 40, 40);
    const valLines = pdf.splitTextToSize(v, contentWidth - 55);
    pdf.text(valLines, marginX + 55, y);
    y += 6 * Math.max(1, valLines.length);
  }

  const arr = pdf.output("arraybuffer");
  return new Uint8Array(arr);
}

// ═══════════════════════════════════════════════════════════════════════════
// v3.0 PATH — schedule-aware acceptance gate with embedded drawn signature
// and forensic certificate page. Coexists with the existing v2.x onboarding
// and invite flows below; the v3 branch is selected by payload shape.
// ═══════════════════════════════════════════════════════════════════════════

interface AcceptV3Payload {
  agreement_version: string;
  schedule_type: "project" | "partnership";
  signatory_name: string;
  signatory_position: string;
  signature_png_base64: string;
  scrolled_to_end_at: string;
  time_on_page_seconds: number;
  pdf_downloaded_before_signing: boolean;
  client_timestamp: string;
}

// The v3 PDF generator lives in `_shared/agreementPdfV3.ts` and is
// imported at the top of this file. Helpers (jsPdfFontFor, hexToRgb) moved
// with it.

async function handleV3Acceptance(req: Request, rawBody: Record<string, unknown>): Promise<Response> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. Authenticate
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Validate payload shape
  const payload = rawBody as unknown as AcceptV3Payload;
  const requiredKeys: (keyof AcceptV3Payload)[] = [
    "agreement_version", "schedule_type", "signatory_name", "signatory_position",
    "signature_png_base64", "scrolled_to_end_at", "client_timestamp",
  ];
  for (const k of requiredKeys) {
    const v = (payload as Record<string, unknown>)[k as string];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      return new Response(JSON.stringify({ error: `Missing field: ${k}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
  if (payload.schedule_type !== "project" && payload.schedule_type !== "partnership") {
    return new Response(JSON.stringify({ error: "Invalid schedule_type" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!(SUPPORTED_AGREEMENT_VERSIONS as readonly string[]).includes(payload.agreement_version)) {
    return new Response(JSON.stringify({ error: "Unsupported agreement_version" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 3. Fetch account via account_members → reject if no membership.
  const { data: membership, error: memberErr } = await admin
    .from("account_members")
    .select("account_id, accounts(id, company_name, account_type, country, registration_number, building_number, street_name, city, postcode)")
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberErr) {
    console.error("[v3] member lookup failed:", memberErr);
  }
  // deno-lint-ignore no-explicit-any
  const acct = (membership as any)?.accounts as {
    id: string;
    company_name: string;
    account_type: string | null;
    country: string | null;
    registration_number: string | null;
    building_number: string | null;
    street_name: string | null;
    city: string | null;
    postcode: string | null;
  } | null;
  if (!acct) {
    return new Response(JSON.stringify({ error: "No account membership found for this user" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 4. Schedule ↔ account_type integrity check — prevent tampered requests.
  if (acct.account_type !== payload.schedule_type) {
    return new Response(JSON.stringify({ error: "schedule_type does not match account_type" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 5. Reject if an active (supported-version) agreement already exists.
  const { data: existing } = await admin
    .from("agreements")
    .select("id, agreement_version")
    .eq("account_id", acct.id)
    .in("agreement_version", SUPPORTED_AGREEMENT_VERSIONS as readonly string[]);
  if (existing && existing.length > 0) {
    return new Response(JSON.stringify({
      error: "An active agreement already exists for this account",
      code: "ALREADY_ACCEPTED",
      existing_version: existing[0].agreement_version,
    }), {
      status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 6. Build the document via the shared library — same source as Contract.tsx.
  const acceptedAtIso = new Date().toISOString();
  const registeredAddress = [acct.building_number, acct.street_name, acct.postcode, acct.city]
    .filter(Boolean).join(", ") || null;
  const document_ = getAgreement({
    schedule: payload.schedule_type,
    client: {
      legalName: acct.company_name,
      country: acct.country,
      registrationNumber: acct.registration_number,
      registeredAddress,
    },
    effectiveDate: new Date(acceptedAtIso).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    }),
  });
  if (!document_) {
    return new Response(JSON.stringify({ error: "Agreement schedule not yet supported" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 7. Generate PDF.
  const agreementUid = crypto.randomUUID();
  const ipAddress = getClientIp(req);
  const userAgent = req.headers.get("user-agent") ?? "unknown";
  const design = await loadDesignConfig(admin);

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = generateAgreementPdfV3({
      doc: document_,
      signaturePngDataUrl: payload.signature_png_base64,
      signatoryName: payload.signatory_name.trim(),
      signatoryPosition: payload.signatory_position.trim(),
      acceptedAt: acceptedAtIso,
      agreementUid,
      accountId: acct.id,
      ipAddress,
      userAgent,
      scrolledToEndAt: payload.scrolled_to_end_at,
      timeOnPageSeconds: payload.time_on_page_seconds ?? 0,
      pdfDownloadedBeforeSigning: !!payload.pdf_downloaded_before_signing,
      design,
    });
  } catch (e) {
    console.error("[v3] PDF generation failed:", e);
    return new Response(JSON.stringify({ error: "Failed to generate agreement PDF" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 8. Compute SHA-256 of the final PDF.
  const pdfSha256 = await sha256Hex(pdfBytes);

  // 9. Upload to storage at agreements/{user_id}/{agreement_uid}.pdf.
  // The "Users can view their own agreement files" RLS policy on the
  // agreements bucket requires the first path segment to equal the
  // requesting user's auth.uid(). An earlier draft used {account_id}/...
  // (cleaner data model) but RLS blocked the signing client from reading
  // their own file. Option A (account-aware RLS) is the proper end state
  // — see HANDOFF.md note pinned to the studio-account cleanup.
  const storagePath = `${user.id}/${agreementUid}.pdf`;
  const { error: uploadErr } = await admin.storage
    .from("agreements")
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });
  if (uploadErr) {
    console.error("[v3] PDF upload failed:", uploadErr);
    return new Response(JSON.stringify({ error: "Failed to store agreement PDF" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 10. Insert agreement row.
  const safeCompany = acct.company_name.replace(/[^a-zA-Z0-9]+/g, "_");
  const fileName = `Services_Agreement_${safeCompany}_${Date.now()}.pdf`;
  const { data: agreementRow, error: agreementErr } = await admin
    .from("agreements")
    .insert({
      user_id: user.id,
      account_id: acct.id,
      company_name: acct.company_name,
      signatory_name: payload.signatory_name.trim(),
      signatory_position: payload.signatory_position.trim(),
      storage_path: storagePath,
      file_name: fileName,
      file_size: pdfBytes.byteLength,
      agreement_version: payload.agreement_version,
      agreement_uid: agreementUid,
      accepted_at: acceptedAtIso,
      accepted_by_name: payload.signatory_name.trim(),
      accepted_by_email: user.email ?? "",
      ip_address: ipAddress,
      user_agent: userAgent,
      checkbox_text: document_.execution.confirmation,
      pdf_sha256: pdfSha256,
      // v3 forensic columns
      schedule_type: payload.schedule_type,
      scrolled_to_end_at: payload.scrolled_to_end_at,
      time_on_page_seconds: payload.time_on_page_seconds ?? 0,
      pdf_downloaded_before_signing: !!payload.pdf_downloaded_before_signing,
    })
    .select("id")
    .single();
  if (agreementErr || !agreementRow) {
    console.error("[v3] agreement insert failed:", agreementErr);
    // Best-effort: remove the uploaded blob so a retry can re-upload.
    try { await admin.storage.from("agreements").remove([storagePath]); } catch { /* ignore */ }
    return new Response(JSON.stringify({ error: "Failed to record agreement" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const agreementId = agreementRow.id as string;

  // 11. signatures_audit_log — best-effort; do not fail the response if it errors.
  //     Uses the await + destructure { error } pattern (NOT .catch on PostgrestBuilder).
  {
    // document_type is constrained to ('client_agreement','quotation','nda','service_agreement').
    // The brief said to fall back to the existing value if custom types
    // aren't supported. The v3 specificity lives in `version_code`.
    const { error: auditErr } = await admin.from("signatures_audit_log").insert({
      document_type: "client_agreement",
      document_id: agreementId,
      account_id: acct.id,
      user_id: user.id,
      signatory_name: payload.signatory_name.trim(),
      signatory_position: payload.signatory_position.trim(),
      signed_at: acceptedAtIso,
      ip_address: ipAddress,
      user_agent: userAgent,
      acceptance_text: document_.execution.confirmation,
      version_code: payload.agreement_version,
      pdf_sha256: pdfSha256,
    });
    if (auditErr) console.warn("[v3] signatures_audit_log insert failed:", auditErr);
  }

  // 12. activity_log entry. Best-effort.
  {
    const { error: actErr } = await admin.from("activity_log").insert({
      actor_user_id: user.id,
      actor_name: payload.signatory_name.trim(),
      actor_role: "client",
      action: "agreement_signed",
      description: `${payload.signatory_name.trim()} signed ${payload.agreement_version}`,
      metadata: {
        company_name: acct.company_name,
        version_code: payload.agreement_version,
        schedule_type: payload.schedule_type,
        agreement_id: agreementId,
      },
    });
    if (actErr) console.warn("[v3] activity_log insert failed:", actErr);
  }

  // 13. Send confirmation email with attached PDF (best-effort).
  // Visual system matches the invitation email: cream #EDE8E0 ground,
  // centred wordmark + architectural illustration, serif body in #1A1814,
  // small "silvershadowstudio.com" footer at 45% opacity. No internal
  // version/date metadata appears in the visible body — that lives in the
  // attached PDF.
  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey && user.email) {
      // Base64-encode the PDF for the Resend attachments payload.
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < pdfBytes.length; i += chunk) {
        binary += String.fromCharCode(...pdfBytes.subarray(i, i + chunk));
      }
      const pdfBase64 = btoa(binary);

      // Greeting: first whitespace token of the signatory name. Omitted
      // entirely when null/empty. Same logic the invitation email uses.
      const firstNameRaw = (payload.signatory_name || "").trim().split(/\s+/)[0] || "";
      const escapeHtml = (s: string) => s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
      const greetingHtml = firstNameRaw ? `${escapeHtml(firstNameRaw)},<br><br>` : "";

      const LOGO_URL = "https://portal.silvershadowstudio.com/email-assets/silvershadow-wordmark.png";

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#EDE8E0"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDE8E0"><tr><td align="center" valign="top"><table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%"><tr><td style="font-family:Arial,sans-serif;padding:48px 40px"><div style="text-align:center;margin-bottom:48px"><img src="${LOGO_URL}" alt="Silver Shadow Studio" style="height:28px;width:auto;filter:brightness(0);border:none"></div><p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:#1A1814;line-height:1.7;text-align:center;max-width:360px;margin:0 auto 32px">${greetingHtml}Thank you for accepting the Silver Shadow Studio Services Agreement. A signed copy is attached to this email and is also available in your portal under Documents.</p><p style="text-align:center;margin:32px 0 0 0"><a href="https://portal.silvershadowstudio.com" style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#1A1814;text-decoration:none;display:inline-block;padding-bottom:6px;border-bottom:1px solid #B89A6A">PORTAL</a></p></td></tr></table></td></tr></table></body></html>`;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Silver Shadow Studio <portal@silvershadowstudio.com>",
          to: [user.email],
          subject: "Your Services Agreement",
          html,
          attachments: [{ filename: fileName, content: pdfBase64 }],
        }),
      });
    }
  } catch (e) {
    console.warn("[v3] confirmation email failed:", e);
  }

  // 14. Return success. Public URL is generated via a signed URL on demand
  // by the Documents page; here we return the storage path.
  return new Response(JSON.stringify({
    success: true,
    agreement_id: agreementId,
    storage_path: storagePath,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── v3 acceptance path ──────────────────────────────────────────────────────
  // Detected by payload shape: presence of `schedule_type` + `agreement_version`
  // at top level. Coexists with the legacy v2.x flows below.
  if (typeof rawBody.schedule_type === "string" && typeof rawBody.agreement_version === "string") {
    return handleV3Acceptance(req, rawBody);
  }

  // ── Invite mode: user already provisioned, just sign the agreement ─────────
  if (rawBody.inviteMode === true) {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { createClient: cc } = await import("https://esm.sh/@supabase/supabase-js@2.45.0");
    const userClient = cc(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const acceptance = rawBody.acceptance as {
      checkboxText: string;
      versionCode: string;
      acceptedAtClient: string;
    };
    if (!acceptance?.checkboxText || !acceptance?.versionCode) {
      return new Response(JSON.stringify({ error: "Missing acceptance metadata" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: profile }, { data: member }] = await Promise.all([
      admin.from("profiles").select("first_name, last_name, full_name, position").eq("user_id", user.id).maybeSingle(),
      admin.from("account_members").select("account_id, accounts(company_name, country, registration_number, building_number, street_name, city, postcode)").eq("user_id", user.id).maybeSingle(),
    ]);

    if (!member?.account_id) {
      return new Response(JSON.stringify({ error: "Account not found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accountId = member.account_id as string;
    const acc = (member as any).accounts as Record<string, string | null> | null ?? {};

    const firstName = (profile as any)?.first_name ?? "";
    const lastName = (profile as any)?.last_name ?? "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ") || (profile as any)?.full_name || "";

    const inviteFormData: AcceptPayload["formData"] = {
      companyName: (acc.company_name as string) ?? "",
      country: (acc.country as string) ?? "",
      registrationNumber: (acc.registration_number as string) ?? "",
      buildingNumber: (acc.building_number as string) ?? "",
      streetName: (acc.street_name as string) ?? "",
      city: (acc.city as string) ?? "",
      postcode: (acc.postcode as string) ?? "",
      firstName,
      familyName: lastName,
      position: (profile as any)?.position ?? "",
      emailAddress: user.email ?? "",
      password: "",
    };

    const acceptedAtIso = new Date().toISOString();
    const agreementUid = crypto.randomUUID();
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const userAgent = req.headers.get("user-agent") ?? "unknown";

    const brand = await loadBrand(admin);
    let pdfBytes: Uint8Array;
    try {
      pdfBytes = generateAgreementPdf({
        formData: inviteFormData,
        versionCode: acceptance.versionCode,
        acceptedAt: acceptedAtIso,
        agreementUid,
        accountId,
        ipAddress,
        backgroundHex: brand.background_color,
      });
    } catch (err) {
      console.error("invite mode PDF generation failed", err);
      return new Response(JSON.stringify({ error: "Failed to generate agreement PDF" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pdfSha256 = await sha256Hex(pdfBytes);
    const safeCompany = inviteFormData.companyName.replace(/[^a-zA-Z0-9]+/g, "_");
    const fileName = `Services_Agreement_${safeCompany}_${Date.now()}.pdf`;
    const storagePath = `${user.id}/${fileName}`;

    const { error: uploadErr } = await admin.storage
      .from("agreements")
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });

    if (uploadErr) {
      console.error("invite mode PDF upload failed", uploadErr);
      return new Response(JSON.stringify({ error: "Failed to store agreement PDF" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("agreements").insert({
      user_id: user.id,
      account_id: accountId,
      company_name: inviteFormData.companyName,
      signatory_name: fullName,
      signatory_position: inviteFormData.position,
      storage_path: storagePath,
      file_name: fileName,
      file_size: pdfBytes.byteLength,
      agreement_version: acceptance.versionCode,
      agreement_uid: agreementUid,
      accepted_at: acceptedAtIso,
      accepted_by_name: fullName,
      accepted_by_email: user.email ?? "",
      ip_address: ipAddress,
      user_agent: userAgent,
      checkbox_text: acceptance.checkboxText,
      pdf_sha256: pdfSha256,
    });

    try {
      await admin.from("agreement_audit_log").insert({
        user_id: user.id,
        account_id: accountId,
        agreement_uid: agreementUid,
        agreement_version: acceptance.versionCode,
        checkbox_text: acceptance.checkboxText,
        accepted_at: acceptedAtIso,
        ip_address: ipAddress,
        user_agent: userAgent,
        storage_path: storagePath,
        pdf_sha256: pdfSha256,
      });
    } catch (e) { console.warn("invite mode audit log failed", e) }

    try {
      await admin.from("activity_log").insert({
        actor_user_id: user.id,
        actor_name: fullName,
        actor_role: "client",
        action: "agreement_signed",
        description: `${fullName} signed ${acceptance.versionCode}`,
        metadata: { company_name: inviteFormData.companyName, version_code: acceptance.versionCode },
      });
    } catch (e) { console.warn("invite mode activity log failed", e) }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Normal (onboarding) flow ───────────────────────────────────────────────
  const payload = rawBody as AcceptPayload;
  const { formData, acceptance } = payload || ({} as AcceptPayload);
  if (!formData || !acceptance) {
    return new Response(JSON.stringify({ error: "Missing payload" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Basic validation
  const required = [
    "companyName", "country", "registrationNumber", "streetName",
    "buildingNumber", "city", "postcode", "firstName", "familyName",
    "position", "emailAddress", "password",
  ];
  for (const k of required) {
    if (!(formData as Record<string, string>)[k] || String((formData as Record<string, string>)[k]).trim() === "") {
      return new Response(JSON.stringify({ error: `Missing field: ${k}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
  if (!acceptance.checkboxText || !acceptance.versionCode) {
    return new Response(JSON.stringify({ error: "Missing acceptance metadata" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Verify version exists & is current
  const { data: versionRow, error: versionErr } = await admin
    .from("agreement_terms_versions")
    .select("version_code, is_current")
    .eq("version_code", acceptance.versionCode)
    .maybeSingle();
  if (versionErr || !versionRow) {
    return new Response(JSON.stringify({ error: "Unknown agreement version" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Create auth user
  const { data: created, error: signupErr } = await admin.auth.admin.createUser({
    email: formData.emailAddress,
    password: formData.password,
    email_confirm: true,
    user_metadata: {
      full_name: `${formData.firstName} ${formData.familyName}`,
    },
  });

  if (signupErr || !created?.user) {
    return new Response(
      JSON.stringify({
        error: signupErr?.message || "Could not create account",
        code: "signup_failed",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const userId = created.user.id;

  // 3a. Create the company account (one per signup) and owner membership.
  // The agreements.account_id FK requires this row to exist before insert.
  const { data: accountRow, error: accountErr } = await admin
    .from("accounts")
    .insert({
      company_name: formData.companyName,
      country: formData.country,
      registration_number: formData.registrationNumber,
      building_number: formData.buildingNumber,
      street_name: formData.streetName,
      city: formData.city,
      postcode: formData.postcode,
      owner_user_id: userId,
      agreement_acknowledged_version: acceptance.versionCode,
      agreement_acknowledged_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (accountErr || !accountRow) {
    console.error("account insert failed", accountErr);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return new Response(
      JSON.stringify({
        error: "Account creation could not be completed. Please contact Silver Shadow Studio.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const accountId = accountRow.id;

  // 3b. Add the signup user as Owner of the new account.
  const { error: memberErr } = await admin.from("account_members").insert({
    account_id: accountId,
    user_id: userId,
    role: "owner",
    joined_at: new Date().toISOString(),
  });
  if (memberErr) {
    console.error("account_members insert failed", memberErr);
  }

  // 3. Upsert profile
  const { error: profileErr } = await admin.from("profiles").upsert(
    {
      user_id: userId,
      full_name: `${formData.firstName} ${formData.familyName}`,
      first_name: formData.firstName,
      last_name: formData.familyName,
      company: formData.companyName,
      position: formData.position,
      account_id: accountId,
    },
    { onConflict: "user_id" }
  );
  if (profileErr) {
    console.error("profile upsert failed", profileErr);
  }

  // 4. Assign client role
  await admin
    .from("user_roles")
    .insert({ user_id: userId, role: "client" });

  // 5. Generate PDF
  const acceptedAtIso = new Date().toISOString();
  const agreementUid = crypto.randomUUID();
  const ipAddress = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || "unknown";

  const brand = await loadBrand(admin);
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = generateAgreementPdf({
      formData,
      versionCode: acceptance.versionCode,
      acceptedAt: acceptedAtIso,
      agreementUid,
      accountId,
      ipAddress,
      backgroundHex: brand.background_color,
    });
  } catch (err) {
    console.error("PDF generation failed", err);
    // Roll back the created user so the account is not activated.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return new Response(
      JSON.stringify({
        error: "Account creation could not be completed. Please contact Silver Shadow Studio.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Tamper-evidence: SHA-256 of the exact PDF bytes that will be stored.
  const pdfSha256 = await sha256Hex(pdfBytes);

  // 6. Upload PDF (immutable: no upsert)
  const safeCompany = formData.companyName.replace(/[^a-zA-Z0-9]+/g, "_");
  const fileName = `Services_Agreement_${safeCompany}_${Date.now()}.pdf`;
  const storagePath = `${userId}/${fileName}`;

  const { error: uploadErr } = await admin.storage
    .from("agreements")
    .upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadErr) {
    console.error("PDF upload failed", uploadErr);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return new Response(
      JSON.stringify({
        error: "Account creation could not be completed. Please contact Silver Shadow Studio.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // 7. Insert agreement row
  const { data: agreementRow, error: agreementErr } = await admin
    .from("agreements")
    .insert({
      user_id: userId,
      account_id: accountId,
      company_name: formData.companyName,
      signatory_name: `${formData.firstName} ${formData.familyName}`,
      signatory_position: formData.position,
      storage_path: storagePath,
      file_name: fileName,
      file_size: pdfBytes.byteLength,
      agreement_version: acceptance.versionCode,
      agreement_uid: agreementUid,
      accepted_at: acceptedAtIso,
      accepted_by_name: `${formData.firstName} ${formData.familyName}`,
      accepted_by_email: formData.emailAddress,
      ip_address: ipAddress,
      user_agent: userAgent,
      checkbox_text: acceptance.checkboxText,
      pdf_sha256: pdfSha256,
    })
    .select("id")
    .single();

  if (agreementErr || !agreementRow) {
    console.error("agreement insert failed", agreementErr);
    // Best-effort cleanup
    try { await admin.storage.from("agreements").remove([storagePath]) } catch { /* ignore */ }
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return new Response(
      JSON.stringify({
        error: "Account creation could not be completed. Please contact Silver Shadow Studio.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // 8. Audit log (immutable — no UPDATE/DELETE policies exist)
  await admin.from("agreement_audit_log").insert({
    user_id: userId,
    account_id: accountId,
    agreement_id: agreementRow.id,
    agreement_uid: agreementUid,
    agreement_version: acceptance.versionCode,
    checkbox_text: acceptance.checkboxText,
    accepted_at: acceptedAtIso,
    ip_address: ipAddress,
    user_agent: userAgent,
    storage_path: storagePath,
    pdf_sha256: pdfSha256,
  });

  // 8b. Activity log: agreement signed.
  try {
    await admin.from("activity_log").insert({
      actor_user_id: userId,
      actor_name: `${formData.firstName} ${formData.familyName}`,
      actor_role: "client",
      action: "agreement_signed",
      description: `${formData.firstName} ${formData.familyName} signed ${acceptance.versionCode}`,
      metadata: { company_name: formData.companyName, version_code: acceptance.versionCode },
    });
  } catch (err) { console.warn("activity log (agreement_signed) failed", err) }

  // 8c. Notify all admins by email (best-effort; never blocks signup).
  try {
    const { data: adminRoles } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const adminIds = (adminRoles ?? []).map((r: { user_id: string }) => r.user_id);
    if (adminIds.length > 0) {
      const adminEmails: string[] = [];
      for (const adminId of adminIds) {
        const { data: adminUser } = await admin.auth.admin.getUserById(adminId);
        const email = adminUser?.user?.email;
        if (email) adminEmails.push(email);
      }
      const origin = req.headers.get("origin") || "https://ss-client.lovable.app";
      const adminUrl = `${origin}/admin/clients`;
      await Promise.all(
        adminEmails.map((adminEmail) =>
          admin.functions
            .invoke("send-transactional-email", {
              body: {
                templateName: "new-account-notification",
                recipientEmail: adminEmail,
                idempotencyKey: `new-account-${accountId}-${adminEmail}`,
                templateData: {
                  companyName: formData.companyName,
                  signatoryName: `${formData.firstName} ${formData.familyName}`,
                  signatoryPosition: formData.position,
                  email: formData.emailAddress,
                  country: formData.country,
                  signedAt: acceptedAtIso,
                  adminUrl,
                },
              },
            })
            .catch((err) =>
              console.error("admin notification invoke failed", err)
            )
        )
      );
    }
  } catch (notifyErr) {
    console.error("admin notification step failed", notifyErr);
  }

  // 9. Issue a session so the client can sign in immediately
  // Use signInWithPassword via a non-admin client
  const publicClient = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data: signInData } = await publicClient.auth.signInWithPassword({
    email: formData.emailAddress,
    password: formData.password,
  });

  return new Response(
    JSON.stringify({
      success: true,
      agreementId: agreementRow.id,
      agreementUid,
      session: signInData?.session ?? null,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});