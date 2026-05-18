import { AdminLayout } from "@/components/AdminLayout";
import { AccountList } from "@/components/admin/AccountList";

export default function AdminTeam() {
  return (
    <AdminLayout>
      <AccountList
        title="Team"
        eyebrow="Team Management"
        subtitle="Manage freelancers and team members."
        accountTypes={["team"]}
        addButtonLabel="Add Member"
        showClientCode={false}
        showAccountType={false}
        accountActions={{ delete: true }}
      />
    </AdminLayout>
  );
}
