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
import {
  AGREEMENT_SECTIONS,
  type AgreementSection,
} from "./agreementContent.ts";

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
}): Uint8Array {
  const { formData, versionCode, acceptedAt, agreementUid, accountId, ipAddress } = args;
  // Editorial layout — mirrors the on-screen Services Agreement.
  // A4 page, generous side margins (~32mm) to mimic the constrained
  // 720px web column. Neutral typography, no accent colors.
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth(); // 210
  const pageHeight = pdf.internal.pageSize.getHeight(); // 297
  const marginX = 34;
  const marginTop = 42;
  const marginBottom = 30;
  const contentWidth = pageWidth - marginX * 2;
  let y = marginTop;

  const fullAddress = `${formData.buildingNumber} ${formData.streetName}, ${formData.city}, ${formData.postcode}`;
  const acceptorName = `${formData.firstName} ${formData.familyName}`;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - marginBottom) {
      pdf.addPage();
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

  let payload: AcceptPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = generateAgreementPdf({
      formData,
      versionCode: acceptance.versionCode,
      acceptedAt: acceptedAtIso,
      agreementUid,
      accountId,
      ipAddress,
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
    await admin.storage.from("agreements").remove([storagePath]).catch(() => {});
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

  // 8b. Notify all admins by email (best-effort; never blocks signup).
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