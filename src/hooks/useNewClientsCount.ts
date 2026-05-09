import { useEffect, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Counts accounts created after the admin's last visit to /admin/clients.
 * The "last seen" timestamp is stored per-admin in localStorage and is
 * cleared (set to now) whenever the admin lands on /admin/clients.
 */
export function useNewClientsCount() {
  const { user } = useAuth();
  const location = useLocation();
  const [count, setCount] = useState(0);

  const storageKey = user ? `admin:lastClientsSeenAt:${user.id}` : null;

  const refresh = useCallback(async () => {
    if (!storageKey) {
      setCount(0);
      return;
    }
    // Default baseline = "now" the very first time, so existing clients
    // don't all show up as "new".
    let lastSeen = localStorage.getItem(storageKey);
    if (!lastSeen) {
      lastSeen = new Date().toISOString();
      localStorage.setItem(storageKey, lastSeen);
    }
    const { count: newCount, error } = await supabase
      .from("accounts")
      .select("id", { count: "exact", head: true })
      .gt("created_at", lastSeen);
    if (!error) setCount(newCount ?? 0);
  }, [storageKey]);

  // Mark as seen whenever the admin visits the clients page.
  useEffect(() => {
    if (!storageKey) return;
    if (location.pathname.startsWith("/admin/clients")) {
      localStorage.setItem(storageKey, new Date().toISOString());
      setCount(0);
    }
  }, [location.pathname, storageKey]);

  // Initial fetch + light polling so the badge appears without a refresh.
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Realtime: instant bump when a new account row is inserted.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("admin-new-accounts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "accounts" },
        () => refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, refresh]);

  return count;
}