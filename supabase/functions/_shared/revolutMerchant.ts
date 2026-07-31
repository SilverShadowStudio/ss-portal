// Revolut Merchant API helper — hosted payment links for invoices.
//
// One place that talks to the Merchant API so the on-demand function
// (revolut-payment-link) and the PDF generator (download-invoice-pdf) mint
// identical links and share the caching rule. Secret key lives in the
// REVOLUT_MERCHANT_SK env var (Vault); never logged.
//
// Docs: POST https://merchant.revolut.com/api/orders  (Revolut-Api-Version header).

const MERCHANT_API = "https://merchant.revolut.com/api";
const API_VERSION = "2024-09-01";

export interface InvoiceForPayment {
  id: string;
  amount: number | string;
  currency: string | null;
  invoice_number: string | null;
  reference_number: string | null;
  status: string | null;
  revolut_order_id?: string | null;
  revolut_checkout_url?: string | null;
}

export interface PaymentLink {
  order_id: string;
  checkout_url: string;
  cached: boolean;
}

interface SupabaseLike {
  from: (t: string) => {
    update: (v: Record<string, unknown>) => { eq: (c: string, val: unknown) => Promise<{ error: unknown }> };
  };
}

/** Minor units (integer) for the Merchant API — round to the penny. */
function minorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Return a live payment link for the invoice, creating a Merchant order on
 * first use and caching order id + checkout url on the row (service-role write).
 * Idempotent: a cached url is returned without hitting the API again.
 */
export async function ensurePaymentLink(admin: SupabaseLike, invoice: InvoiceForPayment): Promise<PaymentLink> {
  if (invoice.revolut_checkout_url && invoice.revolut_order_id) {
    return { order_id: invoice.revolut_order_id, checkout_url: invoice.revolut_checkout_url, cached: true };
  }

  const sk = Deno.env.get("REVOLUT_MERCHANT_SK");
  if (!sk) throw new Error("REVOLUT_MERCHANT_SK not configured");

  const amount = Number(invoice.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invoice amount is not payable");
  const currency = (invoice.currency || "GBP").toUpperCase();
  const ref = invoice.invoice_number || invoice.reference_number || invoice.id;

  const res = await fetch(`${MERCHANT_API}/orders`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${sk}`,
      "Revolut-Api-Version": API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: minorUnits(amount),
      currency,
      description: `Invoice ${ref}`,
      merchant_order_ext_ref: ref,
    }),
  });
  if (!res.ok) {
    throw new Error(`Revolut order create ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const order = await res.json() as { id: string; checkout_url: string };
  if (!order.checkout_url || !order.id) throw new Error("Revolut order returned no checkout_url");

  // Cache on the row (best-effort — the link is valid regardless).
  try {
    await admin.from("invoices")
      .update({ revolut_order_id: order.id, revolut_checkout_url: order.checkout_url })
      .eq("id", invoice.id);
  } catch { /* non-fatal: link still returned to caller */ }

  return { order_id: order.id, checkout_url: order.checkout_url, cached: false };
}

// ── Webhook signature verification ────────────────────────────────────────────
// Revolut Merchant signs the raw body with the per-webhook signing secret
// (wsk_…): payload = `${version}.${timestamp}.${rawBody}`, HMAC-SHA256, hex.
// The Revolut-Signature header may carry several comma-separated `v1=<hex>`.

function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyMerchantWebhook(
  rawBody: string,
  signatureHeader: string | null,
  timestamp: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !timestamp) return false;
  // Reject stale deliveries (>5 min) to blunt replay.
  const ts = Number(timestamp);
  if (Number.isFinite(ts) && Math.abs(Date.now() - ts) > 5 * 60 * 1000) return false;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v1.${timestamp}.${rawBody}`)),
  );
  const expected = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");

  return signatureHeader.split(",").some((part) => {
    const v = part.trim().replace(/^v1=/, "");
    return hexEqual(v.toLowerCase(), expected);
  });
}
