// _shared/cronAuth.ts
//
// Caller verification for functions that are invoked by pg_cron or by a
// database trigger rather than by a signed-in user.
//
// Why this exists.
//   Edge functions deployed with verify_jwt = true are still reachable by
//   anyone holding the anon key — which ships in the client bundle and is
//   public by design. For a function that only reads data that is already
//   visible to the caller that is harmless. For one that sends email,
//   mutates rows, or writes to Airtable it is not: a stranger can trigger
//   real side effects.
//
// The pattern (lifted from payables-sync, generalised).
//   Two accepted callers:
//     * Machine — sends an X-Cron-Secret header matching the named env var.
//       Constant-time compare to avoid timing attacks. Decoupled from the
//       service-role key, so rotating service_role doesn't break cron and
//       leaking the cron secret grants only "run this function", never
//       database access.
//     * Admin JWT — a human triggering the same job from the portal.
//       Optional; pass allowAdmin: false for jobs with no manual path.
//
// Usage:
//   const auth = await requireCronOrAdmin(req, { secretEnvVar: "CRON_SECRET" });
//   if (!auth.ok) return auth.response;

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function constantTimeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

export type CronAuthResult =
  | { ok: true; caller: "cron" | "admin" }
  | { ok: false; response: Response };

interface CronAuthOptions {
  /** Name of the function env var holding the shared secret. */
  secretEnvVar: string;
  /** Allow an admin JWT as an alternative caller. Default true. */
  allowAdmin?: boolean;
  /** Headers to merge into the 401/403 response (CORS). */
  corsHeaders?: Record<string, string>;
}

export async function requireCronOrAdmin(
  req: Request,
  opts: CronAuthOptions,
): Promise<CronAuthResult> {
  const { secretEnvVar, allowAdmin = true, corsHeaders = {} } = opts;

  const deny = (status: number, error: string): CronAuthResult => ({
    ok: false,
    response: new Response(JSON.stringify({ error }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  });

  // 1. Machine caller.
  const cronSecret = Deno.env.get(secretEnvVar) ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (cronSecret && provided && constantTimeEqual(cronSecret, provided)) {
    return { ok: true, caller: "cron" };
  }

  // A missing secret is a deploy error, not an open door. Fail closed so a
  // half-configured function is never reachable rather than silently public.
  if (!cronSecret) {
    console.error(`[cronAuth] ${secretEnvVar} is not set — refusing all callers`);
    return deny(500, `Server misconfigured: ${secretEnvVar} not set`);
  }

  if (!allowAdmin) return deny(401, "Unauthorized");

  // 2. Admin JWT caller.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return deny(401, "Unauthorized");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authed = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims, error: claimsErr } = await authed.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return deny(401, "Unauthorized");

  const svc = createClient(supabaseUrl, serviceRoleKey);
  const { data: roleRow } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", claims.claims.sub as string)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) return deny(403, "Forbidden: admins only");

  return { ok: true, caller: "admin" };
}
