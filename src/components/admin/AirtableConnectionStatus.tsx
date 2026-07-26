import { useState, useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";

function AirtableIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.849 11.12c-0.008-0-0.018-0.001-0.029-0.001-0.223 0-0.425 0.091-0.571 0.238l-0 0c-0.141 0.126-0.234 0.304-0.245 0.504l-0 0.002v10.441c0.024 0.42 0.371 0.751 0.794 0.751 0.124 0 0.241-0.028 0.345-0.079l-0.005 0.002 8.219-3.94 3.71-1.794c0.246-0.125 0.411-0.376 0.411-0.666 0-0.319-0.2-0.591-0.482-0.697l-0.005-0.002-11.884-4.706c-0.076-0.033-0.165-0.053-0.258-0.055l-0.001-0zM30.246 11.071c-0.1 0.001-0.195 0.021-0.282 0.058l0.005-0.002-12.511 4.845c-0.28 0.117-0.474 0.388-0.475 0.705v11.117c0.004 0.411 0.338 0.743 0.75 0.743 0.099 0 0.194-0.019 0.281-0.055l-0.005 0.002 12.513-4.861c0.28-0.106 0.475-0.372 0.475-0.683 0-0.002 0-0.004-0-0.006v0-11.117c-0.003-0.412-0.337-0.745-0.75-0.745 0 0 0 0-0 0v0zM15.99 3.461c-0.577 0-1.127 0.118-1.627 0.331l0.027-0.010-11.163 4.616c-0.274 0.116-0.463 0.383-0.463 0.694 0 0.317 0.196 0.588 0.473 0.699l0.005 0.002 11.224 4.446c0.454 0.189 0.981 0.299 1.533 0.299s1.080-0.11 1.56-0.309l-0.027 0.010 11.224-4.446c0.28-0.115 0.473-0.385 0.473-0.7 0-0.31-0.187-0.576-0.453-0.692l-0.005-0.002-11.193-4.616c-0.468-0.203-1.012-0.321-1.584-0.321-0.002 0-0.004 0-0.006 0h0z" />
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
      <div className="ssr-tile flex items-center gap-3 px-4 py-3">
        <BrandLoader size="sm" />
        <span className="text-sm text-[var(--text-label)]">Checking Airtable connection...</span>
      </div>
    );
  }

  if (status.state === "connected") {
    return (
      <div className="ssr-tile flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <AirtableIcon className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium text-standard">Airtable Connected</p>
            <p className="text-xs text-[var(--text-label)]">
              {status.recordCount} record{status.recordCount !== 1 ? "s" : ""} · cached{" "}
              {timeAgo(status.cachedAt)}
              <span className="opacity-50 ml-1">
                · {new Date(status.cachedAt).toLocaleString("en-GB")}
              </span>
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-7 rounded px-2.5 text-xs border-0 bg-gold/20 text-[#ecd39c] hover:bg-gold/30 hover:text-[#ecd39c]" onClick={() => check(true)} disabled={refreshing}>
          {refreshing ? <BrandLoader size="sm" className="mr-2 h-3 w-3" /> : <RefreshCw className="mr-2 h-3 w-3" />}
          Refresh
        </Button>
      </div>
    );
  }

  if (status.state === "misconfigured") {
    return (
      <div className="ssr-tile flex items-center gap-3 px-4 py-3">
        <AirtableIcon className="h-5 w-5 shrink-0 text-gold" />
        <div>
          <p className="text-sm font-medium text-standard">Airtable Not Configured</p>
          <p className="text-xs text-[var(--text-label)]">
            Set AIRTABLE_PAT, AIRTABLE_BASE_ID, and AIRTABLE_TABLE_ID in Supabase edge function secrets.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0" />
        <div>
          <p className="text-sm font-medium text-standard">Airtable Error</p>
          <p className="text-xs text-[var(--text-label)]">{status.message}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => check(true)} disabled={refreshing}>
        {refreshing ? <BrandLoader size="sm" className="mr-2 h-3 w-3" /> : <RefreshCw className="mr-2 h-3 w-3" />}
        Retry
      </Button>
    </div>
  );
}
