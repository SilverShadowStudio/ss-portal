import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, hasSignedAgreement, isGhostMode } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Ghost mode: admin viewing as client — skip agreement gate
  if (!isGhostMode) {
    if (hasSignedAgreement === null) {
      // Still loading agreement status
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
        </div>
      );
    }
    if (hasSignedAgreement === false && location.pathname !== "/sign-agreement") {
      return <Navigate to="/sign-agreement" replace />;
    }
  }

  return <>{children}</>;
}
