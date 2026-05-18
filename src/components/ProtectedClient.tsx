// ProtectedClient — the standard wrapper for authenticated client-facing
// routes. Combines `ProtectedRoute` (redirects unauthenticated users to
// /auth) with `AgreementGate` (routes clients without an active v3
// agreement to /contract, and clients with an active agreement away from
// /contract). Admin / super_admin / team / ghost-mode all bypass the
// agreement check — see `useAgreementGate` for the bypass rules.
//
// Admin routes use `AdminProtectedRoute` and do NOT compose this wrapper.
// They bypass the agreement gate anyway by virtue of the admin role check,
// and skipping the gate avoids adding a per-navigation Supabase round-trip
// to every admin page.

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AgreementGate } from "@/components/AgreementGate";

export function ProtectedClient({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AgreementGate>{children}</AgreementGate>
    </ProtectedRoute>
  );
}
