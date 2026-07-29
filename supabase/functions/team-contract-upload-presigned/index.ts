// Edge function: team-contract-upload-presigned
// Admin-gated. Records a pre-existing paper/PDF contract for a team member:
//   1. Admin gate
//   2. Parse + validate multipart/form-data (PDF + metadata)
//   3. Provision team member — find/create auth user, account, membership, profile
//   4. Create team_contracts row (status='signed', is_pre_signed=true)
//   5. Upload PDF to freelancer-documents bucket
//   6. Write storage_path back to the contract row
//   7. Send standard portal invite email so the member can log in (non-fatal)
//   8. Log team_contract_uploaded activity
//
// Accepted form fields:
//   email         (required) — member email
//   name          (required) — member full name
//   signed_by_name (required) — name of the physical signatory on the paper
//   signing_date  (required) — ISO date YYYY-MM-DD when the paper was signed
//   subject_line  (optional) — contract title (default: "Pre-signed engagement contract")
//   pdf           (required) — File, application/pdf, max 10MB

import { createClient } from "npm:@supabase/supabase-js@2";
import { provisionTeamMember, splitName } from "../_shared/teamProvisioning.ts";
import { buildInviteEmailHtml, EMAIL_INVITE_DEFAULTS } from "../_shared/emailTemplates.ts";

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://portal.silvershadowstudio.com";
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
// Signed team agreements are filed into the studio's Agreements tree, in a
// per-member numbered folder matching the existing convention:
//   .../01_Agreements/AGR002_Employees/EMP{NNN}_{First-Last}/{file}
//   .../01_Agreements/AGR003_Freelancers/FREE{NNN}_{First-Last}/{file}
// File itself: {First-Last}_Agreement-{Employment|Freelance}_{YYYY-MM-DD}_SIGNED.pdf
const DROPBOX_AGREEMENTS_ROOT = "/03_Portal_Admin_Docs/01_Agreements";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function buildPortalVerifyUrl(properties: Record<string, unknown> | undefined, fallback: string): string {
  const token = (properties?.hashed_token as string | undefined) ?? "";
  const type = (properties?.verification_type as string | undefined) ?? "";
  const redirectTo = (properties?.redirect_to as string | undefined) ?? "";
  if (!token || !type) return fallback;
  const params = new URLSearchParams({ token, type });
  if (redirectTo) params.set("redirect_to", redirectTo);
  return `${APP_BASE_URL}/auth/verify?${params.toString()}`;
}

// ── Dropbox (mirror dropbox-save-invoice-file / freelancer-self-bill-run) ────
async function refreshToken(conn: Record<string, string>, sb: ReturnType<typeof createClient>): Promise<string | null> {
  try {
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${Deno.env.get("DROPBOX_APP_KEY")}:${Deno.env.get("DROPBOX_APP_SECRET")}`)}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;
    await sb.from("dropbox_connections").update({ access_token: data.access_token, token_expires_at: expiresAt }).eq("id", conn.id);
    return data.access_token;
  } catch { return null; }
}
async function rootNamespace(token: string): Promise<string | null> {
  const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null; return (await r.json())?.root_info?.root_namespace_id ?? null;
}
async function dropboxUpload(token: string, ns: string | null, path: string, bytes: Uint8Array): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const r = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({ path, mode: "add", autorename: true, mute: true }),
      ...(ns ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "namespace_id", namespace_id: ns }) } : {}),
    },
    body: bytes,
  });
  if (!r.ok) return { ok: false, error: `dropbox ${r.status}: ${await r.text()}` };
  return { ok: true, path: (await r.json()).path_display ?? path };
}
function sanitize(s: string): string { return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[/\\:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "Member"; }

/** List the immediate subfolder names of a Dropbox path (empty if it doesn't exist). */
async function dropboxListFolders(token: string, ns: string | null, path: string): Promise<string[]> {
  const headers = {
    Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    ...(ns ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "namespace_id", namespace_id: ns }) } : {}),
  };
  const names: string[] = [];
  try {
    let r = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST", headers, body: JSON.stringify({ path, recursive: false, limit: 2000 }),
    });
    if (!r.ok) return names; // folder may not exist yet
    let data = await r.json();
    const collect = (d: { entries?: { ".tag": string; name: string }[] }) => {
      for (const e of d.entries ?? []) if (e[".tag"] === "folder") names.push(e.name);
    };
    collect(data);
    while (data.has_more) {
      r = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
        method: "POST", headers, body: JSON.stringify({ cursor: data.cursor }),
      });
      if (!r.ok) break;
      data = await r.json();
      collect(data);
    }
  } catch { /* best-effort */ }
  return names;
}

// File a signed agreement PDF to Dropbox. Non-fatal — a Dropbox hiccup must not
// fail the upload (the file already lives in Supabase storage).
async function fileContractToDropbox(
  admin: ReturnType<typeof createClient>,
  pdfBytes: Uint8Array,
  opts: { name: string; employmentType: string; signingDate: string },
): Promise<{ path: string } | { error: string }> {
  const { data: conn } = await admin.from("dropbox_connections")
    .select("id, access_token, refresh_token, token_expires_at")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn) return { error: "no dropbox connection" };
  let token = conn.access_token as string;
  if (conn.token_expires_at && new Date(conn.token_expires_at as string).getTime() < Date.now()) {
    token = (await refreshToken(conn as Record<string, string>, admin)) ?? "";
  }
  if (!token) return { error: "dropbox token unavailable" };
  const ns = await rootNamespace(token);

  const isEmp = opts.employmentType === "employee";
  const category = isEmp ? "AGR002_Employees" : "AGR003_Freelancers";
  const prefix = isEmp ? "EMP" : "FREE";
  const typeLabel = isEmp ? "Employment" : "Freelance";
  const nameSlug = sanitize(opts.name); // e.g. "Kieran-Tait"
  const categoryPath = `${DROPBOX_AGREEMENTS_ROOT}/${category}`;

  // Reuse this member's existing numbered folder if present, else mint the next
  // number (EMP003_… / FREE004_…) from the highest already filed.
  const folders = await dropboxListFolders(token, ns, categoryPath);
  const re = new RegExp(`^${prefix}(\\d+)_(.+)$`, "i");
  let memberFolder: string | null = null;
  let maxNum = 0;
  for (const f of folders) {
    const m = f.match(re);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n > maxNum) maxNum = n;
    if (m[2].toLowerCase() === nameSlug.toLowerCase()) memberFolder = f; // same person → reuse
  }
  if (!memberFolder) memberFolder = `${prefix}${String(maxNum + 1).padStart(3, "0")}_${nameSlug}`;

  const filename = `${nameSlug}_Agreement-${typeLabel}_${opts.signingDate}_SIGNED.pdf`;
  // Dropbox auto-creates the member folder on upload.
  const up = await dropboxUpload(token, ns, `${categoryPath}/${memberFolder}/${filename}`, pdfBytes);
  return up.ok ? { path: up.path } : { error: up.error };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── Admin gate ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);
  const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!roleRow) return json({ error: "Forbidden" }, 403);

  // ── Parse multipart form ────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ error: "Expected multipart/form-data" }, 400);
  }

  const email = (formData.get("email") as string | null)?.trim().toLowerCase();
  const name = (formData.get("name") as string | null)?.trim();
  const signedByName = (formData.get("signed_by_name") as string | null)?.trim();
  const signingDate = (formData.get("signing_date") as string | null)?.trim();
  const subjectLine = (formData.get("subject_line") as string | null)?.trim() || "Pre-signed engagement contract";
  const employmentType = ((formData.get("employment_type") as string | null)?.trim() || "freelancer") === "employee" ? "employee" : "freelancer";
  const position = (formData.get("position") as string | null)?.trim() || null;
  const grossSalaryRaw = (formData.get("gross_salary_annual") as string | null)?.trim();
  const grossSalaryAnnual = grossSalaryRaw ? Number(grossSalaryRaw) : null;
  const pdfFile = formData.get("pdf") as File | null;

  // Required field validation
  if (!email) return json({ error: "email is required" }, 400);
  if (!name) return json({ error: "name is required" }, 400);
  if (!signedByName) return json({ error: "signed_by_name is required" }, 400);
  if (!signingDate) return json({ error: "signing_date is required" }, 400);
  if (!pdfFile) return json({ error: "pdf file is required" }, 400);

  // Date validation
  const signedAt = new Date(signingDate);
  if (isNaN(signedAt.getTime())) return json({ error: "signing_date must be a valid date (YYYY-MM-DD)" }, 400);

  // PDF validation
  if (pdfFile.type !== "application/pdf") return json({ error: "File must be a PDF (application/pdf)" }, 400);
  if (pdfFile.size > MAX_PDF_BYTES) return json({ error: "PDF must be 10 MB or smaller" }, 400);

  const { first } = splitName(name);

  // ── Provision team member ───────────────────────────────────────────────────
  let userId: string;
  let accountId: string;
  let profileId: string;
  try {
    const provisioned = await provisionTeamMember(admin, {
      email,
      partyName: name,
      companyLabel: name,
      invitedBy: user.id,
    });
    userId = provisioned.userId;
    accountId = provisioned.accountId;
    profileId = provisioned.profileId;
  } catch (e) {
    console.error("[team-contract-upload-presigned] provisioning failed:", e);
    return json({ error: (e as Error)?.message ?? "Provisioning failed" }, 500);
  }

  // ── Persist employment classification on the account ────────────────────────
  // Freelancer = paid per Airtable self-bills; Employee = fixed salary (payroll),
  // which feeds Debts → Salaries. Non-fatal: capture failure shouldn't block the
  // contract upload.
  await admin.from("accounts").update({
    team_role: position ?? undefined,
    employment_type: employmentType,
    position: employmentType === "employee" ? position : null,
    gross_salary_annual: employmentType === "employee" ? grossSalaryAnnual : null,
    salary_start_date: employmentType === "employee" ? signingDate : null,
  }).eq("id", accountId).then(() => {}, (e) => console.error("[team-contract-upload-presigned] account employment update failed:", e));

  // Pre-signed members skip signing but still proofread their details at
  // onboarding — mark the profile unconfirmed so the portal shows that step.
  await admin.from("freelancer_profiles")
    .update({ onboarding_confirmed: false })
    .eq("id", profileId)
    .then(() => {}, (e) => console.error("[team-contract-upload-presigned] onboarding flag update failed:", e));

  // ── Create signed contract row (storage_path filled after upload) ───────────
  const { data: contractRow, error: insertErr } = await admin
    .from("team_contracts")
    .insert({
      account_id: accountId,
      profile_id: profileId,
      entity_type: "individual",
      individual_full_name: name,
      recipient_email: email,
      subject_line: subjectLine,
      scope_description: "See attached signed contract document.",
      fee_amount: 0,
      fee_currency: "GBP",
      status: "signed",
      is_pre_signed: true,
      signed_at: signedAt.toISOString(),
      signed_by_name: signedByName,
      signed_by_user_id: userId,
      created_by: user.id,
    } as Record<string, unknown>)
    .select("id")
    .single();

  if (insertErr || !contractRow) {
    console.error("[team-contract-upload-presigned] contract insert failed:", insertErr);
    return json({ error: insertErr?.message ?? "Failed to create contract record" }, 500);
  }

  const contractId = contractRow.id as string;

  // ── Upload PDF ──────────────────────────────────────────────────────────────
  const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());
  const storagePath = `${userId}/team-contracts/${contractId}-presigned.pdf`;

  const { error: upErr } = await admin.storage
    .from("freelancer-documents")
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

  if (upErr) {
    console.error("[team-contract-upload-presigned] upload failed:", upErr);
    // Contract row exists but has no storage_path — mark it cancelled so it
    // doesn't appear as a phantom signed record without a file.
    await admin.from("team_contracts").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", contractId).then(() => {}, () => {});
    return json({ error: "Failed to upload PDF — please try again" }, 500);
  }

  // Write storage_path back to contract row
  await admin.from("team_contracts").update({
    storage_path: storagePath,
    updated_at: new Date().toISOString(),
  }).eq("id", contractId);

  // ── File to Dropbox (non-fatal) ─────────────────────────────────────────────
  let dropboxPath: string | null = null;
  try {
    const filed = await fileContractToDropbox(admin, pdfBytes, { name, employmentType, signingDate });
    if ("path" in filed) {
      dropboxPath = filed.path;
      await admin.from("team_contracts").update({ dropbox_path: dropboxPath, updated_at: new Date().toISOString() })
        .eq("id", contractId).then(() => {}, () => {}); // column may not exist yet — ignore
    } else {
      console.error("[team-contract-upload-presigned] dropbox filing skipped:", filed.error);
    }
  } catch (e) {
    console.error("[team-contract-upload-presigned] dropbox filing error:", e);
  }

  // ── Activity log ────────────────────────────────────────────────────────────
  await admin.from("activity_log").insert({
    actor_user_id: user.id,
    actor_role: "admin",
    action: "team_contract_uploaded",
    description: `Pre-signed contract uploaded for ${name}`,
    entity_type: "team_contract",
    entity_id: contractId,
    metadata: { recipient_email: email, signed_by_name: signedByName, employment_type: employmentType, dropbox_path: dropboxPath },
  }).then(() => {}, () => {});

  // ── Portal invite email (non-fatal) ─────────────────────────────────────────
  // Member still needs portal access — send the standard invite email.
  let emailSent = false;
  try {
    const { data: settingsRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "email_invite_config")
      .maybeSingle();
    const emailConfig = (settingsRow?.value as Record<string, unknown> | null) ?? {};

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: APP_BASE_URL },
    });
    let ctaUrl = APP_BASE_URL;
    if (!linkErr && linkData?.properties) {
      ctaUrl = buildPortalVerifyUrl(linkData.properties as Record<string, unknown>, (linkData.properties.action_link as string) ?? ctaUrl);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const html = buildInviteEmailHtml(name, ctaUrl, {
        ...EMAIL_INVITE_DEFAULTS,
        ...emailConfig,
        ctaUrl: undefined,
        firstName: first,
      });
      const subject = (emailConfig.subject as string | undefined) ?? EMAIL_INVITE_DEFAULTS.subject ?? "Your Silver Shadow Studio portal is ready.";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Silver Shadow Studio <portal@silvershadowstudio.com>",
          to: [email],
          subject,
          html,
          headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
          tags: [{ name: "category", value: "team-invite" }],
        }),
      });
      emailSent = res.ok;
      if (!res.ok) console.error("[team-contract-upload-presigned] Resend error:", await res.text());
    }
  } catch (e) {
    console.error("[team-contract-upload-presigned] invite email failed:", e);
  }

  return json({ success: true, contract_id: contractId, storage_path: storagePath, dropbox_path: dropboxPath, emailSent });
});
