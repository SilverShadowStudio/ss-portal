// revolut-sync
//
// Pulls the Revolut Business transaction feed into bank_transactions — the live
// replacement for the manual CSV import. Refreshes its own access token from a
// stored refresh token (client-assertion JWT signed in-function with the Vault
// private key), fetches transactions since the last sync, classifies + converts
// to GBP with the SAME rules as scripts/load-bank-csv.py, and upserts deduped on
// the Revolut transaction id. Read-only Revolut scope.
//
// Auth: cron (X-Cron-Secret) or an admin JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalOrAdmin } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SELF = "SILVERSHADOW STUDIO LIMITED";
const B2B = "https://b2b.revolut.com/api/1.0";

function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(s: string): string { return b64url(new TextEncoder().encode(s)); }

// Import the PKCS8 private key (base64 PEM body) for RS256 signing.
async function importKey(b64pem: string): Promise<CryptoKey> {
  const pem = new TextDecoder().decode(Uint8Array.from(atob(b64pem), (c) => c.charCodeAt(0)));
  const body = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

async function clientAssertion(clientId: string, iss: string, key: CryptoKey): Promise<string> {
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlStr(JSON.stringify({ iss, sub: clientId, aud: "https://revolut.com", exp: Math.floor(Date.now() / 1000) + 600 }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}

async function refreshAccessToken(clientId: string, refreshToken: string, assertion: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion,
  });
  const r = await fetch(`${B2B}/auth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error(`token refresh ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).access_token;
}

// ── Classification (identical rules to load-bank-csv.py) ──────────────────────
function classify(type: string, desc: string, ref: string, sender: string, amount: number): string {
  if (type === "fee") return "bank_fee";
  if (type === "exchange") return "internal_fx";
  if (sender === SELF || desc.includes("Provision") || ref.includes("recover negative balance") || desc.includes("→ Revenue") || desc.startsWith("From British")) return "pocket_move";
  if (ref.includes("Directors Loan") || sender === "COLOMB A") return "directors_loan";
  if (amount > 0) {
    if (sender.toUpperCase().includes("EBAY")) return "ebay_resale";
    if (desc.includes("Refund") || sender.toUpperCase().includes("PAYSEND") || ref.toLowerCase().includes("refund")) return "refund";
    return "client_income";
  }
  return "expense";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireInternalOrAdmin(req, { corsHeaders });
  if (!auth.ok) return auth.response;

  const clientId = Deno.env.get("REVOLUT_CLIENT_ID")!;
  const refreshToken = Deno.env.get("REVOLUT_REFRESH_TOKEN")!;
  const keyB64 = Deno.env.get("REVOLUT_PRIVATE_KEY_B64")!;
  const iss = Deno.env.get("REVOLUT_ISS") || "oauth.pstmn.io";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // 1. Fresh access token.
    const key = await importKey(keyB64);
    const accessToken = await refreshAccessToken(clientId, refreshToken, await clientAssertion(clientId, iss, key));

    // 2. FX rates for foreign→GBP conversion.
    const { data: fxRows } = await sb.from("fx_rates").select("base, rate_date, rate").eq("quote", "GBP").in("base", ["EUR", "USD"]).order("rate_date");
    const fx: Record<string, { d: string[]; r: number[] }> = {};
    for (const x of (fxRows ?? []) as { base: string; rate_date: string; rate: number }[]) {
      (fx[x.base] ??= { d: [], r: [] }).d.push(x.rate_date), fx[x.base].r.push(Number(x.rate));
    }
    const toGbp = (amt: number, cur: string, date: string) => {
      if (cur === "GBP" || !fx[cur]) return amt;
      const { d, r } = fx[cur]; let lo = 0, hi = d.length - 1, ans = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (d[m] <= date) { ans = m; lo = m + 1; } else hi = m - 1; }
      return Math.round(amt * (ans >= 0 ? r[ans] : r[0]) * 100) / 100;
    };

    // 3. Sync window: from the latest completed date we hold, minus 5 days
    //    overlap (dedup handles it), else 400 days back.
    const { data: last } = await sb.from("bank_transactions").select("date_completed").order("date_completed", { ascending: false }).limit(1).maybeSingle();
    const from = new Date(last?.date_completed ? new Date(last.date_completed).getTime() - 5 * 86400000 : Date.now() - 400 * 86400000).toISOString().slice(0, 10);

    // 4. Page through /transactions (newest first; walk back with created_before).
    const recs: Record<string, unknown>[] = [];
    let before: string | undefined;
    for (let page = 0; page < 40; page++) {
      const qs = new URLSearchParams({ from, count: "1000" });
      if (before) qs.set("created_before", before);
      const r = await fetch(`${B2B}/transactions?${qs}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!r.ok) throw new Error(`transactions ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const txns = (await r.json()) as any[];
      if (txns.length === 0) break;
      for (const t of txns) {
        const leg = (t.legs ?? [{}])[0];
        const amount = Number(leg.amount ?? 0);
        const cur = leg.currency ?? "GBP";
        const desc = leg.description ?? t.merchant?.name ?? "";
        const ref = t.reference ?? "";
        const sender = amount > 0 ? (leg.counterparty?.name ?? "") : "";
        const cp = leg.counterparty?.name ?? desc;
        const dateC = (t.completed_at ?? t.created_at ?? "").slice(0, 10) || null;
        recs.push({
          id: t.id, date_started: (t.created_at ?? "").slice(0, 10) || null, date_completed: dateC,
          type: (t.type ?? "").toUpperCase(), state: (t.state ?? "").toUpperCase(),
          description: desc || null, reference: ref || null, counterparty: cp || null,
          orig_currency: cur, orig_amount: amount, amount: toGbp(amount, cur, dateC ?? from),
          fee: 0, balance: leg.balance ?? null, account: leg.account_id ?? null, mcc: null,
          classification: classify((t.type ?? "").toUpperCase() === "FEE" ? "fee" : (t.type ?? ""), desc, ref, sender, amount),
          raw: t,
        });
      }
      before = txns[txns.length - 1].created_at;
      if (txns.length < 1000) break;
    }

    // 5. Upsert (dedup on Revolut id — never clobbers reviewed rows).
    let added = 0;
    for (let i = 0; i < recs.length; i += 200) {
      const { error } = await sb.from("bank_transactions").upsert(recs.slice(i, i + 200), { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
    }
    added = recs.length;

    // 6. Match by reference (income→invoices, expense→overheads) via the fn.
    await sb.rpc("match_bank_transactions").then(() => {}, () => {});

    return json({ synced: true, from, fetched: recs.length, note: "upserted (deduped on id)" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
