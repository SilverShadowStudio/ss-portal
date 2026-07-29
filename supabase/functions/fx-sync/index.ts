// Edge function: fx-sync
// Fetches ECB daily reference rates (base→GBP) from Frankfurter server-side and
// upserts them into fx_rates, so the browser never depends on a flaky external
// API. Retries transient failures. Idempotent — safe to call on demand and by
// cron. Any signed-in user may trigger it (reference data only) or the cron
// secret.
//
// Body: { start?: "YYYY-MM-DD" } (default 2024-01-01). Returns { synced, latest }.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const FOREIGN = ["EUR", "USD"];
const todayISO = () => new Date().toISOString().slice(0, 10);

async function fetchSeries(base: string, start: string, end: string): Promise<Record<string, number>> {
  const url = `https://api.frankfurter.dev/v1/${start}..${end}?base=${base}&symbols=GBP`;
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.json() as { rates?: Record<string, Record<string, number>> };
        const out: Record<string, number> = {};
        for (const [d, r] of Object.entries(body.rates ?? {})) {
          if (typeof r?.GBP === "number") out[d] = r.GBP;
        }
        if (Object.keys(out).length > 0) return out;
        lastErr = "empty series";
      } else {
        lastErr = `status ${res.status}`;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); // backoff
  }
  throw new Error(`Frankfurter ${base}: ${lastErr}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Auth: any signed-in user OR the cron secret. (Reference data — low risk.)
  const cronSecret = Deno.env.get("CRON_SECRET") ?? Deno.env.get("PAYABLES_CRON_SECRET") ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";
  const isCron = cronSecret.length > 0 && provided === cronSecret;
  if (!isCron) {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const uc = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await uc.auth.getUser();
    if (!u?.user) return json({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const start = typeof body.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.start) ? body.start : "2024-01-01";
  const end = todayISO();

  let synced = 0;
  const latest: Record<string, { rate: number; date: string }> = {};
  const errors: string[] = [];
  for (const base of FOREIGN) {
    try {
      const series = await fetchSeries(base, start, end);
      const rows = Object.entries(series).map(([d, rate]) => ({ base, quote: "GBP", rate_date: d, rate, updated_at: new Date().toISOString() }));
      // Upsert in chunks.
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from("fx_rates").upsert(rows.slice(i, i + 500), { onConflict: "base,quote,rate_date" });
        if (error) throw error;
      }
      synced += rows.length;
      const lastDate = Object.keys(series).sort().pop()!;
      latest[base] = { rate: series[lastDate], date: lastDate };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return json({ success: errors.length === 0, synced, latest, errors });
});
