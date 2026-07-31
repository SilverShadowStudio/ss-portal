import { useState, useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

// Revolut "R" monogram — simple rounded-square glyph, no trademarked artwork.
function RevolutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="36" height="36" rx="9" fill="currentColor" opacity="0.14" />
      <path
        d="M14 11h8.2c3.5 0 6 2.3 6 5.7 0 2.7-1.6 4.7-4 5.4L29 29h-4.2l-4.4-6.3H18V29h-4V11zm4 3.3v5.1h4c1.7 0 2.8-1 2.8-2.6 0-1.6-1.1-2.5-2.8-2.5H18z"
        fill="currentColor"
      />
    </svg>
  );
}

// bank_transactions isn't in the generated Supabase types — cast like AdminReconcile.
/* eslint-disable @typescript-eslint/no-explicit-any */
const sb = supabase as any;

type Status =
  | { state: "loading" }
  | { state: "connected"; count: number; latest: string | null }
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

export function RevolutConnectionStatus() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [syncing, setSyncing] = useState(false);

  // Tick every minute to keep relative time fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  async function load() {
    try {
      const countRes = await sb.from("bank_transactions").select("id", { count: "exact", head: true });
      if (countRes.error) throw new Error("Could not read bank transactions");
      const latestRes = await sb
        .from("bank_transactions")
        .select("date_completed")
        .order("date_completed", { ascending: false })
        .limit(1)
        .maybeSingle();
      setStatus({ state: "connected", count: countRes.count ?? 0, latest: latestRes.data?.date_completed ?? null });
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "Unknown error" });
    }
  }

  useEffect(() => { load(); }, []);

  async function sync() {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("revolut-sync");
      if (error) throw error;
      await load();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "Sync failed" });
    } finally {
      setSyncing(false);
    }
  }

  if (status.state === "loading") {
    return (
      <div className="ssr-tile flex items-center gap-3 px-4 py-3">
        <BrandLoader size="sm" />
        <span className="text-sm text-[var(--text-label)]">Checking Revolut connection...</span>
      </div>
    );
  }

  if (status.state === "connected") {
    return (
      <div className="ssr-tile flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <RevolutIcon className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium text-standard">Revolut Connected</p>
            <p className="text-xs text-[var(--text-label)]">
              {status.count} transaction{status.count !== 1 ? "s" : ""}
              {status.latest && (
                <>
                  {" "}· last {timeAgo(status.latest)}
                  <span className="opacity-50 ml-1">· {new Date(status.latest).toLocaleDateString("en-GB")}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 rounded px-2.5 text-xs border-0 bg-gold/20 text-[#ecd39c] hover:bg-gold/30 hover:text-[#ecd39c]"
          onClick={sync}
          disabled={syncing}
        >
          {syncing ? <BrandLoader size="sm" className="mr-2 h-3 w-3" /> : <RefreshCw className="mr-2 h-3 w-3" />}
          {syncing ? "Syncing…" : "Sync"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0" />
        <div>
          <p className="text-sm font-medium text-standard">Revolut Error</p>
          <p className="text-xs text-[var(--text-label)]">{status.message}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
        {syncing ? <BrandLoader size="sm" className="mr-2 h-3 w-3" /> : <RefreshCw className="mr-2 h-3 w-3" />}
        Retry
      </Button>
    </div>
  );
}
