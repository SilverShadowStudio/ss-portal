import { AdminLayout } from "@/components/AdminLayout";
import { QuotationsTab } from "@/components/admin/QuotationsTab";

export default function AdminQuotes() {
  return (
    <AdminLayout>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quotes to Clients</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage quotations sent to clients.</p>
        </div>
      </div>

      <QuotationsTab />
    </AdminLayout>
  );
}
