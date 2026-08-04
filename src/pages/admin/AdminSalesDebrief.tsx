import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { DebriefSheet } from "@/components/admin/sales/DebriefSheet";
import { supabase } from "@/integrations/supabase/client";

// Direct route to a lead's debrief — /admin/sales/:leadId/debrief. The sheet is
// also opened inline from the Sales table; this exists so a debrief is reachable
// from a link (e.g. straight off a phone, between calls).
export default function AdminSalesDebrief() {
  const { leadId } = useParams();
  const navigate = useNavigate();

  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead", leadId],
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads").select("id, company, stage, contact_name")
        .eq("id", leadId!).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  return (
    <AdminLayout panel panelClassName="ssr-panel--sales">
      <button onClick={() => navigate("/admin/sales")} className="mb-4 inline-flex items-center gap-2 text-xs text-recessive hover:text-standard">
        <ArrowLeft className="h-3.5 w-3.5" /> Sales
      </button>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><BrandLoader size="md" /></div>
      ) : !lead ? (
        <div className="ssr-zone"><div className="ssr-tile p-10 text-center text-recessive text-sm">Lead not found.</div></div>
      ) : (
        <DebriefSheet leadId={lead.id} company={lead.company} onClose={() => navigate("/admin/sales")} />
      )}
    </AdminLayout>
  );
}
