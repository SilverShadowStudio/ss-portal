import { useState, useEffect } from "react";
import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function DropboxConnectionStatus() {
  const [status, setStatus] = useState<{
    connected: boolean;
    accountId?: string;
    lastUpdated?: string;
    loading: boolean;
  }>({ connected: false, loading: true });
  const [isConnecting, setIsConnecting] = useState(false);
  const { toast } = useToast();

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
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dropbox-api?action=connection-status`,
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

  async function handleConnect() {
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-oauth-start");
      
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
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Checking connection...</span>
      </div>
    );
  }

  if (status.connected) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-3">
          <Cloud className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">Dropbox Connected</p>
            <p className="text-xs text-muted-foreground">
              Last synced: {status.lastUpdated ? new Date(status.lastUpdated).toLocaleString() : "Never"}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={checkConnectionStatus}>
          <RefreshCw className="mr-2 h-3 w-3" />
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-gold/20 bg-gold/5 p-4">
      <div className="flex items-center gap-3">
        <CloudOff className="h-5 w-5 text-gold" />
        <div>
          <p className="text-sm font-medium text-foreground">Dropbox Not Connected</p>
          <p className="text-xs text-muted-foreground">
            Connect your Dropbox to sync project assets
          </p>
        </div>
      </div>
      <Button size="sm" onClick={handleConnect} disabled={isConnecting}>
        {isConnecting ? (
          <>
            <RefreshCw className="mr-2 h-3 w-3 animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <Cloud className="mr-2 h-3 w-3" />
            Connect Dropbox
          </>
        )}
      </Button>
    </div>
  );
}
