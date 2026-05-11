import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { format } from "date-fns";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";

interface ActivityRow {
  id: string;
  created_at: string;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  description: string;
  project_name: string | null;
  scene_name: string | null;
  round_number: number | null;
}

const actionLabel: Record<string, string> = {
  project_created: "Project",
  scene_created: "Scene",
  round_created: "Round",
  round_delivered: "Delivery",
  asset_uploaded: "Upload",
  asset_deleted: "Removed",
  asset_approved: "Approved",
  revision_requested: "Revision",
  scene_status_changed: "Status",
};

export default function AdminActivity() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("activity_log")
        .select(
          "id, created_at, actor_name, actor_role, action, description, project_name, scene_name, round_number",
        )
        .order("created_at", { ascending: false })
        .limit(1000);
      setRows((data ?? []) as ActivityRow[]);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <AdminLayout>
      <div className="mb-10 animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold">Studio Records</span>
        </div>
        <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4">
          ACTIVITY LOG
        </h1>
        <p className="text-sm text-muted-foreground">
          Complete, immutable history of production-critical actions.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm p-6 md:p-8 animate-fade-in">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground tracking-wider">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <Clock className="h-5 w-5 text-muted-foreground/30 mx-auto mb-3" />
            <p className="font-serif text-base text-muted-foreground">No activity recorded yet</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
              >
                <span className="mt-1 inline-flex h-5 min-w-[68px] items-center justify-center rounded bg-muted/60 px-2 text-[9px] font-bold tracking-[0.18em] uppercase text-muted-foreground">
                  {actionLabel[row.action] ?? row.action}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{row.description}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {row.actor_name ?? "Unknown"}
                    {row.actor_role ? ` · ${row.actor_role}` : ""}
                    {row.project_name ? ` · ${row.project_name}` : ""}
                    {row.scene_name ? ` · ${row.scene_name}` : ""}
                    {row.round_number != null
                      ? ` · Round ${String(row.round_number).padStart(2, "0")}`
                      : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] tracking-[0.15em] uppercase text-muted-foreground">
                  {format(new Date(row.created_at), "d MMM yyyy · HH:mm")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminLayout>
  );
}