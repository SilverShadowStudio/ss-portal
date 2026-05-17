import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, hasSignedAgreement, hasFreelancerProfile, accountType, isGhostMode } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    // Preserve the original URL (pathname + search) so a deep-link email
    // click survives the login round-trip. Auth.tsx reads state.from after
    // successful sign-in and redirects there instead of the default home.
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  // Ghost mode: admin viewing as client — skip all client gates
  if (!isGhostMode) {
    if (hasSignedAgreement === null) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
        </div>
      );
    }
    if (hasSignedAgreement === false && location.pathname !== "/sign-agreement") {
      return <Navigate to="/sign-agreement" replace />;
    }

    // Team users must complete onboarding before accessing any protected page.
    if (accountType === 'team') {
      if (hasFreelancerProfile === null) {
        return (
          <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
          </div>
        );
      }
      if (hasFreelancerProfile === false && location.pathname !== "/onboarding") {
        return <Navigate to="/onboarding" replace />;
      }
    }
  }

  return <>{children}</>;
}
