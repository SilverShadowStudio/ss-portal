import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, FolderKanban, Image, Clock } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DropboxConnectionStatus } from "@/components/admin/DropboxConnectionStatus";
import { AirtableConnectionStatus } from "@/components/admin/AirtableConnectionStatus";
import { RevolutConnectionStatus } from "@/components/admin/RevolutConnectionStatus";
import { ActivityLogPreview } from "@/components/admin/ActivityLogPreview";

interface DashboardStats {
  activeClients: number;
  activeProjects: number;
  totalScenes: number;
  pendingReviews: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    activeClients: 0,
    activeProjects: 0,
    totalScenes: 0,
    pendingReviews: 0,
  });
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        // Client accounts (companies), excluding ones owned by admin staff —
        // same source as the Clients page.
        const { data: accounts } = await supabase
          .from("accounts")
          .select("owner_user_id");
        const { data: adminRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");
        const adminIds = new Set((adminRoles ?? []).map((r) => r.user_id));
        const clientAccounts = (accounts ?? []).filter(
          (a) => !adminIds.has(a.owner_user_id),
        );

        // Fetch all projects
        const { data: projects } = await supabase
          .from("projects")
          .select("id, name, status, user_id, created_at");

        const activeProjects = projects?.filter(p => p.status === "active").length || 0;

        // Active clients = clients we're in production with right now, i.e. those
        // who own at least one active project.
        const activeClientIds = new Set(
          (projects ?? []).filter((p) => p.status === "active").map((p) => p.user_id),
        );
        const activeClients = clientAccounts.filter(
          (a) => activeClientIds.has(a.owner_user_id),
        ).length;

        // Fetch all scenes
        const { data: scenes } = await supabase
          .from("scenes")
          .select("id, name, status, project_id");

        const pendingReviews = scenes?.filter(s => s.status === "delivered").length || 0;

        setStats({
          activeClients,
          activeProjects,
          totalScenes: scenes?.length || 0,
          pendingReviews,
        });
      } catch (error) {
        console.error("Error fetching admin dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  // Best-effort reservation-expiry sweep on admin dashboard load (non-blocking).
  // Kept in its own effect keyed on the session: the function requires a
  // signed-in caller, and supabase-js restores the session asynchronously, so
  // firing on bare mount would 401 into the empty catch and skip the sweep.
  useEffect(() => {
    if (!user) return;
    supabase.functions.invoke("expire-reservations").catch(() => {});
  }, [user]);

  const statCards = [
    { label: "Active Clients", value: stats.activeClients, icon: Users, link: "/admin/clients" },
    { label: "Active Projects", value: stats.activeProjects, icon: FolderKanban, link: "/admin/projects" },
    { label: "Total Scenes", value: stats.totalScenes, icon: Image, link: "/admin/scenes" },
    { label: "Pending Reviews", value: stats.pendingReviews, icon: Clock, link: "/admin/scenes" },
  ];

  return (
    <AdminLayout panel>
      {/* Header — breadcrumb only. The H1 + subtitle were removed (the metrics
          are self-evident); the breadcrumb is now the visible page label and
          the browser tab <title> remains the document-level label. Spacing
          tightened so the metric row sits where the H1 used to. */}
      <div className="mb-8 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold text-[#ecd39c]">Studio Overview</span>
        </div>
      </div>

      {/* Status Overview — metrics as tiles inside a zone. Same labels + values. */}
      <div className="mb-4 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <div className="ssr-zone">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px w-6 bg-gold-muted" />
            <h2 className="text-label">At a Glance</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {statCards.map((stat) => (
              <Link key={stat.label} to={stat.link} className="ssr-tile ssr-tile-hover block p-5 transition-smooth">
                <p className="text-label mb-3">{stat.label}</p>
                <span className="font-serif text-4xl font-medium text-strong">
                  {loading ? "..." : stat.value.toString().padStart(2, '0')}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Activity Log Preview — click a line to dismiss; title to open full log */}
      <ActivityLogPreview />

      {/* Integration Status — connection panels at the bottom so they recede. */}
      <div className="mb-4 animate-fade-in" style={{ animationDelay: "0.15s" }}>
        <div className="ssr-zone">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-px w-6 bg-gold-muted" />
            <h2 className="text-label">Connections</h2>
          </div>
          <div className="flex flex-col gap-3">
            <DropboxConnectionStatus />
            <AirtableConnectionStatus />
            <RevolutConnectionStatus />
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
