import { useState } from "react";
import { Settings } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { AccountList } from "@/components/admin/AccountList";
import { TemplateManagementModal } from "@/components/admin/TemplateManagementModal";

export default function AdminTeam() {
  const [templatesOpen, setTemplatesOpen] = useState(false);

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
        headerActions={
          <button
            type="button"
            onClick={() => setTemplatesOpen(true)}
            title="Contract templates"
            className="p-2 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <Settings className="h-4 w-4" />
          </button>
        }
      />
      <TemplateManagementModal open={templatesOpen} onOpenChange={setTemplatesOpen} />
    </AdminLayout>
  );
}
