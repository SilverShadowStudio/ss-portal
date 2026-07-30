// slack-notify — post Block Kit messages to Slack via SLACK_WEBHOOK_URL secret.
//
// Supported event types:
//   round_created          🔵 New round requested
//   instructions_submitted 📋 Instructions submitted
//   status_changed         🔄 Status changed
//   client_login           👋 Client first login
//   file_delivered         📦 File delivered
//   agreement_signed       ✅ Agreement signed
//
// Deploy: npx supabase functions deploy slack-notify --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { requireInternalOrAdmin } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type EventType =
  | "round_created"
  | "instructions_submitted"
  | "status_changed"
  | "client_login"
  | "file_delivered"
  | "agreement_signed";

interface SlackPayload {
  event: EventType;
  client?: string;
  project?: string;
  scene?: string;
  round?: string;
  detail?: string;
  timestamp?: string;
  portalUrl?: string;
}

const EVENT_CONFIG: Record<EventType, { emoji: string; title: string }> = {
  round_created:          { emoji: "🔵", title: "New round requested" },
  instructions_submitted: { emoji: "📋", title: "Instructions submitted" },
  status_changed:         { emoji: "🔄", title: "Status changed" },
  client_login:           { emoji: "👋", title: "Client first login" },
  file_delivered:         { emoji: "📦", title: "File delivered" },
  agreement_signed:       { emoji: "✅", title: "Agreement signed" },
};

function fmtTimestamp(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireInternalOrAdmin(req, { corsHeaders });
  if (!auth.ok) return auth.response;

  const webhookUrl = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!webhookUrl) {
    console.warn("[slack-notify] SLACK_WEBHOOK_URL not set — skipped");
    return new Response(JSON.stringify({ skipped: true, reason: "SLACK_WEBHOOK_URL not set" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: SlackPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const config = EVENT_CONFIG[payload.event] ?? { emoji: "•", title: payload.event };

  const lines: string[] = [
    "*SILVERSHADOW STUDIO*",
    "━━━━━━━━━━━━━━━━━━━━",
    `${config.emoji}  *${config.title}*`,
    "",
  ];

  if (payload.client)  lines.push(`*Client*\t\t\t${payload.client}`);
  if (payload.project) lines.push(`*Project*\t\t${payload.project}`);
  if (payload.scene)   lines.push(`*Scene*\t\t\t${payload.scene}`);
  if (payload.round)   lines.push(`*Round*\t\t\t${payload.round}`);
  if (payload.detail)  lines.push(`*Detail*\t\t\t${payload.detail}`);

  lines.push("", fmtTimestamp(payload.timestamp));

  if (payload.portalUrl) {
    lines.push("", `<${payload.portalUrl}|View in portal →>`);
  }

  const slackBody = {
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: lines.join("\n") },
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackBody),
    });
    if (!res.ok) {
      console.error("[slack-notify] Slack returned", res.status, await res.text());
    } else {
      console.log("[slack-notify] sent:", config.title);
    }
  } catch (e) {
    console.error("[slack-notify] fetch error:", e);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
