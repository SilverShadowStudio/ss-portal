// revolut-balances
//
// Fetches the live Revolut Business pocket balances (GET /accounts), converts
// foreign pockets to GBP via fx_rates, stores a timestamped snapshot, and returns
// the current cash position. Backs the dashboard "Cash position" card and can be
// called by the daily cron for a balance trend. Read-only Revolut scope.
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

const B2B = "https://b2b.revolut.com/api/1.0";

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
    const key = await importKey(keyB64);
    const accessToken = await refreshAccessToken(clientId, refreshToken, await clientAssertion(clientId, iss, key));

    // FX for foreign → GBP (nearest rate on/before today).
    const { data: fxRows } = await sb.from("fx_rates").select("base, rate_date, rate").eq("quote", "GBP").in("base", ["EUR", "USD"]).order("rate_date");
    const fx: Record<string, { d: string[]; r: number[] }> = {};
    for (const x of (fxRows ?? []) as { base: string; rate_date: string; rate: number }[]) {
      (fx[x.base] ??= { d: [], r: [] }).d.push(x.rate_date), fx[x.base].r.push(Number(x.rate));
    }
    const today = new Date().toISOString().slice(0, 10);
    const toGbp = (amt: number, cur: string) => {
      if (cur === "GBP" || !fx[cur]) return amt;
      const { d, r } = fx[cur]; let lo = 0, hi = d.length - 1, ans = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (d[m] <= today) { ans = m; lo = m + 1; } else hi = m - 1; }
      return amt * (ans >= 0 ? r[ans] : r[r.length - 1]);
    };

    const r = await fetch(`${B2B}/accounts`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) throw new Error(`accounts ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const accounts = (await r.json()) as { id: string; name?: string; balance: number; currency: string; state?: string }[];

    const pockets = accounts
      .filter((a) => a.state !== "deleted")
      .map((a) => ({ currency: a.currency, balance: Number(a.balance), name: a.name ?? a.currency, gbp: Math.round(toGbp(Number(a.balance), a.currency) * 100) / 100 }))
      .sort((x, y) => y.gbp - x.gbp);
    const totalGbp = Math.round(pockets.reduce((s, p) => s + p.gbp, 0) * 100) / 100;

    const capturedAt = new Date().toISOString();
    await sb.from("bank_balance_snapshots").insert({ captured_at: capturedAt, pockets, total_gbp: totalGbp });

    return json({ ok: true, capturedAt, totalGbp, pockets });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
