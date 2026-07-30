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
//
// For a function the browser calls on behalf of any signed-in user (not just
// admins), use requireAuthenticatedUser instead — it rejects anonymous
// callers without demanding a role.

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
  | { ok: true; caller: "cron" | "admin" | "user" | "service" }
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

  return await verifyAdminJwt(authHeader, token, deny);
}

/**
 * Accept internal machine callers or an admin.
 *
 * Three accepted callers:
 *   * x-cron-secret header matching the named env var (DB triggers and
 *     pg_cron jobs whose commands read the secret from Vault).
 *   * Bearer equal to the service-role key (function-to-function calls —
 *     dispatch-pending-deliveries → send-delivery-notification,
 *     airtable-auto-sync → slack-notify — which already send it).
 *   * Admin JWT (a human re-running the job from the portal), unless
 *     allowAdmin: false.
 *
 * Unlike requireCronOrAdmin this does NOT fail closed when the secret env
 * var is unset: the service-role path is always configured by the platform,
 * and some callers (functions.invoke) never send a cron secret at all. A
 * presented-but-unconfigured secret is logged so the misconfiguration is
 * visible in function logs.
 */
export async function requireInternalOrAdmin(
  req: Request,
  opts: Partial<CronAuthOptions> = {},
): Promise<CronAuthResult> {
  const { secretEnvVar = "CRON_SECRET", allowAdmin = true, corsHeaders = {} } = opts;

  const deny = (status: number, error: string): CronAuthResult => ({
    ok: false,
    response: new Response(JSON.stringify({ error }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  });

  // 1. Machine caller with the shared secret.
  const cronSecret = Deno.env.get(secretEnvVar) ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (provided) {
    if (cronSecret && constantTimeEqual(cronSecret, provided)) {
      return { ok: true, caller: "cron" };
    }
    if (!cronSecret) {
      console.error(
        `[cronAuth] x-cron-secret presented but ${secretEnvVar} is not set — check function secrets`,
      );
    }
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return deny(401, "Unauthorized");

  // 2. Function-to-function caller holding the service-role key.
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceRoleKey && constantTimeEqual(token, serviceRoleKey)) {
    return { ok: true, caller: "service" };
  }

  if (!allowAdmin) return deny(401, "Unauthorized");

  // 3. Admin JWT caller.
  return await verifyAdminJwt(authHeader, token, deny);
}

/**
 * Accept only a signed-in admin. For endpoints the admin UI calls directly
 * (send-invoice-email, send-quotation-email, diagnostics) where neither cron
 * nor other functions are legitimate callers.
 */
export async function requireAdminUser(
  req: Request,
  opts: { corsHeaders?: Record<string, string> } = {},
): Promise<CronAuthResult> {
  const { corsHeaders = {} } = opts;

  const deny = (status: number, error: string): CronAuthResult => ({
    ok: false,
    response: new Response(JSON.stringify({ error }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return deny(401, "Unauthorized");

  return await verifyAdminJwt(authHeader, token, deny);
}

async function verifyAdminJwt(
  authHeader: string,
  token: string,
  deny: (status: number, error: string) => CronAuthResult,
): Promise<CronAuthResult> {
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

/**
 * Accept any signed-in user; reject anonymous callers.
 *
 * For housekeeping endpoints the browser fires on page load — the caller is a
 * real session, but not necessarily an admin. The anon key alone is NOT a
 * session: getClaims rejects it, because it carries no `sub`. That is the
 * distinction this function relies on, and the reason verify_jwt = true is
 * not by itself a gate.
 */
export async function requireAuthenticatedUser(
  req: Request,
  opts: { corsHeaders?: Record<string, string> } = {},
): Promise<CronAuthResult> {
  const { corsHeaders = {} } = opts;

  const deny = (status: number, error: string): CronAuthResult => ({
    ok: false,
    response: new Response(JSON.stringify({ error }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return deny(401, "Unauthorized");

  const authed = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claims, error } = await authed.auth.getClaims(token);
  if (error || !claims?.claims?.sub) return deny(401, "Unauthorized");

  return { ok: true, caller: "user" };
}
