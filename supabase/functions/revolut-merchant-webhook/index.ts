// revolut-merchant-webhook
//
// Marks an invoice paid when its Revolut Merchant order completes — the reliable
// settlement signal (the bank feed reconciler is a separate ledger view). This
// replaces stripe-webhook. Public endpoint: no JWT, so it verifies Revolut's
// HMAC signature in-handler against REVOLUT_MERCHANT_WEBHOOK_SECRET.
//
// Deploy with --no-verify-jwt. Register at Revolut Merchant → Webhooks with
// event ORDER_COMPLETED pointing at this function's URL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyMerchantWebhook } from "../_shared/revolutMerchant.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("REVOLUT_MERCHANT_WEBHOOK_SECRET");
  if (!secret) {
    // Fail closed: without the signing secret we cannot trust the caller, and
    // this endpoint mutates invoice payment status.
    console.error("[merchant-webhook] REVOLUT_MERCHANT_WEBHOOK_SECRET unset — rejecting");
    return json({ error: "Webhook not configured" }, 503);
  }

  const raw = await req.text();
  const ok = await verifyMerchantWebhook(
    raw,
    req.headers.get("Revolut-Signature"),
    req.headers.get("Revolut-Request-Timestamp"),
    secret,
  );
  if (!ok) {
    console.warn("[merchant-webhook] signature verification failed");
    return json({ error: "Invalid signature" }, 401);
  }

  let payload: { event?: string; order_id?: string; merchant_order_ext_ref?: string };
  try { payload = JSON.parse(raw); } catch { return json({ error: "Bad JSON" }, 400); }

  // Only completed payments flip an invoice to paid.
  if (payload.event !== "ORDER_COMPLETED") {
    return json({ ignored: payload.event ?? "unknown" });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Match by order id first (canonical), external ref (invoice number) as fallback.
  let q = admin.from("invoices").select("id, status").limit(1);
  q = payload.order_id
    ? q.eq("revolut_order_id", payload.order_id)
    : q.eq("invoice_number", payload.merchant_order_ext_ref ?? "__none__");
  const { data: inv } = await q.maybeSingle();

  if (!inv) {
    console.warn("[merchant-webhook] no invoice for order", payload.order_id, payload.merchant_order_ext_ref);
    return json({ matched: false });
  }
  if (inv.status === "paid") return json({ matched: true, alreadyPaid: true });

  const { error } = await admin.from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", inv.id);
  if (error) return json({ error: error.message }, 500);

  console.info("[merchant-webhook] invoice marked paid", inv.id, payload.order_id);
  return json({ matched: true, paid: true });
});
