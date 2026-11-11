import { ClientLayout } from "@/components/ClientLayout";
import { TeamHours } from "@/components/team/TeamHours";

// A member paid by the hour logs her time here (Isabella, Nov 2026). The page
// is only in the menu for members an admin has given weekly hours.
export default function Hours() {
  return (
    <ClientLayout panel>
      <div className="mb-8 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold text-[#ecd39c]">Hours</span>
        </div>
        <p className="mt-3 text-sm text-recessive">
          Log the hours you work. Up to your weekly hours they go straight through; anything above goes to Fred for approval. Approved hours are invoiced to you on the 1st of the month.
        </p>
      </div>
      <TeamHours />
    </ClientLayout>
  );
}
