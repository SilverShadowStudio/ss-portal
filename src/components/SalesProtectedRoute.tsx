import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useUserRole } from "@/hooks/useUserRole";
import { BrandLoader } from "@/components/ui/BrandLoader";

/**
 * Gate for the Sales pages only: admins, sales managers and sales reps.
 * Everything else under /admin stays behind AdminProtectedRoute, so a rep
 * who types /admin/finance into the address bar is sent home.
 * The database applies the same split independently (owner-scoped RLS).
 */
export function SalesProtectedRoute({ children }: { children: ReactNode }) {
  const { canUseSales, loading } = useUserRole();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <BrandLoader size="lg" />
      </div>
    );
  }

  if (!canUseSales) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
