import { AdminLayout } from "@/components/AdminLayout";
import { AirtableProductionTable } from "@/components/admin/AirtableProductionTable";

export default function AdminProductionTracker() {
  return (
    <AdminLayout>
      <div className="mb-10 animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-12 bg-gold" />
          <span className="text-label-gold">Production</span>
        </div>
        <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4">
          PRODUCTION TRACKER
        </h1>
        <p className="text-sm text-muted-foreground">
          Live view of model production status synced from Airtable.
        </p>
      </div>

      <div className="animate-fade-in" style={{ animationDelay: "0.05s" }}>
        <AirtableProductionTable />
      </div>
    </AdminLayout>
  );
}
