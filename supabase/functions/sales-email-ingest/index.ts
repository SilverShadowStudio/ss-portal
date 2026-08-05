// sales-email-ingest
//
// Fred pastes an email, or a whole thread, and it lands on the lead as SEPARATE
// entries at their real send times — not one blob stamped "now". A thread read
// in one sitting still happened over three weeks, and the history is only
// useful if it says so.
//
// Splitting a thread reliably means reading it: quoting styles, "On 3 Aug,
// X wrote:", forwarded headers, mobile signatures. A regex gets this wrong on
// the first unusual client, so the model does the parsing and the function does
// the trusting-but-verifying.
//
// In:  { lead_id, raw }
// Out: { inserted, skipped, messages[] }
//
// Deploy: npx supabase functions deploy sales-email-ingest \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  SALES_MODEL, ANTHROPIC_VERSION, ANTHROPIC_MESSAGES_URL, TRANSIENT_STATUSES,
} from "../_shared/anthropicModel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Any = any;

const SYSTEM = `You split pasted email into individual messages. You are a parser, not a summariser — do not editorialise.

Return ONLY this JSON. No prose, no markdown fences.
{ "messages": [ { "sent_at": "", "direction": "outbound", "from": "", "to": "", "subject": "", "body": "", "summary": "" } ] }

ONE OBJECT PER EMAIL. A forwarded or quoted thread contains several — split them all out, including the quoted ones underneath. Newest or oldest first doesn't matter; order is fixed later.

sent_at — ISO 8601 with a timezone offset where the email states one, e.g. "2026-08-03T14:22:00+01:00". Use the date and time written IN the email, never today's date. If an email shows only a date, use it with T09:00:00Z. If a message genuinely carries no date at all, set sent_at to null and it will be dropped rather than guessed at.

direction — "outbound" when Fred Colomb / Silver Shadow Studio sent it, "inbound" when the other party did. Decide from the From line, not from tone.

body — that message's own text only, with the quoted history below it removed. Keep it verbatim: no tidying, no truncation, no paraphrase.
summary — one short factual sentence. What it says, not what it means.

If the paste contains no recognisable email at all, return { "messages": [] }.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "Anthropic API key not configured" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const uc = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
  if (!(roles ?? []).some((r: { role: string }) => ["admin", "sales_manager", "sales"].includes(r.role))) {
    return json({ error: "Forbidden — sales access required" }, 403);
  }

  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const leadId = typeof b.lead_id === "string" ? b.lead_id : "";
  const raw = typeof b.raw === "string" ? b.raw.trim() : "";
  if (!leadId || !raw) return json({ error: "lead_id and raw are required" }, 400);

  let res: Response | null = null;
  let lastStatus = 0, lastBody = "";
  for (let i = 0; i < 3; i++) {
    const r = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model: SALES_MODEL, max_tokens: 4000, system: SYSTEM,
        messages: [{ role: "user", content: `Split this into individual emails.\n\n"""\n${raw.slice(0, 60000)}\n"""\n\nReturn the JSON now.` }],
      }),
    });
    if (r.ok) { res = r; break; }
    lastStatus = r.status; lastBody = await r.text().catch(() => "");
    if (!TRANSIENT_STATUSES.includes(r.status) || i === 2) break;
    await new Promise((rs) => setTimeout(rs, 500 * 2 ** i + Math.floor(Math.random() * 300)));
  }
  if (!res) return json({ error: `Couldn't read that (upstream ${lastStatus}): ${lastBody.replace(/\s+/g, " ").slice(0, 200)}` }, 200);

  const data = await res.json();
  const text = (Array.isArray(data.content) ? data.content : [])
    .filter((c: Any) => c?.type === "text").map((c: Any) => c.text ?? "").join("\n")
    .trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();

  let parsed: Any = null;
  try { parsed = JSON.parse(text); } catch {
    const a = text.indexOf("{"), z = text.lastIndexOf("}");
    try { parsed = JSON.parse(text.slice(a, z + 1)); } catch { parsed = null; }
  }
  const msgs: Any[] = Array.isArray(parsed?.messages) ? parsed.messages : [];
  if (msgs.length === 0) return json({ inserted: 0, skipped: 0, messages: [], note: "No emails found in that paste." }, 200);

  // What's already on this lead, so re-pasting a longer thread tops it up
  // instead of duplicating everything below the new reply.
  const { data: existing } = await uc.from("interactions")
    .select("occurred_at, raw_debrief").eq("lead_id", leadId).eq("type", "email");
  const fingerprint = (at: string, body: string) =>
    `${at.slice(0, 16)}|${(body || "").replace(/\s+/g, " ").trim().slice(0, 120).toLowerCase()}`;
  const seen = new Set((existing ?? []).map((e: Any) => fingerprint(e.occurred_at ?? "", e.raw_debrief ?? "")));

  const out: Any[] = [];
  let inserted = 0, skipped = 0;

  for (const m of msgs) {
    const at = typeof m?.sent_at === "string" ? m.sent_at : "";
    const when = at ? new Date(at) : null;
    // A dateless email is dropped rather than stamped with now — the whole
    // point is that the history carries the real times.
    if (!when || isNaN(when.getTime())) { skipped++; continue; }

    const body = String(m?.body ?? "").trim();
    const fp = fingerprint(when.toISOString(), body);
    if (seen.has(fp)) { skipped++; continue; }
    seen.add(fp);

    const { error } = await uc.rpc("sales_coach_log_interaction", {
      p_lead_id: leadId,
      p_type: "email",
      p_direction: m?.direction === "inbound" ? "inbound" : "outbound",
      p_outcome: null,
      p_summary: String(m?.summary ?? "").trim() || String(m?.subject ?? "").trim() || null,
      p_raw: body || null,
      p_occurred_at: when.toISOString(),
    });
    if (error) { skipped++; continue; }
    inserted++;
    out.push({ sent_at: when.toISOString(), direction: m?.direction ?? "outbound", subject: m?.subject ?? null });
  }

  return json({
    success: true,
    inserted,
    skipped,
    messages: out.sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at))),
  });
});
