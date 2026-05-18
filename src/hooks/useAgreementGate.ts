// useAgreementGate — decides whether a route should render, redirect to
// /contract, or redirect away from /contract, based on the authenticated
// user's role + account + agreement state.
//
// Returns one of:
//   "loading"          — auth or query in flight; render a quiet spinner.
//   "bypass"           — admin / team / ghost-mode; render the route as-is.
//   "ok"               — client has an active agreement; render the route.
//                        (If they're on /contract, the AgreementGate
//                        component redirects them to /.)
//   "needs_signature"  — client without an active agreement; route to /contract.
//
// "Active agreement" means a row in `agreements` for the user's account
// with `agreement_version` IN the SUPPORTED_AGREEMENT_VERSIONS set.
// Bumping that constant triggers re-acceptance for all clients with an
// outdated version — see the TODO in App.tsx before doing so.

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { SUPPORTED_AGREEMENT_VERSIONS } from "@/lib/agreements";

export type AgreementGateStatus = "loading" | "bypass" | "ok" | "needs_signature";

export function useAgreementGate(): AgreementGateStatus {
  const { user, isGhostMode, accountType } = useAuth();
  const [status, setStatus] = useState<AgreementGateStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!user) {
        // No user yet — leave it to ProtectedRoute / AdminProtectedRoute to
        // handle the unauthenticated case. We report "loading" so the gate
        // never accidentally redirects an unauthenticated user.
        if (!cancelled) setStatus("loading");
        return;
      }

      // Ghost mode — the admin is impersonating a client and must see the
      // portal exactly as it appears to them, without the v3 gate.
      if (isGhostMode) {
        if (!cancelled) setStatus("bypass");
        return;
      }

      // Admin / super_admin users bypass entirely.
      try {
        const { data: roleRow } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .in("role", ["admin", "super_admin"])
          .maybeSingle();
        if (cancelled) return;
        if (roleRow) {
          setStatus("bypass");
          return;
        }
      } catch {
        // Role lookup failures fall through to the client path — they
        // never lock an admin out because admins also pass other checks.
      }

      // Team / freelancer accounts have their own flow and do not see
      // the client agreement gate.
      if (accountType === "team") {
        if (!cancelled) setStatus("bypass");
        return;
      }

      // Client path — look up the active agreement row for this user's
      // account membership. Querying by `user_id` is sufficient because
      // a client is bound to one account in `account_members`.
      try {
        const { data: membership } = await supabase
          .from("account_members")
          .select("account_id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled) return;
        const accountId = (membership as { account_id: string } | null)?.account_id ?? null;
        if (!accountId) {
          // No account membership found — treat as needs_signature so
          // they're routed to /contract, which shows the polite
          // "We couldn't load your account" message.
          setStatus("needs_signature");
          return;
        }

        const { data: rows } = await supabase
          .from("agreements")
          .select("id, agreement_version")
          .eq("account_id", accountId)
          .in("agreement_version", SUPPORTED_AGREEMENT_VERSIONS as unknown as string[])
          .limit(1);
        if (cancelled) return;
        setStatus((rows && rows.length > 0) ? "ok" : "needs_signature");
      } catch (err) {
        console.warn("[useAgreementGate] check failed:", err);
        // Fail-open for clients: render the route rather than locking
        // them in a redirect loop on a transient query failure.
        if (!cancelled) setStatus("bypass");
      }
    }

    check();
    return () => { cancelled = true; };
  }, [user, isGhostMode, accountType]);

  return status;
}
