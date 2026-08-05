// pa-capture
//
// One line in, one reminder out. Fred taps the bubble, says or types
// "reminder for tomorrow morning 9:45 did the mike@ email bounce back",
// presses enter, and forgets it.
//
// No conversation and no memory: the reminder IS the memory. Everything this
// function does is turn a spoken sentence into a time and a sentence.
//
// In:  { text }
// Out: { id, body, due_at }
//
// Deploy: npx supabase functions deploy pa-capture \
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

const SYSTEM = `You turn one spoken or typed line into a reminder. Return ONLY this JSON, no prose, no fences:
{ "body": "", "due_at": "", "understood": true }

HE WILL USUALLY WRITE IT BARE. "16:30 wednesday did john call", "tomorrow 9:45 chase spink", "friday send the maybourne quote". There is no "remind me" and there does not need to be — everything he says here is a reminder. Read the leading time and day tokens as the WHEN, and everything after them as the WHAT. The order varies: "wednesday 16:30", "16:30 wed", "9:45 tomorrow" all mean the same thing.

body — what to put in front of him when it fires, in HIS words. Strip the timing tokens and any instruction wrapper ("remind me to", "reminder for"), and keep the substance. "Did the mike@ email bounce back" stays exactly that — a question he asked himself stays a question. Never expand, explain or tidy it.

due_at — ISO 8601 with the offset, resolved against the current time and timezone you are given.
- "tomorrow morning 9:45" → tomorrow at 09:45 local.
- "in an hour" → one hour from now.
- "monday" with no time → 09:00 that Monday.
- "this afternoon" → 14:00 today. "tonight" → 19:00. "first thing" → 08:00.
- A time already past today means tomorrow, unless he named a date.
- A bare weekday means the NEXT one — on a Wednesday, "wednesday" is seven days away, not this morning.

understood — false ONLY if there is no way to tell when he means. Do not guess wildly: a reminder that fires at the wrong time is worse than one he has to restate. When false, still return your best body so nothing he said is lost.

If he gives no time at all, treat it as one hour from now and set understood true — a thing worth saying out loud is worth surfacing soon.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "Anthropic API key not configured" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const uc = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await uc.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return json({ error: "Nothing to remember." }, 400);

  // The caller's own clock and zone — "tomorrow morning" is meaningless without
  // knowing where and when he is.
  const tz = typeof b.timezone === "string" ? b.timezone : "Europe/London";
  const nowIso = typeof b.now === "string" ? b.now : new Date().toISOString();
  const nowLocal = new Date(nowIso).toLocaleString("en-GB", { timeZone: tz, dateStyle: "full", timeStyle: "short" });

  let res: Response | null = null;
  let lastStatus = 0;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model: SALES_MODEL, max_tokens: 600, system: SYSTEM,
        messages: [{ role: "user", content: `It is now ${nowLocal} (${tz}, ISO ${nowIso}).\n\nHe said:\n"""\n${text}\n"""\n\nReturn the JSON now.` }],
      }),
    });
    if (r.ok) { res = r; break; }
    lastStatus = r.status;
    if (!TRANSIENT_STATUSES.includes(r.status) || i === 2) break;
    await new Promise((rs) => setTimeout(rs, 400 * 2 ** i));
  }
  if (!res) return json({ error: `Couldn't reach the parser (${lastStatus}).` }, 200);

  const data = await res.json();
  const raw = (Array.isArray(data.content) ? data.content : [])
    .filter((c: Any) => c?.type === "text").map((c: Any) => c.text ?? "").join("\n")
    .trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();

  let parsed: Any = null;
  try { parsed = JSON.parse(raw); } catch {
    const a = raw.indexOf("{"), z = raw.lastIndexOf("}");
    try { parsed = JSON.parse(raw.slice(a, z + 1)); } catch { parsed = null; }
  }

  const body = String(parsed?.body ?? "").trim() || text;
  const when = parsed?.due_at ? new Date(parsed.due_at) : null;
  if (!when || isNaN(when.getTime())) {
    return json({ error: "I couldn't work out when. Say it with a time — “tomorrow at 9:45”.", body }, 200);
  }

  const { data: row, error } = await uc.from("reminders")
    .insert({ owner_id: user.id, body, due_at: when.toISOString(), raw_text: text })
    .select("id, body, due_at").single();
  if (error) return json({ error: error.message }, 200);

  return json({ success: true, ...row });
});
