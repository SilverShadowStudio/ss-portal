// useAgreementGate — decides whether a route should render, redirect to
// /sign-agreement, or redirect away from /sign-agreement, based on the authenticated
// user's role + account + agreement state.
//
// Returns one of:
//   "loading"          — auth or query in flight; render a quiet spinner.
//   "bypass"           — admin / team / ghost-mode; render the route as-is.
//   "ok"               — client has an active agreement; render the route.
//                        (If they're on /sign-agreement, the AgreementGate
//                        component redirects them to /.)
//   "needs_signature"  — client without an active agreement; route to /sign-agreement.
//
// "Active agreement" means a row in `agreements` for the user's account
// with `agreement_version` IN the SUPPORTED_AGREEMENT_VERSIONS set.
// Bumping that constant triggers re-acceptance for all clients with an
// outdated version — see the TODO in App.tsx before doing so.

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { checkAccountAgreementForUser } from "@/lib/agreementStatus";

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

      // Admin users bypass entirely. The `app_role` Postgres enum only
      // contains: admin, client, owner, user, team. `super_admin` is a
      // separate concept handled by the `is_super_admin()` SQL helper +
      // `useIsSuperAdmin` hook (currently unwired per HANDOFF.md); when
      // that's wired into a caller, add it as a second bypass here.
      try {
        const { data: roleRow, error: roleErr } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();
        if (cancelled) return;
        if (roleErr) {
          // Make role-query errors visible. Falling through here would
          // trap an admin on /sign-agreement on the next render — log loudly so
          // a regression is caught in dev tools immediately.
          console.error("[useAgreementGate] role lookup failed:", roleErr);
        }
        if (roleRow) {
          setStatus("bypass");
          return;
        }
      } catch (err) {
        console.error("[useAgreementGate] role lookup threw:", err);
      }

      // Team / freelancer accounts have their own flow and do not see
      // the client agreement gate.
      if (accountType === "team") {
        if (!cancelled) setStatus("bypass");
        return;
      }

      // Client path — single source of truth for account-scoped agreement
      // status (see src/lib/agreementStatus.ts). "no_account" still maps
      // to needs_signature so the user lands on /sign-agreement, which
      // shows the polite "couldn't load your account" message.
      try {
        const result = await checkAccountAgreementForUser(user.id);
        if (cancelled) return;
        setStatus(result === "signed" ? "ok" : "needs_signature");
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
