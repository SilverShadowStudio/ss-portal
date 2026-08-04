import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, isGhostModeActive } from "@/contexts/AuthContext";

// While the portal tab is open and visible, upsert the signed-in user's
// last_seen_at every ~45s. Admins read user_presence to show a live "Active"
// badge (presence within ~90s = online). Never pings while impersonating.
const HEARTBEAT_MS = 45_000;

export function usePresenceHeartbeat() {
  const { user, isGhostMode } = useAuth();

  useEffect(() => {
    if (!user || isGhostMode || isGhostModeActive()) return;
    const uid = user.id;

    const ping = () => {
      if (document.visibilityState !== "visible" || isGhostModeActive()) return;
      supabase
        .from("user_presence")
        .upsert({ user_id: uid, last_seen_at: new Date().toISOString() })
        .then(() => {}, () => {});
    };

    ping();
    const iv = setInterval(ping, HEARTBEAT_MS);
    const onVisible = () => { if (document.visibilityState === "visible") ping(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, isGhostMode]);
}
