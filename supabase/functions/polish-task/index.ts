// polish-task
//
// Converts a client's spoken task dictation into { title, description,
// deliveryDate? } for the task-creation flows (Delivery, Timeline, NewTask).
//
// Rewritten 30 Jul 2026: the original called the Lovable AI gateway with
// LOVABLE_API_KEY, which is no longer valid for this project — dictation
// polish had been failing silently (callers fall back to the raw
// transcript). Now calls Anthropic directly, same pattern as format-brief,
// with a tool call to keep the structured contract the three callers expect.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuthenticatedUser } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT =
  "You convert a client's spoken task request into a clean, professional production brief for a 3D/CGI studio. Keep the client's intent and details. Be concise, clear, and well-structured. If the client mentions any delivery / due / deadline / 'by' / 'before' date (absolute like 'December 12' or relative like 'next Friday', 'in two weeks', 'end of month'), resolve it to an ISO date (YYYY-MM-DD) using the provided 'today' as the reference point. Do NOT include the date in the polished description. Output ONLY via the tool call.";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireAuthenticatedUser(req, { corsHeaders });
  if (!auth.ok) return auth.response;

  try {
    const { transcript } = await req.json();
    if (!transcript || typeof transcript !== "string") {
      return json({ error: "transcript required" }, 400);
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return json({ error: "Anthropic API key not configured" }, 500);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content:
              `Today is ${new Date().toISOString().slice(0, 10)} (${new Date().toUTCString()}).\n\n` +
              `Raw dictation:\n\n"""${transcript}"""\n\n` +
              `Produce a short title (max 7 words, no quotes, no trailing period), a polished brief ` +
              `(1-3 short paragraphs, do NOT mention the delivery date), and if a delivery date is ` +
              `mentioned, set deliveryDate to YYYY-MM-DD. If no date is mentioned, omit deliveryDate.`,
          },
        ],
        tools: [
          {
            name: "format_task",
            description: "Return polished title, brief, and optional delivery date.",
            input_schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                deliveryDate: {
                  type: "string",
                  description:
                    "Requested delivery date in YYYY-MM-DD format if mentioned, otherwise omit.",
                },
              },
              required: ["title", "description"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "format_task" },
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("[polish-task] Anthropic API error", response.status, t);
      return json(
        { error: "AI error", status: response.status },
        response.status === 429 ? 429 : 500,
      );
    }

    const data = await response.json();
    const toolUse = (data?.content ?? []).find(
      (b: { type: string }) => b.type === "tool_use",
    ) as { input?: { title?: string; description?: string; deliveryDate?: string } } | undefined;
    const parsed = toolUse?.input ?? null;
    if (!parsed?.title || !parsed?.description) {
      return json({ error: "no output" }, 500);
    }

    return json(parsed as Record<string, unknown>);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});
