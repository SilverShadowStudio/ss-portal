import { useCallback, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { TeamCalendar } from "@/components/team/TeamCalendar";

export default function AdminTeamCalendar() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  // A freelancer has no paid holiday and no approvals — so the header shouldn't
  // promise either. Worded once the calendar tells us who this is.
  const [employmentType, setEmploymentType] = useState<string | null>(null);
  const onLoaded = useCallback((i: { employmentType: string | null }) => setEmploymentType(i.employmentType), []);
  const isFreelancer = employmentType !== null && employmentType !== "employee";
  return (
    <AdminLayout panel panelClassName="ssr-panel--team">
      <div className="mb-8 animate-fade-in">
        <button onClick={() => navigate("/admin/team")} className="mb-4 inline-flex items-center gap-2 text-xs text-recessive hover:text-standard">
          <ArrowLeft className="h-3.5 w-3.5" /> Team
        </button>
        <div className="flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold text-[#ecd39c]">Team calendar</span>
        </div>
        <p className="mt-3 text-sm text-recessive">
          {isFreelancer
            ? "A record of the days worked across the year, and the days set aside as unavailable."
            : "Worked days, availability and paid holiday. Approve requests and adjust the allowance."}
        </p>
      </div>
      {accountId && <TeamCalendar accountId={accountId} onLoaded={onLoaded} />}
    </AdminLayout>
  );
}
