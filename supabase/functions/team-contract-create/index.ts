// Edge function: team-contract-create
// Admin-gated. Creates a DRAFT team_contracts row from the admin-entered
// engagement-contract form. Per the Path 1 design, account_id and profile_id
// are left NULL at draft time — the freelancer_profiles row + team account +
// invite are created atomically later, by "Send to portal for signature"
// (team-contract-accept / send flow), when the auth user actually exists.
//
// No PDF generation and no account/profile creation happen here.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type EntityType = "individual" | "company";

interface CreateBody {
  entity_type: EntityType;
  recipient_email?: string | null;

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

  subject_line?: string | null;
  scope_description?: string | null;
  project_reference?: string | null;
  delivery_window_start?: string | null;
  delivery_window_end?: string | null;
  round_1_deadline?: string | null;
  round_2_deadline?: string | null;

  fee_amount?: number | null;
  fee_currency?: string | null;
  fee_scope_description?: string | null;
  payment_milestone_1_pct?: number | null;
  payment_milestone_2_pct?: number | null;
  payment_milestone_3_pct?: number | null;
}

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Verify the caller is an admin.
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const body = (await req.json().catch(() => ({}))) as CreateBody;

    // ── Validation ──────────────────────────────────────────────────────────
    const entityType = body.entity_type;
    if (entityType !== "individual" && entityType !== "company") {
      return json({ error: "entity_type must be 'individual' or 'company'" }, 400);
    }
    const subjectLine = str(body.subject_line);
    const scopeDescription = str(body.scope_description);
    if (!subjectLine) return json({ error: "subject_line is required" }, 400);
    if (!scopeDescription) return json({ error: "scope_description is required" }, 400);

    const recipientEmail = str(body.recipient_email);
    if (!recipientEmail) return json({ error: "Recipient email is required" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return json({ error: "Recipient email is not a valid email address" }, 400);
    }

    const feeAmount = typeof body.fee_amount === "number" && !Number.isNaN(body.fee_amount)
      ? body.fee_amount : null;
    if (feeAmount === null || feeAmount < 0) return json({ error: "fee_amount is required" }, 400);

    if (entityType === "individual") {
      if (!str(body.individual_full_name)) return json({ error: "Full name is required" }, 400);
      if (!str(body.individual_address)) return json({ error: "Address is required" }, 400);
    } else {
      for (const [k, label] of [
        ["company_name", "Company name"],
        ["company_registered_office", "Registered office"],
        ["company_jurisdiction", "Jurisdiction"],
        ["company_registration_number", "Registration number"],
        ["company_director_name", "Director name"],
      ] as const) {
        if (!str(body[k])) return json({ error: `${label} is required` }, 400);
      }
    }

    // Milestones must sum to 100.
    const m1 = body.payment_milestone_1_pct ?? 10;
    const m2 = body.payment_milestone_2_pct ?? 40;
    const m3 = body.payment_milestone_3_pct ?? 50;
    if (m1 + m2 + m3 !== 100) {
      return json({ error: "Payment milestones must sum to 100%" }, 400);
    }

    // ── Insert draft (account_id / profile_id intentionally NULL) ─────────────
    const { data: contract, error: insErr } = await admin
      .from("team_contracts")
      .insert({
        account_id: null,
        profile_id: null,
        recipient_email: recipientEmail,
        entity_type: entityType,

        individual_full_name: str(body.individual_full_name),
        individual_address: str(body.individual_address),
        individual_nationality: str(body.individual_nationality),
        individual_ni_number: str(body.individual_ni_number),

        company_name: str(body.company_name),
        company_registered_office: str(body.company_registered_office),
        company_jurisdiction: str(body.company_jurisdiction),
        company_registration_number: str(body.company_registration_number),
        company_vat_number: str(body.company_vat_number),
        company_director_name: str(body.company_director_name),
        company_director_title: str(body.company_director_title) ?? "Director",

        subject_line: subjectLine,
        scope_description: scopeDescription,
        project_reference: str(body.project_reference),
        delivery_window_start: str(body.delivery_window_start),
        delivery_window_end: str(body.delivery_window_end),
        round_1_deadline: str(body.round_1_deadline),
        round_2_deadline: str(body.round_2_deadline),

        fee_amount: feeAmount,
        fee_currency: str(body.fee_currency) ?? "EUR",
        fee_scope_description: str(body.fee_scope_description),
        payment_milestone_1_pct: m1,
        payment_milestone_2_pct: m2,
        payment_milestone_3_pct: m3,

        status: "draft",
        created_by: user.id,
      })
      .select("id, entity_type, subject_line, status, created_at")
      .single();

    if (insErr) {
      console.error("[team-contract-create] insert failed:", insErr);
      return json({ error: insErr.message }, 500);
    }

    return json({ contract });
  } catch (err) {
    console.error("[team-contract-create] unexpected:", err);
    return json({ error: (err as Error)?.message ?? "Unexpected error" }, 500);
  }
});
