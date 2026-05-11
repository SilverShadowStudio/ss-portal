import { AdminLayout } from "@/components/AdminLayout";
import { AirtableProductionTable } from "@/components/admin/AirtableProductionTable";

export default function AdminProductionTracker() {
  return (
    <AdminLayout>
      <div className="mb-10 animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold">Airtable</span>
        </div>
        <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4">
          PRODUCTION TRACKER
        </h1>
        <p className="text-sm text-muted-foreground">
          Live model status from Kieran's Airtable. Cached for 5 minutes.
        </p>
      </div>

      <div className="animate-fade-in" style={{ animationDelay: "0.05s" }}>
        <AirtableProductionTable />
      </div>
    </AdminLayout>
  );
}
