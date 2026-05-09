import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Notif {
  id: string;
  title: string;
  message: string | null;
  link_path: string | null;
  read_at: string | null;
  created_at: string;
  kind: string;
}

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notif[]>([]);

  async function fetchItems() {
    if (!user) return;
    const { data } = await supabase
      .from("client_notifications")
      .select("id, title, message, link_path, read_at, created_at, kind")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems(data || []);
  }

  useEffect(() => {
    fetchItems();
    if (!user) return;
    const ch = supabase
      .channel("client_notifications_" + user.id)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "client_notifications", filter: `user_id=eq.${user.id}` },
        () => fetchItems(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  const unread = items.filter((n) => !n.read_at).length;

  async function handleClick(n: Notif) {
    if (!n.read_at) {
      await supabase.from("client_notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
    }
    if (n.link_path) navigate(n.link_path);
    fetchItems();
  }

  async function markAllRead() {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    await supabase.from("client_notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    fetchItems();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="fixed right-6 top-6 z-40 flex h-10 w-10 items-center justify-center text-muted-foreground transition-smooth hover:text-gold"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" strokeWidth={1.5} />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gold" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {unread > 0 && (
            <button onClick={markAllRead} className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-gold">
              Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications yet.</div>
        ) : (
          items.map((n) => (
            <DropdownMenuItem
              key={n.id}
              onClick={() => handleClick(n)}
              className={`flex flex-col items-start gap-0.5 py-2 ${!n.read_at ? "bg-muted/40" : ""}`}
            >
              <span className="text-sm font-medium">{n.title}</span>
              {n.message && <span className="text-xs text-muted-foreground">{n.message}</span>}
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {new Date(n.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}