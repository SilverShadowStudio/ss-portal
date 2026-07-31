// revolut-payment-link
//
// Returns a Revolut Merchant hosted payment link for an invoice, creating the
// order on first use and caching it on the row. Replaces create-invoice-checkout
// (Stripe). Auth: any signed-in user — the invoice is read under the caller's
// RLS, so they can only mint links for invoices they're allowed to see (admins
// and the owning client both qualify). The Merchant order + cache write use the
// service role (RLS blocks client UPDATE on quotation-linked invoices).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ensurePaymentLink } from "../_shared/revolutMerchant.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const invoiceId = body?.invoice_id;
    if (!invoiceId || typeof invoiceId !== "string") return json({ error: "invoice_id required" }, 400);

    // Read under the caller's RLS — they may only link invoices they can see.
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("id, invoice_number, reference_number, amount, currency, status, revolut_order_id, revolut_checkout_url")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr || !invoice) return json({ error: "Invoice not found" }, 404);
    if (invoice.status === "paid") return json({ error: "Invoice already paid" }, 400);

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) return json({ error: "Service role not configured" }, 500);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const link = await ensurePaymentLink(admin, invoice);
    return json({ url: link.checkout_url, order_id: link.order_id, cached: link.cached });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
