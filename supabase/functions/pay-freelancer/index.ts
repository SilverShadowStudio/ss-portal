// pay-freelancer/index.ts
//
// Admin-only. Records a payment against a freelancer's monthly invoice by
// writing to Airtable — and ONLY to the two payment columns of the three
// freelancer invoice tables:
//   • Paid?        (singleSelect: 🔴 NO / 🟢 YES / 🟠 PARTIAL)
//   • Amount Paid  (currency)
// Airtable's "Remaining Balance" formula = IF(Paid?='🟢 YES', 0, Total − Amount
// Paid), so these two fields fully drive the balance, which flows back to the
// portal via payables-sync. We also update the payables_snapshot row directly
// for instant feedback; the scheduled sync reconciles it.
//
// Input: { source_table, airtable_record_id, action: "paid"|"partial"|"unpaid", amount? }
//
// Deploy: npx supabase functions deploy pay-freelancer \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(d: Record<string, unknown>, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

// source_table → invoice table + the TWO writable payment fields.
const SOURCES: Record<string, { invoiceTable: string; paidField: string; amountField: string }> = {
  modeller_invoices:     { invoiceTable: "tbl6WfMgznJYgevRt", paidField: "fldrDa9dzkBfakN2V", amountField: "fldgcIR61IPSAMydd" },
  scene_manager_invoice: { invoiceTable: "tblhYCC3InxUJUK3H", paidField: "fldQDHiDgLLu7rC3M", amountField: "fldzw5jguRXA6cLr7" },
  photographer_invoice:  { invoiceTable: "tblCoQXYZuUCh0Vgc", paidField: "fld2bWNIYOB9SZeos", amountField: "fldXhtsAFgURpmzru" },
};
const PAID_YES = "🟢 YES", PAID_NO = "🔴 NO", PAID_PARTIAL = "🟠 PARTIAL";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Admin only.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const uc = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await uc.auth.getUser();
  if (!u?.user) return json({ error: "Unauthorized" }, 401);
  const { data: role } = await sb.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  if (!role) return json({ error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const source = String(body.source_table ?? "");
  const recordId = String(body.airtable_record_id ?? "");
  const action = String(body.action ?? "");
  const cfg = SOURCES[source];
  if (!cfg || !recordId) return json({ error: "source_table and airtable_record_id required" }, 400);

  const pat = Deno.env.get("AIRTABLE_PAT");
  const baseId = Deno.env.get("AIRTABLE_BASE_ID");
  if (!pat || !baseId) return json({ error: "Airtable not configured" }, 500);

  // Total from the snapshot (source of truth for the invoice amount).
  const { data: snap } = await sb.from("payables_snapshot")
    .select("invoice_total").eq("airtable_record_id", recordId).maybeSingle();
  const total = Number(snap?.invoice_total) || 0;

  // Decide the two field values from the action.
  let paidVal: string, amountPaid: number, statusText: "paid" | "partial" | "unpaid";
  if (action === "paid") {
    paidVal = PAID_YES; amountPaid = total; statusText = "paid";
  } else if (action === "unpaid") {
    paidVal = PAID_NO; amountPaid = 0; statusText = "unpaid";
  } else if (action === "partial") {
    const amt = Math.max(0, Number(body.amount) || 0);
    if (amt <= 0) { paidVal = PAID_NO; amountPaid = 0; statusText = "unpaid"; }
    else if (amt >= total) { paidVal = PAID_YES; amountPaid = total; statusText = "paid"; }
    else { paidVal = PAID_PARTIAL; amountPaid = Math.round(amt * 100) / 100; statusText = "partial"; }
  } else {
    return json({ error: "action must be paid | partial | unpaid" }, 400);
  }

  // Write ONLY the two payment fields to Airtable.
  const patchRes = await fetch(
    `https://api.airtable.com/v0/${baseId}/${cfg.invoiceTable}/${recordId}?returnFieldsByFieldId=true`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { [cfg.paidField]: paidVal, [cfg.amountField]: amountPaid } }),
    },
  );
  if (!patchRes.ok) return json({ error: `Airtable write failed: ${patchRes.status} ${await patchRes.text()}` }, 502);

  // Reflect immediately in the snapshot (the scheduled sync reconciles later).
  const balance = paidVal === PAID_YES ? 0 : Math.max(0, total - amountPaid);
  await sb.from("payables_snapshot")
    .update({ amount_paid: amountPaid, balance_remaining: balance, paid_status: statusText, updated_at: new Date().toISOString() })
    .eq("airtable_record_id", recordId);

  return json({ success: true, paid_status: statusText, amount_paid: amountPaid, balance, total });
});
