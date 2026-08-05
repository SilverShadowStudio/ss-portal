import { AdminLayout } from "@/components/AdminLayout";
import { CLIENT_ACCOUNT_TYPES } from "@/lib/accountTypes";
import { AccountList } from "@/components/admin/AccountList";

export default function AdminClients() {
  return (
    <AdminLayout panel panelClassName="ssr-panel--client">
      <AccountList
        title="Clients"
        eyebrow="Client Management"
        subtitle="Manage all studio clients and their access."
        accountTypes={[...CLIENT_ACCOUNT_TYPES]}
        addButtonLabel="Add Client"
        showClientCode
        showAccountType
        headerNavigatesToProjects
        accountActions={{ editProfile: true, delete: true }}
      />
    </AdminLayout>
  );
}
