import { useState, useEffect } from "react";
import { RefreshCw, Link2, Settings, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface AirtableConfig {
  projects_table: string;
  scenes_table: string;
  field_scene_name: string;
  field_project_name: string;
  field_status: string;
  field_delivery_date: string;
  field_round: string;
  field_portal_scene_id: string;
  status_in_production: string;
  status_awaiting_review: string;
  status_approved: string;
  status_delivered: string;
}

const DEFAULT_CONFIG: AirtableConfig = {
  projects_table: "",
  scenes_table: "",
  field_scene_name: "Name",
  field_project_name: "Project",
  field_status: "Status",
  field_delivery_date: "Delivery Date",
  field_round: "Round",
  field_portal_scene_id: "Portal Scene ID",
  status_in_production: "In Progress",
  status_awaiting_review: "Awaiting Review",
  status_approved: "Approved",
  status_delivered: "Delivered",
};

interface AirtableSyncPanelProps {
  sceneId?: string;
  sceneName?: string;
  onSynced?: () => void;
}

export function AirtableSyncPanel({ sceneId, sceneName, onSynced }: AirtableSyncPanelProps) {
  const { toast } = useToast();
  const [config, setConfig] = useState<AirtableConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  async function fetchConfig() {
    try {
      const { data, error } = await supabase.functions.invoke("airtable-sync", {
        body: { action: "get-config" },
      });
      if (!error && data?.config) {
        setConfig({ ...DEFAULT_CONFIG, ...data.config });
      }
    } catch {
      // Use defaults
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("airtable-sync", {
        body: { action: "set-config", config },
      });
      if (error) throw error;
      toast({ title: "Configuration saved." });
      setShowConfig(false);
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function pushScene() {
    if (!sceneId) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("airtable-sync", {
        body: { action: "push-scene", sceneId },
      });
      if (error) throw error;
      toast({ title: "Pushed to Airtable", description: `Record ${data.airtableId}` });
      onSynced?.();
    } catch (e: any) {
      toast({ title: "Sync failed", description: e?.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  async function pullStatus() {
    if (!sceneId) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("airtable-sync", {
        body: { action: "pull-status", sceneId },
      });
      if (error) throw error;
      toast({
        title: "Status pulled from Airtable",
        description: `Airtable: "${data.airtableStatus}" → Portal: "${data.portalStatus || "unchanged"}"`,
      });
      onSynced?.();
    } catch (e: any) {
      toast({ title: "Pull failed", description: e?.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  const inputCls = "w-full bg-transparent border-b border-border/50 py-1.5 text-sm text-foreground focus:outline-none focus:border-gold transition-colors placeholder:text-foreground/25";
  const labelCls = "block text-[9px] uppercase tracking-[0.26em] text-foreground/40 mb-1";

  if (loading) return null;

  return (
    <div className="space-y-3">
      {/* Scene sync actions */}
      {sceneId && (
        <div className="flex items-center gap-2">
          <button
            onClick={pushScene}
            disabled={syncing || !config.scenes_table}
            className="flex items-center gap-1.5 font-sans uppercase text-foreground/50 hover:text-foreground transition-colors disabled:opacity-30"
            style={{ fontSize: 9, letterSpacing: "0.22em" }}
            title={!config.scenes_table ? "Configure Airtable table first" : "Push scene to Airtable"}
          >
            {syncing ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <Link2 style={{ width: 10, height: 10 }} strokeWidth={1.5} />}
            Push to Airtable
          </button>
          <span className="text-foreground/20" style={{ fontSize: 10 }}>·</span>
          <button
            onClick={pullStatus}
            disabled={syncing || !config.scenes_table}
            className="flex items-center gap-1.5 font-sans uppercase text-foreground/50 hover:text-foreground transition-colors disabled:opacity-30"
            style={{ fontSize: 9, letterSpacing: "0.22em" }}
          >
            <RefreshCw style={{ width: 10, height: 10 }} strokeWidth={1.5} />
            Pull status
          </button>
          <span className="text-foreground/20" style={{ fontSize: 10 }}>·</span>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="flex items-center gap-1.5 font-sans uppercase text-foreground/50 hover:text-foreground transition-colors"
            style={{ fontSize: 9, letterSpacing: "0.22em" }}
          >
            <Settings style={{ width: 10, height: 10 }} strokeWidth={1.5} />
            Configure
          </button>
        </div>
      )}

      {/* Config panel */}
      {(showConfig || !sceneId) && (
        <div className="border border-border/40 rounded-sm p-5 space-y-5">
          <p className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.3em" }}>
            Airtable Field Mapping
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Scenes table name or ID</label>
              <input
                type="text"
                value={config.scenes_table}
                onChange={(e) => setConfig({ ...config, scenes_table: e.target.value })}
                placeholder="Scenes"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Portal Scene ID field</label>
              <input
                type="text"
                value={config.field_portal_scene_id}
                onChange={(e) => setConfig({ ...config, field_portal_scene_id: e.target.value })}
                placeholder="Portal Scene ID"
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Scene name field</label>
              <input type="text" value={config.field_scene_name}
                onChange={(e) => setConfig({ ...config, field_scene_name: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Project name field</label>
              <input type="text" value={config.field_project_name}
                onChange={(e) => setConfig({ ...config, field_project_name: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Status field</label>
              <input type="text" value={config.field_status}
                onChange={(e) => setConfig({ ...config, field_status: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Delivery date field</label>
              <input type="text" value={config.field_delivery_date}
                onChange={(e) => setConfig({ ...config, field_delivery_date: e.target.value })}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Round field</label>
              <input type="text" value={config.field_round}
                onChange={(e) => setConfig({ ...config, field_round: e.target.value })}
                className={inputCls} />
            </div>
          </div>

          <div>
            <p className={labelCls + " mb-3"}>Status value mapping (Airtable → Portal)</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>In production</label>
                <input type="text" value={config.status_in_production}
                  onChange={(e) => setConfig({ ...config, status_in_production: e.target.value })}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Awaiting review</label>
                <input type="text" value={config.status_awaiting_review}
                  onChange={(e) => setConfig({ ...config, status_awaiting_review: e.target.value })}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Approved</label>
                <input type="text" value={config.status_approved}
                  onChange={(e) => setConfig({ ...config, status_approved: e.target.value })}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Delivered</label>
                <input type="text" value={config.status_delivered}
                  onChange={(e) => setConfig({ ...config, status_delivered: e.target.value })}
                  className={inputCls} />
              </div>
            </div>
          </div>

          <button
            onClick={saveConfig}
            disabled={saving}
            className="flex items-center gap-2 bg-foreground text-background font-sans uppercase hover:opacity-80 disabled:opacity-50 transition-opacity"
            style={{ height: 36, paddingLeft: 20, paddingRight: 20, fontSize: 10, letterSpacing: "0.26em" }}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />}
            Save configuration
          </button>

          <p className="text-foreground/30" style={{ fontSize: 11, lineHeight: 1.6 }}>
            Ask Kieran for the exact field names from his Airtable base. The "Portal Scene ID" field needs to be created in Airtable as a single-line text field — this is how the sync matches records.
          </p>
        </div>
      )}
    </div>
  );
}
