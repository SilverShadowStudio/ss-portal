import { useCallback, useState } from "react";
import { ClientLayout } from "@/components/ClientLayout";
import { TeamCalendar } from "@/components/team/TeamCalendar";

export default function Calendar() {
  // Freelancers have no paid holiday and nothing to request approval for — the
  // header shouldn't offer either. Worded once the calendar knows who they are.
  const [employmentType, setEmploymentType] = useState<string | null>(null);
  const onLoaded = useCallback((i: { employmentType: string | null }) => setEmploymentType(i.employmentType), []);
  const isFreelancer = employmentType !== null && employmentType !== "employee";

  return (
    <ClientLayout panel>
      <div className="mb-8 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold text-[#ecd39c]">Calendar</span>
        </div>
        <p className="mt-3 text-sm text-recessive">
          {isFreelancer
            ? "A record of your days worked across the year. Do mark any days you'd rather we didn't count on you."
            : "Your worked days, availability and paid holiday. Request days off for approval."}
        </p>
      </div>
      <TeamCalendar onLoaded={onLoaded} />
    </ClientLayout>
  );
}
