import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";

function DropboxIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 5L4 10.5l8 5.5 8-5.5L12 5z" fill="currentColor"/>
      <path d="M28 5l-8 5.5 8 5.5 8-5.5L28 5z" fill="currentColor"/>
      <path d="M4 21.5L12 27l8-5.5-8-5.5-8 5.5z" fill="currentColor"/>
      <path d="M28 16l-8 5.5 8 5.5 8-5.5L28 16z" fill="currentColor"/>
      <path d="M12 28.5l8 5.5 8-5.5-8-5.5-8 5.5z" fill="currentColor"/>
    </svg>
  );
}
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

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

export function DropboxConnectionStatus() {
  const [status, setStatus] = useState<{
    connected: boolean;
    accountId?: string;
    lastUpdated?: string;
    loading: boolean;
  }>({ connected: false, loading: true });
  const [lastAssetAt, setLastAssetAt] = useState<string | null | undefined>(undefined);
  const [isConnecting, setIsConnecting] = useState(false);
  const { toast } = useToast();

  // Tick every minute to keep relative time fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    supabase
      .from("round_assets")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setLastAssetAt(data?.created_at ?? null));
  }, []);

  useEffect(() => {
    checkConnectionStatus();

    // Check for OAuth callback results
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("dropbox_connected") === "true") {
      toast({
        title: "Dropbox Connected",
        description: "Your Dropbox account has been linked successfully.",
      });
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
      checkConnectionStatus();
    }
    if (urlParams.get("dropbox_error")) {
      const error = urlParams.get("dropbox_error");
      toast({
        title: "Connection Failed",
        description: `Failed to connect Dropbox: ${error}`,
        variant: "destructive",
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function checkConnectionStatus() {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/dropbox-api?action=connection-status`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({}),
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        setStatus({
          connected: data.connected,
          accountId: data.accountId,
          lastUpdated: data.lastUpdated,
          loading: false,
        });
      } else {
        setStatus({ connected: false, loading: false });
      }
    } catch (error) {
      console.error("Error checking Dropbox status:", error);
      setStatus({ connected: false, loading: false });
    }
  }

  async function handleConnect(reconnect = false) {
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-oauth-start", {
        body: { reconnect },
      });

      if (error) throw error;

      if (data?.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (error) {
      console.error("Error starting OAuth:", error);
      toast({
        title: "Connection Error",
        description: "Failed to start Dropbox authorization.",
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  }

  if (status.loading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <BrandLoader size="sm" />
        <span className="text-sm text-[var(--text-label)]">Checking connection...</span>
      </div>
    );
  }

  if (status.connected) {
    return (
      <div className="ssr-tile flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <DropboxIcon className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium text-standard">Dropbox Connected</p>
            <p className="text-xs text-[var(--text-label)]">
              {lastAssetAt === undefined
                ? null
                : lastAssetAt
                  ? <>Last file updated {timeAgo(lastAssetAt)}</>
                  : "No files received yet"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={checkConnectionStatus}>
            <RefreshCw className="mr-2 h-3 w-3" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleConnect(true)} disabled={isConnecting}>
            {isConnecting ? (
              <>
                <BrandLoader size="sm" className="mr-2 h-3 w-3" />
                Reconnecting...
              </>
            ) : (
              <>
                <DropboxIcon className="mr-2 h-3 w-3" />
                Reconnect
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-gold/20 bg-[#181613] px-4 py-3">
      <div className="flex items-center gap-3">
        <DropboxIcon className="h-5 w-5 text-gold" />
        <div>
          <p className="text-sm font-medium text-standard">Dropbox Not Connected</p>
          <p className="text-xs text-[var(--text-label)]">
            Connect your Dropbox to sync project assets
          </p>
        </div>
      </div>
      <Button size="sm" onClick={handleConnect} disabled={isConnecting}>
        {isConnecting ? (
          <>
            <BrandLoader size="sm" className="mr-2 h-3 w-3" />
            Connecting...
          </>
        ) : (
          <>
            <DropboxIcon className="mr-2 h-3 w-3" />
            Connect Dropbox
          </>
        )}
      </Button>
    </div>
  );
}
