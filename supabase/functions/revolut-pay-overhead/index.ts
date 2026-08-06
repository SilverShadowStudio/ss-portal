// revolut-pay-overhead/index.ts
//
// Admin-only. Pays ONE recorded overhead by transferring its gross amount from
// the studio's Revolut Business account to the supplier, then marks the row
// paid. This is the only place in the portal that moves money OUT.
//
// Called from the Pay action on a Money Out row (AdminPnL). The row is already
// filed to Dropbox and recorded by then — this settles it.
//
// Input:  { overhead_id, confirm_gross }   confirm_gross must equal the row's
//         gross to the penny; a mismatch aborts. It exists so a stale UI can
//         never authorise an amount the admin didn't actually see.
// Output: { success, transaction_id, state } | { success: false, error }
//
// Deploy: npx supabase functions deploy revolut-pay-overhead \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt
//
// REQUIRES the Revolut Business API app to hold the `pay` scope. The existing
// read-only credentials (used by revolut-balances) will 403 on /pay until that
// scope is granted — the function reports that verbatim rather than guessing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const B2B = "https://b2b.revolut.com/api/1.0";
const STALE_LOCK_MS = 5 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: Record<string, unknown>, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── Revolut Business auth (mirrors revolut-balances) ─────────────────────────

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

async function importKey(b64pem: string): Promise<CryptoKey> {
  const pem = new TextDecoder().decode(Uint8Array.from(atob(b64pem), (c) => c.charCodeAt(0)));
  const body = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

async function clientAssertion(clientId: string, iss: string, key: CryptoKey): Promise<string> {
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlStr(JSON.stringify({
    iss, sub: clientId, aud: "https://revolut.com", exp: Math.floor(Date.now() / 1000) + 600,
  }));
  const sig = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`),
  ));
  return `${header}.${payload}.${b64url(sig)}`;
}

async function accessToken(): Promise<string> {
  // Same four secrets revolut-balances and revolut-sync already run on.
  const clientId = Deno.env.get("REVOLUT_CLIENT_ID");
  const refresh = Deno.env.get("REVOLUT_REFRESH_TOKEN");
  const keyB64 = Deno.env.get("REVOLUT_PRIVATE_KEY_B64");
  const issuer = Deno.env.get("REVOLUT_ISS") || "oauth.pstmn.io";
  if (!clientId || !refresh || !keyB64) {
    throw new Error("Revolut Business credentials are not configured");
  }
  const assertion = await clientAssertion(clientId, issuer, await importKey(keyB64));
  const body = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: refresh, client_id: clientId,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  });
  const r = await fetch(`${B2B}/auth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) throw new Error(`Revolut token refresh ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).access_token;
}

async function revolut(token: string, path: string, init?: RequestInit): Promise<Response> {
  return await fetch(`${B2B}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

/** Turn a Revolut error body into something Fred can act on. */
async function revolutError(res: Response, what: string): Promise<string> {
  const text = (await res.text()).slice(0, 400);
  if (res.status === 401 || res.status === 403) {
    return `Revolut refused ${what} (${res.status}). The API app most likely lacks the "pay" scope — ` +
      `it is currently read-only. Grant it in the Revolut Business developer settings, then retry. (${text})`;
  }
  return `Revolut ${what} failed (${res.status}): ${text}`;
}

// ── Counterparty resolution ──────────────────────────────────────────────────

interface BankRow {
  supplier_normalized: string;
  supplier_name: string;
  iban: string | null;
  account_number: string | null;
  sort_code: string | null;
  bic: string | null;
  country: string | null;
  revolut_counterparty_id: string | null;
  revolut_account_id: string | null;
}

// EXACT port of src/lib/supplierNormalize.ts — the key written here has to
// equal the one the frontend writes for supplier_category_map, or the same
// supplier ends up under two keys. Change both together.
const COMPANY_SUFFIX_RE = /\b(limited|ltd|inc|llc|plc|corporation|corp)\b\.?/gi;
const PARENTHETICAL_RE = /\s*\([^)]*\)\s*/g;

function normalizeSupplier(name: string): string {
  if (!name) return "";
  return name
    .replace(PARENTHETICAL_RE, " ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(COMPANY_SUFFIX_RE, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find or create the Revolut counterparty for this supplier and return its
 * (counterparty_id, account_id) pair. Creation is only attempted when we hold
 * real bank details — never invented, never guessed.
 */
async function resolveCounterparty(
  token: string,
  bank: BankRow,
): Promise<{ counterpartyId: string; accountId: string | null }> {
  if (bank.revolut_counterparty_id) {
    return { counterpartyId: bank.revolut_counterparty_id, accountId: bank.revolut_account_id };
  }

  const hasUkAccount = !!(bank.sort_code && bank.account_number);
  const hasIban = !!bank.iban;
  if (!hasUkAccount && !hasIban) {
    throw new Error(
      `No bank details on file for ${bank.supplier_name}. Add them on the invoice row before paying — ` +
      `nothing was sent.`,
    );
  }

  const payload: Record<string, unknown> = hasUkAccount
    ? {
        company_name: bank.supplier_name,
        bank_country: bank.country || "GB",
        currency: "GBP",
        account_no: bank.account_number,
        sort_code: bank.sort_code,
      }
    : {
        company_name: bank.supplier_name,
        bank_country: bank.country || "GB",
        currency: "GBP",
        iban: bank.iban,
        ...(bank.bic ? { bic: bank.bic } : {}),
      };

  const res = await revolut(token, "/counterparty", { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await revolutError(res, "counterparty creation"));

  const cp = await res.json();
  const accountId: string | null = cp?.accounts?.[0]?.id ?? null;
  return { counterpartyId: cp.id as string, accountId };
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ── Admin only. Money leaves the account here; no cron, no service caller. ─
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ success: false, error: "Unauthorized" }, 401);
  const uc = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u } = await uc.auth.getUser();
  if (!u?.user) return json({ success: false, error: "Unauthorized" }, 401);
  const { data: role } = await sb.from("user_roles")
    .select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  if (!role) return json({ success: false, error: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const overheadId = String(body.overhead_id ?? "");
  const confirmGross = Number(body.confirm_gross);
  if (!overheadId) return json({ success: false, error: "overhead_id required" }, 400);
  if (!Number.isFinite(confirmGross)) return json({ success: false, error: "confirm_gross required" }, 400);

  // ── Load the row ─────────────────────────────────────────────────────────
  const { data: row, error: rowErr } = await sb.from("overheads")
    .select("id, supplier_name, invoice_number, gross_amount, currency, payment_status, payment_date, " +
            "payment_reference, supplier_iban, supplier_account_number, supplier_sort_code, supplier_bic")
    .eq("id", overheadId).maybeSingle();
  if (rowErr || !row) return json({ success: false, error: "Invoice not found" }, 404);
  if (row.payment_status === "paid") {
    return json({ success: false, error: "This invoice is already marked paid." }, 409);
  }

  const gross = Number(row.gross_amount) || 0;
  if (gross <= 0) return json({ success: false, error: "This invoice has no amount to pay." }, 400);
  // The admin authorised a specific figure. If the row has since changed,
  // stop — re-open it and look again rather than sending a different amount.
  if (Math.abs(gross - confirmGross) > 0.005) {
    return json({
      success: false,
      error: `The amount changed since you opened this (now ${gross.toFixed(2)}). Nothing was sent — reopen and check.`,
    }, 409);
  }
  const currency = (row.currency || "GBP").toUpperCase();
  if (currency !== "GBP") {
    return json({
      success: false,
      error: `Only GBP transfers are supported for now — this invoice is in ${currency}. Pay it in Revolut directly.`,
    }, 400);
  }

  // ── Claim the payment lock atomically ────────────────────────────────────
  // Two clicks, two tabs, or a retry after a timeout must never send twice.
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString();
  const { data: locked, error: lockErr } = await sb.from("overheads")
    .update({ payment_in_progress: true, payment_started_at: new Date().toISOString() })
    .eq("id", overheadId)
    .neq("payment_status", "paid")
    .or(`payment_in_progress.eq.false,payment_started_at.lt.${staleCutoff}`)
    .select("id").maybeSingle();
  if (lockErr) return json({ success: false, error: `Could not lock the invoice: ${lockErr.message}` }, 500);
  if (!locked) {
    return json({ success: false, error: "A payment for this invoice is already in flight." }, 409);
  }

  const release = async (fields: Record<string, unknown>) => {
    await sb.from("overheads")
      .update({ payment_in_progress: false, payment_started_at: null, ...fields })
      .eq("id", overheadId);
  };

  try {
    const token = await accessToken();

    // ── Supplier bank details: remembered first, invoice second ────────────
    const key = normalizeSupplier(row.supplier_name);
    const { data: remembered } = await sb.from("supplier_bank_details")
      .select("*").eq("supplier_normalized", key).maybeSingle();

    const bank: BankRow = {
      supplier_normalized: key,
      supplier_name: row.supplier_name,
      iban: remembered?.iban ?? row.supplier_iban ?? null,
      account_number: remembered?.account_number ?? row.supplier_account_number ?? null,
      sort_code: remembered?.sort_code ?? row.supplier_sort_code ?? null,
      bic: remembered?.bic ?? row.supplier_bic ?? null,
      country: remembered?.country ?? null,
      revolut_counterparty_id: remembered?.revolut_counterparty_id ?? null,
      revolut_account_id: remembered?.revolut_account_id ?? null,
    };

    const { counterpartyId, accountId } = await resolveCounterparty(token, bank);

    // Remember the counterparty (and the details behind it) so the next
    // invoice from this supplier is a single click.
    await sb.from("supplier_bank_details").upsert({
      supplier_normalized: key,
      supplier_name: row.supplier_name,
      iban: bank.iban,
      account_number: bank.account_number,
      sort_code: bank.sort_code,
      bic: bank.bic,
      country: bank.country,
      currency: "GBP",
      revolut_counterparty_id: counterpartyId,
      revolut_account_id: accountId,
      updated_by: u.user.id,
      updated_at: new Date().toISOString(),
    });

    // ── Which pocket to pay from ──────────────────────────────────────────
    const accountsRes = await revolut(token, "/accounts");
    if (!accountsRes.ok) throw new Error(await revolutError(accountsRes, "account lookup"));
    const accounts = await accountsRes.json();
    const gbp = (accounts as Array<Record<string, unknown>>).find(
      (a) => String(a.currency).toUpperCase() === "GBP" && a.state === "active",
    );
    if (!gbp) throw new Error("No active GBP pocket found in Revolut.");
    const balance = Number(gbp.balance) || 0;
    if (balance < gross) {
      throw new Error(
        `Not enough in the GBP pocket — balance ${balance.toFixed(2)}, this invoice is ${gross.toFixed(2)}. Nothing was sent.`,
      );
    }

    // ── Send ───────────────────────────────────────────────────────────────
    // request_id is the overhead id: Revolut itself then rejects a second
    // submission for the same invoice, whatever happens on our side.
    const reference = (row.payment_reference || row.invoice_number || `Invoice ${overheadId.slice(0, 8)}`)
      .toString().slice(0, 100);
    const payRes = await revolut(token, "/pay", {
      method: "POST",
      body: JSON.stringify({
        request_id: overheadId,
        account_id: gbp.id,
        receiver: { counterparty_id: counterpartyId, ...(accountId ? { account_id: accountId } : {}) },
        amount: Number(gross.toFixed(2)),
        currency: "GBP",
        reference,
      }),
    });
    if (!payRes.ok) throw new Error(await revolutError(payRes, "the transfer"));

    const pay = await payRes.json();
    const transactionId = String(pay.id ?? "");
    const state = String(pay.state ?? "pending");

    await release({
      payment_status: "paid",
      payment_date: new Date().toISOString().slice(0, 10),
      paid_via: "revolut",
      revolut_transaction_id: transactionId || null,
      payment_reference: reference,
      payment_error: null,
    });

    return json({ success: true, transaction_id: transactionId, state, amount: gross, reference });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Release the lock but keep the row UNPAID — a failure here means no money
    // moved, and the reason is recorded on the row for the UI to show.
    await release({ payment_error: message });
    return json({ success: false, error: message }, 502);
  }
});
