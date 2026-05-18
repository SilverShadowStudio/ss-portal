// AgreementGate — wraps client-facing routes so that authenticated clients
// without an active v3 agreement are routed to /sign-agreement, and clients
// who already have an active agreement are routed away from /sign-agreement.
// Admins, super_admins, team accounts, and ghost mode all bypass.
//
// Note on routing: the canonical URL is `/sign-agreement` — that's what
// invite emails, password-setup redirects, and the legacy v2.1 gate in
// ProtectedRoute all already point to. The /contract route (used during
// v3 development) is preserved as a Navigate→/sign-agreement so any stray
// internal links still resolve.
//
// TODO (re-acceptance for outdated agreement versions): not yet built.
// When SSS-CA-PROJECT-v3.1 (or any later version) ships, bumping
// `SUPPORTED_AGREEMENT_VERSIONS` in src/lib/agreements/ will cause every
// client whose stored `agreement_version` is no longer in that set to be
// routed back to /sign-agreement. The current Contract.tsx attempts to
// insert a new agreements row and the `handleV3Acceptance` edge function
// rejects duplicate-acceptance with a 409. Build a re-acceptance variant
// of Contract.tsx (that allows replacing the existing row or appending a
// new version while marking the previous one superseded) before bumping
// the constant.

import { Navigate, useLocation } from "react-router-dom";
import { useAgreementGate } from "@/hooks/useAgreementGate";
import { BrandLoader } from "@/components/ui/BrandLoader";

export function AgreementGate({ children }: { children: React.ReactNode }) {
  const status = useAgreementGate();
  const location = useLocation();
  const onSignAgreement = location.pathname === "/sign-agreement";

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <BrandLoader size="lg" />
      </div>
    );
  }

  if (status === "needs_signature" && !onSignAgreement) {
    return <Navigate to="/sign-agreement" replace />;
  }

  if (status === "ok" && onSignAgreement) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
