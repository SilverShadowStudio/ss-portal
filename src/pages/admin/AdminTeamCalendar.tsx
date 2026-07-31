import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { TeamCalendar } from "@/components/team/TeamCalendar";

export default function AdminTeamCalendar() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  return (
    <AdminLayout panel>
      <div className="mb-8 animate-fade-in">
        <button onClick={() => navigate("/admin/team")} className="mb-4 inline-flex items-center gap-2 text-xs text-recessive hover:text-standard">
          <ArrowLeft className="h-3.5 w-3.5" /> Team
        </button>
        <div className="flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold text-[#ecd39c]">Team calendar</span>
        </div>
        <p className="mt-3 text-sm text-recessive">Worked days, availability and paid holiday. Approve requests and adjust the allowance.</p>
      </div>
      {accountId && <TeamCalendar accountId={accountId} />}
    </AdminLayout>
  );
}
