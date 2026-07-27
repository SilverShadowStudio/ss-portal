import { AdminLayout } from "@/components/AdminLayout";
import { AccountList } from "@/components/admin/AccountList";

export default function AdminClients() {
  return (
    <AdminLayout panel>
      <AccountList
        title="Clients"
        eyebrow="Client Management"
        subtitle="Manage all studio clients and their access."
        accountTypes={["partnership", "project"]}
        addButtonLabel="Add Client"
        showClientCode
        showAccountType
        headerNavigatesToProjects
        accountActions={{ editProfile: true, delete: true }}
      />
    </AdminLayout>
  );
}
