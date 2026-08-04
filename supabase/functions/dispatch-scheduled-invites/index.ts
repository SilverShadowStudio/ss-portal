// dispatch-scheduled-invites
//
// Cron target (every 5 minutes). Sends team invitations that were scheduled for
// later. Mirrors dispatch-pending-deliveries: this function routes, it doesn't
// compose — admin-create-client in `resend` mode generates a fresh magic link
// and sends it, so a deferred invite is never stale on arrival.
//
// Idempotent: rows are picked up by send_at and stamped sent_at once away.
//
// Auth: cron secret (X-Cron-Secret) or an admin JWT.
//
// Deploy: npx supabase functions deploy dispatch-scheduled-invites \
//           --project-ref oodhsoiwnqxcimzmzick --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireCronOrAdmin } from "../_shared/cronAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (d: Record<string, unknown>, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_ATTEMPTS = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireCronOrAdmin(req, { corsHeaders });
  if (!auth.ok) return auth.response;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: due, error } = await sb.from("scheduled_invites")
    .select("id, account_id, email, attempts")
    .is("sent_at", null).is("cancelled_at", null)
    .lte("send_at", new Date().toISOString())
    .lt("attempts", MAX_ATTEMPTS)
    .order("send_at").limit(25);
  if (error) return json({ error: error.message }, 500);
  if (!due?.length) return json({ sent: 0, checked: 0 });

  let sent = 0;
  for (const row of due) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/admin-create-client`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "resend", accountId: row.account_id, contact: { email: row.email } }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out?.error) throw new Error(out?.error || `HTTP ${res.status}`);
      await sb.from("scheduled_invites")
        .update({ sent_at: new Date().toISOString(), attempts: (row.attempts ?? 0) + 1, last_error: null })
        .eq("id", row.id);
      sent++;
    } catch (e) {
      // Leave the row due so the next tick retries, up to MAX_ATTEMPTS.
      await sb.from("scheduled_invites")
        .update({ attempts: (row.attempts ?? 0) + 1, last_error: (e as Error).message.slice(0, 300) })
        .eq("id", row.id);
    }
  }
  return json({ sent, checked: due.length });
});
