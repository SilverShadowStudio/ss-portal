// preview-team-contract-pdf
// Admin-gated. Takes { contract_id }, loads the team_contracts draft row,
// generates the engagement-contract PDF (with a DRAFT watermark while unsigned)
// and returns it as a binary download. No DB writes — this is the admin
// "Generate and download PDF" path. The signed copy is produced separately by
// the Send-to-portal / accept flow (Commit 5).

import { createClient } from "npm:@supabase/supabase-js@2";
import { loadDesignConfig } from "../_shared/pdfUtils.ts";
import { generateTeamContractPdf, type TeamContractData } from "../_shared/documents/teamContractPdf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const errJson = (msg: string, status: number) =>
  new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const slug = (s: string) => (s || "contract").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "contract";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errJson("Method not allowed", 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return errJson("Unauthorized", 401);

  // Verify the caller, then verify they are an admin.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return errJson("Unauthorized", 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: roleRow } = await admin
    .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!roleRow) return errJson("Forbidden", 403);

  const body = await req.json().catch(() => ({}));
  const contractId = typeof body?.contract_id === "string" ? body.contract_id : null;
  if (!contractId) return errJson("contract_id is required", 400);

  const { data: contract, error: cErr } = await admin
    .from("team_contracts")
    .select("*")
    .eq("id", contractId)
    .maybeSingle();
  if (cErr) return errJson(cErr.message, 500);
  if (!contract) return errJson("Contract not found", 404);

  const design = await loadDesignConfig(admin);

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = generateTeamContractPdf(contract as TeamContractData, design, {
      watermark: contract.status !== "signed",
    });
  } catch (e) {
    console.error("[preview-team-contract-pdf] generation failed:", e);
    return errJson("Failed to generate contract PDF", 500);
  }

  const party = contract.entity_type === "company" ? contract.company_name : contract.individual_full_name;
  return new Response(pdfBytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Silvershadow_Engagement_${slug(party ?? "")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
});
