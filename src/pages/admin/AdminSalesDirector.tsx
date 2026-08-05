import { AdminLayout } from "@/components/AdminLayout";
import { DirectorChat } from "@/components/admin/sales/DirectorChat";

export default function AdminSalesDirector() {
  return (
    <AdminLayout panel panelClassName="ssr-panel--sales">
      <DirectorChat variant="page" />
    </AdminLayout>
  );
}
