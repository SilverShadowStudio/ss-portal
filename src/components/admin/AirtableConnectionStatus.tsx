import { useState, useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

function AirtableIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="32" height="11" rx="2" fill="currentColor" opacity="0.9"/>
      <rect x="4" y="17" width="14" height="19" rx="2" fill="currentColor" opacity="0.7"/>
      <rect x="22" y="17" width="14" height="19" rx="2" fill="currentColor" opacity="0.5"/>
    </svg>
  );
}
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Status =
  | { state: "loading" }
  | { state: "connected"; recordCount: number; cachedAt: string }
  | { state: "misconfigured" }
  | { state: "error"; message: string };

function timeAgo(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""} ago`;
}

export function AirtableConnectionStatus() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  // Tick every minute to keep relative time fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  async function check(force = false) {
    if (force) setRefreshing(true);
    else setStatus({ state: "loading" });
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const projectId = "oodhsoiwnqxcimzmzick";
      const url = `https://${projectId}.supabase.co/functions/v1/airtable-list-models${
        force ? "?force_refresh=true" : ""
      }`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        if ((data?.error as string)?.includes("secrets not configured")) {
          setStatus({ state: "misconfigured" });
        } else {
          setStatus({ state: "error", message: data?.error ?? `HTTP ${res.status}` });
        }
        return;
      }
      setStatus({ state: "connected", recordCount: data.count ?? 0, cachedAt: data.cachedAt });
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { check(); }, []);

  if (status.state === "loading") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Checking Airtable connection...</span>
      </div>
    );
  }

  if (status.state === "connected") {
    return (
      <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-3">
          <AirtableIcon className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">Airtable Connected</p>
            <p className="text-xs text-muted-foreground">
              {status.recordCount} record{status.recordCount !== 1 ? "s" : ""} · cached{" "}
              {timeAgo(status.cachedAt)}
              <span className="opacity-50 ml-1">
                · {new Date(status.cachedAt).toLocaleString("en-GB")}
              </span>
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => check(true)} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
    );
  }

  if (status.state === "misconfigured") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-gold/20 bg-[#181613] p-4">
        <AirtableIcon className="h-5 w-5 text-gold shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">Airtable Not Configured</p>
          <p className="text-xs text-muted-foreground">
            Set AIRTABLE_PAT, AIRTABLE_BASE_ID, and AIRTABLE_TABLE_ID in Supabase edge function secrets.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/5 p-4">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">Airtable Error</p>
          <p className="text-xs text-muted-foreground">{status.message}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => check(true)} disabled={refreshing}>
        <RefreshCw className={`mr-2 h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
        Retry
      </Button>
    </div>
  );
}
