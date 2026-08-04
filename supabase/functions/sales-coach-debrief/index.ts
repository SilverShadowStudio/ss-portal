// sales-coach-debrief
//
// The rep types one sentence about what happened; this turns it into structured
// rows. Scaffolded from draft-sales-pitch (same gate shape, same retry/backoff),
// with the sales role model: reps are NOT admins.
//
// In:  { lead_id, raw_text, quick_outcome? }
// Out: { success, applied, proposed, coach_reply, needs_review, review_reasons, interaction_id }
//
// THE FAILURE MODE THIS GUARDS: a plausible-but-wrong stage change. CHECK
// constraints reject an invalid enum, but a valid-yet-wrong stage would insert
// silently. So a stage/outcome/value is AUTO-APPLIED only when all four hold:
//   1. needs_review === false
//   2. lead_scope ∈ {matches_provided, none_named}
//   3. stage_change.confidence >= AUTO_APPLY_CONFIDENCE
//   4. stage_change.evidence is a VERBATIM substring of raw_text
// Otherwise it comes back as a proposal for the rep to confirm. The interaction
// row (raw_debrief verbatim + the full parse) is written either way.
//
// Deploy: npx supabase functions deploy sales-coach-debrief \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  SALES_MODEL, ANTHROPIC_VERSION, ANTHROPIC_MESSAGES_URL, TRANSIENT_STATUSES,
} from "../_shared/anthropicModel.ts";

// Tuning knob. Deliberately a guess today — every parse is logged to
// interactions.parse_json so this can be tuned against real accepted-and-wrong data.
const AUTO_APPLY_CONFIDENCE = 0.75;
const REVIEW_CONFIDENCE_FLOOR = 0.6;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SYSTEM = `You convert a sales rep's free-text debrief into STRICT JSON. You are an extractor, not a coach — do not editorialise.

You are given ONE anchored lead (the rep tapped that lead's Debrief button) and the rep's raw text.

Return ONLY this JSON object. No prose, no markdown fences.
{
  "confidence": 0.0,
  "needs_review": false,
  "review_reasons": [],
  "lead_scope": "matches_provided",
  "other_companies_mentioned": [],
  "interaction": { "type": "call", "direction": "outbound", "outcome": "spoke", "summary": "", "objection": null },
  "stage_change": null,
  "outcome": null,
  "loss_reason": null,
  "loss_reason_category": null,
  "lead_updates": { "contact_name": null, "role": null, "value_estimate": null, "value_currency": null },
  "commitments": [],
  "commitments_resolved": [],
  "needs_pushback": false,
  "pushback_reason": null
}

ENUMS — use these values EXACTLY, never invent one:
- lead_scope: matches_provided | none_named | mentions_other_company | multiple_companies
- review_reasons[]: low_confidence | ambiguous_stage | lead_mismatch | multiple_leads | contradictory | unparseable
- interaction.type: call | email | meeting | linkedin | whatsapp | other
- interaction.direction: outbound | inbound
- interaction.outcome: no_answer | left_message | spoke | meeting_booked | pushed | objection | dead | other
- outcome: won | lost | dead | null
- loss_reason_category: price | timing | no_budget | competitor | no_decision | wrong_fit | ghosted | other | null
- stage_change.to: new | contacted | engaged | qualified | proposal | negotiation | won | lost | dead

stage_change, when not null, is an object:
  { "to": "qualified", "confidence": 0.0, "evidence": "<VERBATIM phrase copied from the rep's text>", "reason": "" }
The evidence MUST be an exact substring of the rep's text, copied character-for-character. If you cannot quote the text to justify the stage, set stage_change to null. Never paraphrase evidence.

RULES:
- confidence is your honest overall confidence (0..1). Do not inflate it.
- Set needs_review = true and add a reason when: you are unsure (<0.6), the text contradicts itself, the text names a DIFFERENT company than the anchored lead (lead_mismatch), or it discusses several companies (multiple_leads).
- If the text names no company at all, that is NORMAL: lead_scope = "none_named" and the anchored lead is correct.
- Only fill lead_updates from facts explicitly stated. Never guess a value_estimate.
- commitments: things someone promised to do, each needing a due_date (ISO). party "us" = the rep. Resolve dates relative to today.
- needs_pushback = true when the rep recorded NO next step and no date (e.g. "left a message"). A debrief without a next step is not a closed loop.
- summary is one short normalised sentence.`;

async function callAnthropic(apiKey: string, prompt: string): Promise<Response> {
  return fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
    body: JSON.stringify({
      model: SALES_MODEL, max_tokens: 1500, system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    }),
  });
}

/** Strict verbatim check: the quote's words must appear in order, exactly.
 *  Only case and whitespace RUNS are normalised (never semantic) — no fuzzy,
 *  no levenshtein, no token overlap. A hallucinated stage can't quote itself. */
function isVerbatim(evidence: string | null | undefined, raw: string): boolean {
  if (!evidence || typeof evidence !== "string") return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const e = norm(evidence);
  if (e.length < 3) return false;
  return norm(raw).includes(e);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json({ error: "Anthropic API key not configured" }, 500);

  // ── Gate: sales-capable role (reps are NOT admins) ──────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const uc = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
  const allowed = (roles ?? []).some((r: { role: string }) => ["admin", "sales_manager", "sales"].includes(r.role));
  if (!allowed) return json({ error: "Forbidden — sales access required" }, 403);

  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const leadId = typeof b.lead_id === "string" ? b.lead_id : "";
  const rawText = typeof b.raw_text === "string" ? b.raw_text.trim() : "";
  const quickOutcome = typeof b.quick_outcome === "string" ? b.quick_outcome : null;
  if (!leadId) return json({ error: "lead_id is required" }, 400);
  if (!rawText && !quickOutcome) return json({ error: "raw_text or quick_outcome is required" }, 400);

  // ── Context for the extractor (RLS-scoped: the rep's own lead) ───────────────
  const { data: lead } = await uc.from("leads")
    .select("id, company, contact_name, role, sector, country, stage, outcome, value_estimate, next_action_at")
    .eq("id", leadId).maybeSingle();
  if (!lead) return json({ error: "Lead not found (or not yours)" }, 404);

  const { data: openCommitments } = await uc.from("commitments")
    .select("id, party, description, due_date, status")
    .eq("lead_id", leadId).eq("status", "open").order("due_date");

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today is ${today}.

ANCHORED LEAD (the rep tapped this lead's Debrief button):
${JSON.stringify(lead, null, 2)}

OPEN COMMITMENTS on this lead (resolve by id if the text says one was kept/missed):
${JSON.stringify(openCommitments ?? [], null, 2)}

${quickOutcome ? `The rep tapped the quick-outcome chip: "${quickOutcome}".\n` : ""}
THE REP'S RAW DEBRIEF (verbatim):
"""
${rawText || `(no text — only the quick outcome "${quickOutcome}")`}
"""

Return the JSON now.`;

  // ── Retry with backoff; surface the real upstream error (e.g. out of credits) ─
  let res: Response | null = null;
  let lastStatus = 0, lastBody = "";
  for (let i = 0; i < 3; i++) {
    const r = await callAnthropic(anthropicKey, prompt);
    if (r.ok) { res = r; break; }
    lastStatus = r.status; lastBody = await r.text().catch(() => "");
    if (!TRANSIENT_STATUSES.includes(r.status) || i === 2) break;
    await new Promise((rs) => setTimeout(rs, 500 * 2 ** i + Math.floor(Math.random() * 300)));
  }
  if (!res) {
    return json({ error: `Couldn't read that debrief (upstream ${lastStatus || "error"}): ${lastBody.replace(/\s+/g, " ").slice(0, 240)}` }, 200);
  }

  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? "";
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();

  // deno-lint-ignore no-explicit-any
  let parsed: any = null;
  try { parsed = JSON.parse(cleaned); } catch {
    const a = cleaned.indexOf("{"), z = cleaned.lastIndexOf("}");
    try { parsed = JSON.parse(cleaned.slice(a, z + 1)); } catch { parsed = null; }
  }

  // Unparseable → still record the debrief verbatim. Nothing is guessed.
  if (!parsed || typeof parsed !== "object") {
    parsed = {
      confidence: 0, needs_review: true, review_reasons: ["unparseable"],
      lead_scope: "matches_provided", other_companies_mentioned: [],
      interaction: { type: "other", direction: "outbound", outcome: quickOutcome ?? "other", summary: "", objection: null },
      stage_change: null, outcome: null, lead_updates: {}, commitments: [], commitments_resolved: [],
      needs_pushback: false, pushback_reason: null,
      _raw_model_output: cleaned.slice(0, 2000),
    };
  }

  // ── Server-side backstop on needs_review (never trust the model alone) ───────
  const reasons = new Set<string>(Array.isArray(parsed.review_reasons) ? parsed.review_reasons : []);
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const scope = typeof parsed.lead_scope === "string" ? parsed.lead_scope : "matches_provided";
  if (confidence < REVIEW_CONFIDENCE_FLOOR) reasons.add("low_confidence");
  if (scope === "mentions_other_company") reasons.add("lead_mismatch");
  if (scope === "multiple_companies") reasons.add("multiple_leads");
  const needsReview = parsed.needs_review === true || reasons.size > 0;
  parsed.needs_review = needsReview;
  parsed.review_reasons = [...reasons];

  // ── The apply gate ──────────────────────────────────────────────────────────
  const scopeOk = scope === "matches_provided" || scope === "none_named";
  const sc = parsed.stage_change && typeof parsed.stage_change === "object" ? parsed.stage_change : null;
  const scConf = sc && typeof sc.confidence === "number" ? sc.confidence : 0;
  const evidenceOk = sc ? isVerbatim(sc.evidence, rawText) : false;
  const gateOpen = !needsReview && scopeOk;

  const applyStage = (gateOpen && sc && scConf >= AUTO_APPLY_CONFIDENCE && evidenceOk) ? String(sc.to) : null;
  const applyOutcome = (gateOpen && typeof parsed.outcome === "string" && parsed.outcome) ? parsed.outcome : null;

  // value_estimate skews the ranker exactly like a wrong stage — same gate.
  const lu = (parsed.lead_updates && typeof parsed.lead_updates === "object") ? parsed.lead_updates : {};
  const gatedLeadUpdates: Record<string, unknown> = {};
  if (gateOpen) {
    if (lu.contact_name) gatedLeadUpdates.contact_name = lu.contact_name;
    if (lu.role) gatedLeadUpdates.role = lu.role;
    if (typeof lu.value_estimate === "number" && confidence >= AUTO_APPLY_CONFIDENCE) {
      gatedLeadUpdates.value_estimate = lu.value_estimate;
    }
  }

  // What was NOT auto-applied comes back as a proposal for the rep to confirm.
  const proposed: Record<string, unknown> = {};
  if (sc && !applyStage) {
    proposed.stage_change = {
      to: sc.to, reason: sc.reason ?? null, evidence: sc.evidence ?? null,
      confidence: scConf,
      blocked_by: [
        needsReview ? "needs_review" : null,
        !scopeOk ? "lead_scope" : null,
        scConf < AUTO_APPLY_CONFIDENCE ? "low_confidence" : null,
        !evidenceOk ? "evidence_not_verbatim" : null,
      ].filter(Boolean),
    };
  }
  if (typeof parsed.outcome === "string" && parsed.outcome && !applyOutcome) proposed.outcome = parsed.outcome;
  if (typeof lu.value_estimate === "number" && gatedLeadUpdates.value_estimate === undefined) {
    proposed.value_estimate = lu.value_estimate;
  }

  const interaction = (parsed.interaction && typeof parsed.interaction === "object") ? parsed.interaction : {};
  if (!interaction.type) interaction.type = "other";
  if (!interaction.outcome && quickOutcome) interaction.outcome = quickOutcome;

  // ── Atomic write (RPC sets the transaction-local source GUC) ────────────────
  const { data: applied, error: rpcErr } = await uc.rpc("sales_apply_debrief", {
    p_lead_id: leadId,
    p_raw_debrief: rawText,
    p_parse: parsed,
    p_interaction: interaction,
    p_apply_stage: applyStage,
    p_apply_outcome: applyOutcome,
    p_loss_reason: parsed.loss_reason ?? null,
    p_loss_reason_category: parsed.loss_reason_category ?? null,
    p_lead_updates: gatedLeadUpdates,
    p_commitments: Array.isArray(parsed.commitments) ? parsed.commitments : [],
    p_commitments_resolved: Array.isArray(parsed.commitments_resolved) ? parsed.commitments_resolved : [],
  });
  if (rpcErr) return json({ error: `Couldn't save the debrief: ${rpcErr.message}` }, 200);

  // ── Coach reply. Pushback when no next step was set. ────────────────────────
  let coachReply: string;
  if (needsReview) {
    coachReply = parsed.review_reasons.includes("multiple_leads")
      ? "That mentions more than one company. I've filed the note here and changed nothing else — tell me which lead it belongs to."
      : parsed.review_reasons.includes("lead_mismatch")
      ? "That reads like it's about a different company. Note saved here, nothing else touched — confirm where it belongs."
      : "I've saved the note but I'm not confident enough to update the pipeline off it. Check what I read below.";
  } else if (parsed.needs_pushback) {
    coachReply = parsed.pushback_reason
      ? `That's not an outcome — ${parsed.pushback_reason}. When is the next attempt? No date and I'm treating this as stalled.`
      : "That's not an outcome. Next attempt, and when? No date means this is stalled and I'm marking it.";
  } else if (Array.isArray(parsed.commitments) && parsed.commitments.length > 0) {
    coachReply = "Logged. Your commitment is on the clock — I'll hold you to the date.";
  } else {
    coachReply = "Logged. No next step recorded on this one — if that's deliberate, fine; if not, set one.";
  }

  return json({
    success: true,
    interaction_id: (applied as { interaction_id?: string } | null)?.interaction_id ?? null,
    applied: {
      stage: applyStage,
      outcome: applyOutcome,
      lead_updates: gatedLeadUpdates,
      commitments: Array.isArray(parsed.commitments) ? parsed.commitments.length : 0,
      commitments_resolved: Array.isArray(parsed.commitments_resolved) ? parsed.commitments_resolved.length : 0,
    },
    proposed,
    needs_review: needsReview,
    review_reasons: parsed.review_reasons,
    other_companies_mentioned: Array.isArray(parsed.other_companies_mentioned) ? parsed.other_companies_mentioned : [],
    confidence,
    summary: interaction.summary ?? null,
    coach_reply: coachReply,
    // Seam: the next directive belongs to sales-coach-brief (not built yet, by design).
    next_directive: null,
  });
});
