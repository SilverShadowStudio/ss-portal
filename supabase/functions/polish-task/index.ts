import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuthenticatedUser } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireAuthenticatedUser(req, { corsHeaders });
  if (!auth.ok) return auth.response;

  try {
    const { transcript } = await req.json();
    if (!transcript || typeof transcript !== "string") {
      return new Response(JSON.stringify({ error: "transcript required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                "You convert a client's spoken task request into a clean, professional production brief for a 3D/CGI studio. Keep the client's intent and details. Be concise, clear, and well-structured. If the client mentions any delivery / due / deadline / 'by' / 'before' date (absolute like 'December 12' or relative like 'next Friday', 'in two weeks', 'end of month'), resolve it to an ISO date (YYYY-MM-DD) using the provided 'today' as the reference point. Do NOT include the date in the polished description. Output ONLY via the tool call.",
            },
            {
              role: "user",
              content: `Today is ${new Date().toISOString().slice(0, 10)} (${new Date().toUTCString()}).\n\nRaw dictation:\n\n"""${transcript}"""\n\nProduce a short title (max 7 words, no quotes, no trailing period), a polished brief (1-3 short paragraphs, do NOT mention the delivery date), and if a delivery date is mentioned, set deliveryDate to YYYY-MM-DD. If no date is mentioned, omit deliveryDate.`,
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "format_task",
                description: "Return polished title, brief, and optional delivery date.",
                parameters: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    deliveryDate: {
                      type: "string",
                      description: "Requested delivery date in YYYY-MM-DD format if mentioned, otherwise omit.",
                    },
                  },
                  required: ["title", "description"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "format_task" } },
        }),
      },
    );

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI gateway error", status: response.status }),
        {
          status: response.status === 429 || response.status === 402 ? response.status : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const data = await response.json();
    const args =
      data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const parsed = args ? JSON.parse(args) : null;
    if (!parsed?.title || !parsed?.description) {
      return new Response(JSON.stringify({ error: "no output" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
