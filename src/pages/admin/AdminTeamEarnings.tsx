import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { EarningsView, type EarningsData } from "@/components/EarningsView";
import { supabase } from "@/integrations/supabase/client";

// Admin-only, read-only copy of a team member's Earnings page. Reuses the same
// view the member sees on their portal; data comes from freelancer-earnings with
// the admin { accountId } override.
export default function AdminTeamEarnings() {
  const { accountId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const memberName = params.get("name");
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    supabase.functions.invoke("freelancer-earnings", { body: { accountId } }).then(({ data, error }) => {
      if (error) setError(error.message);
      else setData(data as EarningsData);
      setLoading(false);
    });
  }, [accountId]);

  return (
    <AdminLayout panel panelClassName="ssr-panel--team">
      <button onClick={() => navigate("/admin/team")} className="mb-4 inline-flex items-center gap-2 text-xs text-recessive hover:text-standard">
        <ArrowLeft className="h-3.5 w-3.5" /> Team
      </button>
      <EarningsView data={data} loading={loading} error={error} nameOverride={memberName ?? data?.name ?? null} />
    </AdminLayout>
  );
}
