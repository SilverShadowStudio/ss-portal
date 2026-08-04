// Edge function: draft-sales-pitch
// Admin-gated. Given a lead, drafts a warm, personalized outreach email for
// Silver Shadow Studio (subject + body) via the Anthropic API. Returns JSON.

import { createClient } from "npm:@supabase/supabase-js@2";
import { SALES_MODEL } from "../_shared/anthropicModel.ts";

// One model id for the whole sales module. claude-sonnet-4-5 was hardcoded here
// and had drifted out of step with the verified id in _shared.
const MODEL = SALES_MODEL;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SYSTEM = `You write warm, genuinely personalized B2B outreach for Silver Shadow Studio — a London CGI / architectural-visualisation studio producing photorealistic renders, animation and virtual tours for architects, property developers, interior designers and estate agents (silvershadowstudio.com).

Write ONE short outreach email to the given contact. Rules:
- Specific and human. Reference their company, sector or likely projects concretely — never generic.
- Lead with value to THEM (winning pitches, selling units off-plan, marketing a scheme), not "we offer X services".
- Exactly one soft call to action: a quick call, or offering to send the reel / a sample frame.
- 90–140 words. Plain, confident, peer-to-peer. British English.
- BANNED: "I hope this email finds you well", "game-changer", "reach out", "circle back", "synergy", "cutting-edge", exclamation-mark hype, and any placeholder like [Name] or [Company] — use the real details or omit.
Return ONLY valid JSON: {"subject": string, "body": string}. Body uses \\n for line breaks. No markdown.`;

const SYSTEM_CALL = `You prepare phone-call briefs for Silver Shadow Studio — a London CGI / architectural-visualisation studio (photorealistic renders, animation, virtual tours) selling to architects, property developers, interior designers and estate agents. Fred is about to phone the given contact.

Write a tight, practical CALL SCRIPT he can glance at mid-call. Structure the body with these short labelled sections (plain text, use \\n):
OPENER — one natural line to the contact (or to get past a PA/reception).
HOOK — one specific, genuine reason you're calling them (their work/sector/a likely project). Not generic.
VALUE — the 15-second "why renders help you" line, in their terms (win the pitch, sell units off-plan, market the scheme).
ASK — the single call goal: book a 15-minute look at the reel / a short intro call.
OBJECTIONS — 3 likely pushbacks ("we have someone", "send an email", "no budget") each with a one-line response.
British English, confident, human, concise. No spam clichés. The "subject" field = a 4-6 word call objective.
Return ONLY valid JSON: {"subject": string, "body": string}. No markdown.`;

async function callAnthropic(apiKey: string, prompt: string, mode: string): Promise<Response> {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: mode === "call" ? 2500 : 1200, system: mode === "call" ? SYSTEM_CALL : SYSTEM, messages: [{ role: "user", content: prompt }] }),
  });
}

/** Turn the model's reply into {subject, body}, tolerating the two ways a long
 *  call brief goes wrong: raw newlines inside a JSON string (invalid JSON, even
 *  though the prompt asks for \\n), and a response cut off mid-string.
 *  Falls back to field extraction so a usable brief beats a clean error. */
function parseDraft(raw: string): { subject?: string; body?: string } | null {
  const attempts = [raw];
  const a = raw.indexOf("{"), z = raw.lastIndexOf("}");
  if (a >= 0 && z > a) attempts.push(raw.slice(a, z + 1));
  // Escape literal control characters that appear INSIDE string literals.
  attempts.push(...attempts.map(escapeInsideStrings));

  for (const t of attempts) {
    try {
      const o = JSON.parse(t);
      if (o && typeof o === "object") return o as { subject?: string; body?: string };
    } catch { /* next */ }
  }

  // Nothing parsed — pull the fields out directly. This is what rescues a reply
  // that was truncated before its closing brace.
  const subject = /"subject"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw)?.[1];
  const bodyM = /"body"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(raw);
  const body = bodyM?.[1];
  if (!body && !subject) return null;
  const unescape = (v?: string) =>
    v?.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return { subject: unescape(subject), body: unescape(body) };
}

/** JSON forbids raw newlines/tabs inside strings; models emit them anyway on
 *  multi-line output. Escape only those inside quotes, leaving structure alone. */
function escapeInsideStrings(s: string): string {
  let out = "", inStr = false, esc = false;
  for (const ch of s) {
    if (esc) { out += ch; esc = false; continue; }
    if (ch === "\\") { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && ch === "\n") { out += "\\n"; continue; }
    if (inStr && ch === "\r") { out += "\\r"; continue; }
    if (inStr && ch === "\t") { out += "\\t"; continue; }
    out += ch;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json({ error: "Anthropic API key not configured" }, 500);

  // Admin gate
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const uc = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!role) return json({ error: "Forbidden — admin only" }, 403);

  const b = await req.json().catch(() => ({} as Record<string, string>));
  const facts = [
    b.company && `Company: ${b.company}`,
    b.contact_name && `Contact: ${b.contact_name}`,
    b.role && `Their role: ${b.role}`,
    b.sector && `Sector: ${b.sector}`,
    b.website && `Website: ${b.website}`,
    b.notes && `Notes / context: ${b.notes}`,
  ].filter(Boolean).join("\n");
  if (!b.company) return json({ error: "company is required" }, 400);
  const mode = b.mode === "call" ? "call" : "email";
  const prompt = `${mode === "call" ? "Prepare the call brief" : "Draft the outreach email"} for this lead:\n\n${facts}\n\nReturn the JSON now.`;

  // Retry with backoff; surface the real upstream error (e.g. out of credits).
  const TRANSIENT = [429, 500, 502, 503, 529];
  let res: Response | null = null;
  let lastStatus = 0, lastBody = "";
  for (let i = 0; i < 3; i++) {
    const r = await callAnthropic(anthropicKey, prompt, mode);
    if (r.ok) { res = r; break; }
    lastStatus = r.status; lastBody = await r.text().catch(() => "");
    if (!TRANSIENT.includes(r.status) || i === 2) break;
    await new Promise((rs) => setTimeout(rs, 500 * 2 ** i + Math.floor(Math.random() * 300)));
  }
  if (!res) return json({ error: `Couldn't draft (upstream ${lastStatus || "error"}): ${lastBody.replace(/\s+/g, " ").slice(0, 240)}` }, 200);

  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? "";
  const truncated = data.stop_reason === "max_tokens";
  const raw = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();

  const parsed = parseDraft(raw);
  if (!parsed) {
    return json({
      error: truncated
        ? "The brief ran past its length limit and came back cut off. Try again — it's usually shorter the second time."
        : "Draft came back unreadable — try again.",
    }, 200);
  }
  return json({ success: true, subject: parsed.subject ?? "", body: parsed.body ?? "", truncated });
});
