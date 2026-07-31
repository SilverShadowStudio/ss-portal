import { ClientLayout } from "@/components/ClientLayout";
import { TeamCalendar } from "@/components/team/TeamCalendar";

export default function Calendar() {
  return (
    <ClientLayout panel>
      <div className="mb-8 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold text-[#ecd39c]">Calendar</span>
        </div>
        <p className="mt-3 text-sm text-recessive">Your worked days, availability and paid holiday. Request days off for approval.</p>
      </div>
      <TeamCalendar />
    </ClientLayout>
  );
}
