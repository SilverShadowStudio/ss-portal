// sales-call-assess
//
// Reads a call transcript and grades it: how Fred handled the call, and the
// chance the work lands. Returns dated actions for closing the gap between the
// two, and rolls the probability onto the lead so every card carries it.
//
// The grading is deliberately harsh. A coach that gives everything 70% is
// decoration — the number is only useful if a bad call scores badly, and if the
// probability moves when the call goes wrong.
//
// In:  { call_id }                → assess a stored transcript
//      { lead_id, transcript, ... } → store then assess, in one go
// Out: { call_id, performance_score, win_probability, assessment }
//
// Deploy: npx supabase functions deploy sales-call-assess \
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

const SYSTEM = `You assess sales calls for Silver Shadow Studio, a London CGI and architectural-visualisation studio. Fred Colomb, the owner, makes these calls himself. You are reading a transcript of one.

Return ONLY this JSON. No prose, no markdown fences.
{
  "performance_score": 0,
  "win_probability": 0,
  "read_of_them": "",
  "did_well": [],
  "cost_you": [],
  "blockers": [],
  "actions": [{ "what": "", "by": "YYYY-MM-DD", "why": "" }],
  "verdict": ""
}

performance_score (0-100) — how well FRED handled this call. Not how it went; how he played it. A call that was never winnable can still be a 90 if he played it right, and an easy call fumbled is a 30.
Judge: did he get to the point, did he listen more than he talked, did he handle the objection or talk past it, did he leave with a concrete next step and a date, did he ask for anything.

win_probability (0-100) — the chance this becomes PAID work, on the evidence of this call alone plus what you know of the lead. Be honest and be harsh:
- 0-15  they said no, or the gatekeeper blocked it and there's no route in
- 16-35 polite brush-off, no interest expressed, no next step agreed
- 36-55 some interest, nothing committed
- 56-75 a real next step agreed with a date, decision-maker engaged
- 76-90 they've asked for something concrete — pricing, a proposal, a meeting
- 91-100 verbally agreed, only paperwork left
A first cold call that ends with "send an email to the general inbox" is NOT 50%. It is under 25%. Most cold calls are.

SCORING RULES
- Never give a round, comfortable number to avoid a judgement. If it's 23, say 23.
- The two scores are independent. Say so when they diverge — a well-played call against a hopeless lead is worth knowing.
- If the transcript is too thin to judge, say so in verdict and score conservatively rather than inventing detail.

actions — what would actually move the probability, each with a real date. Fewest that matter, not a list. "by" must be a date, never "soon".
cost_you — what he did that lowered the odds. Be specific and quote him. If he did nothing wrong, return an empty array rather than inventing a fault.
read_of_them — the other person: what they responded to, what closed them down, what they actually care about.
verdict — two sentences. What this call was, and what it's worth.

Write British English, direct and unsentimental. Fred is the owner and can take it straight — the flattering version of this is worthless to him.`;

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

  // ── Store first when given a fresh transcript, so nothing is assessed that
  //    isn't also saved. A grade with no transcript behind it is unauditable.
  let callId = typeof b.call_id === "string" ? b.call_id : "";
  if (!callId) {
    const transcript = typeof b.transcript === "string" ? b.transcript.trim() : "";
    const leadId = typeof b.lead_id === "string" ? b.lead_id : "";
    if (!leadId || !transcript) return json({ error: "lead_id and transcript are required" }, 400);
    const { data, error } = await uc.from("lead_calls").insert({
      lead_id: leadId,
      owner_id: user.id,
      transcript,
      source: typeof b.source === "string" ? b.source : "pasted",
      consent_note: typeof b.consent_note === "string" ? b.consent_note : null,
      duration_seconds: Number.isFinite(Number(b.duration_seconds)) ? Number(b.duration_seconds) : null,
      occurred_at: typeof b.occurred_at === "string" ? b.occurred_at : new Date().toISOString(),
    }).select("id").single();
    if (error) return json({ error: `Couldn't save the transcript: ${error.message}` }, 200);
    callId = data.id;
  }

  const { data: call } = await uc.from("lead_calls")
    .select("id, lead_id, transcript, occurred_at, leads(company, contact_name, role, sector, country, stage, notes)")
    .eq("id", callId).maybeSingle();
  if (!call) return json({ error: "Call not found" }, 404);

  const { data: history } = await uc.from("lead_calls")
    .select("occurred_at, performance_score, win_probability")
    .eq("lead_id", (call as Any).lead_id).not("assessed_at", "is", null)
    .order("occurred_at", { ascending: false }).limit(5);

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today is ${today}.

THE LEAD:
${JSON.stringify((call as Any).leads ?? {}, null, 2)}

EARLIER ASSESSED CALLS ON THIS LEAD (newest first — is it moving?):
${JSON.stringify(history ?? [], null, 2)}

THE TRANSCRIPT:
"""
${(call as Any).transcript}
"""

Return the JSON now.`;

  let res: Response | null = null;
  let lastStatus = 0, lastBody = "";
  for (let i = 0; i < 3; i++) {
    const r = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({ model: SALES_MODEL, max_tokens: 2500, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
    });
    if (r.ok) { res = r; break; }
    lastStatus = r.status; lastBody = await r.text().catch(() => "");
    if (!TRANSIENT_STATUSES.includes(r.status) || i === 2) break;
    await new Promise((rs) => setTimeout(rs, 500 * 2 ** i + Math.floor(Math.random() * 300)));
  }
  if (!res) return json({ call_id: callId, error: `Couldn't assess it (upstream ${lastStatus}): ${lastBody.replace(/\s+/g, " ").slice(0, 200)}` }, 200);

  const data = await res.json();
  const blocks: Any[] = Array.isArray(data.content) ? data.content : [];
  const raw = blocks.filter((c) => c?.type === "text").map((c) => c.text ?? "").join("\n")
    .trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();

  let parsed: Any = null;
  try { parsed = JSON.parse(raw); } catch {
    const a = raw.indexOf("{"), z = raw.lastIndexOf("}");
    try { parsed = JSON.parse(raw.slice(a, z + 1)); } catch { parsed = null; }
  }
  if (!parsed) return json({ call_id: callId, error: "The assessment came back unreadable — try again." }, 200);

  const clamp = (v: Any) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const performance = clamp(parsed.performance_score);
  const probability = clamp(parsed.win_probability);

  const { error: rpcErr } = await uc.rpc("sales_call_assess", {
    p_call_id: callId,
    p_performance: performance,
    p_probability: probability,
    p_assessment: parsed,
  });
  if (rpcErr) return json({ call_id: callId, error: `Assessed, but not saved: ${rpcErr.message}` }, 200);

  // The actions become real commitments, with their dates. An action nobody is
  // held to is a suggestion, and the Commitments page is where they're worked.
  let commitments = 0;
  for (const a of (Array.isArray(parsed.actions) ? parsed.actions : []) as Any[]) {
    const what = String(a?.what ?? "").trim();
    const by = String(a?.by ?? "").trim();
    if (!what || !/^\d{4}-\d{2}-\d{2}$/.test(by)) continue;
    const { error } = await uc.rpc("sales_coach_set_commitment", {
      p_lead_id: (call as Any).lead_id, p_party: "us", p_description: what, p_due_date: by,
    });
    if (!error) commitments++;
  }

  return json({
    success: true,
    call_id: callId,
    lead_id: (call as Any).lead_id,
    performance_score: performance,
    win_probability: probability,
    assessment: parsed,
    commitments_created: commitments,
  });
});
