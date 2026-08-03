// Edge function: draft-sales-pitch
// Admin-gated. Given a lead, drafts a warm, personalized outreach email for
// Silver Shadow Studio (subject + body) via the Anthropic API. Returns JSON.

import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-4-5";
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

async function callAnthropic(apiKey: string, prompt: string): Promise<Response> {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
  });
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
  const prompt = `Draft the outreach email for this lead:\n\n${facts}\n\nReturn the JSON now.`;

  // Retry with backoff; surface the real upstream error (e.g. out of credits).
  const TRANSIENT = [429, 500, 502, 503, 529];
  let res: Response | null = null;
  let lastStatus = 0, lastBody = "";
  for (let i = 0; i < 3; i++) {
    const r = await callAnthropic(anthropicKey, prompt);
    if (r.ok) { res = r; break; }
    lastStatus = r.status; lastBody = await r.text().catch(() => "");
    if (!TRANSIENT.includes(r.status) || i === 2) break;
    await new Promise((rs) => setTimeout(rs, 500 * 2 ** i + Math.floor(Math.random() * 300)));
  }
  if (!res) return json({ error: `Couldn't draft (upstream ${lastStatus || "error"}): ${lastBody.replace(/\s+/g, " ").slice(0, 240)}` }, 200);

  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? "";
  const raw = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: { subject?: string; body?: string };
  try { parsed = JSON.parse(raw); } catch {
    const a = raw.indexOf("{"), z = raw.lastIndexOf("}");
    try { parsed = JSON.parse(raw.slice(a, z + 1)); } catch { return json({ error: "Draft came back unreadable — try again." }, 200); }
  }
  return json({ success: true, subject: parsed.subject ?? "", body: parsed.body ?? "" });
});
