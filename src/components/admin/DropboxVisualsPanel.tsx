import { useState, useEffect } from "react";
import { FolderOpen, ImageIcon, AlertCircle, ExternalLink } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/invoiceUtils";

interface RoundVisual {
  round: number;
  version: number;
  filename: string;
  path: string;
  modified_at: string;
  size: number;
  link: string | null;
}

interface DropboxVisualsPanelProps {
  sceneId: string;
  projectId: string;
  sceneName?: string;
  onRoundSelected?: (round: number, link: string, filename: string) => void;
}

// Canonical datetime from @/lib/invoiceUtils — "01 January 2000, 14:30".
const formatDate = formatDateTime;

function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export function DropboxVisualsPanel({
  sceneId,
  projectId,
  sceneName,
  onRoundSelected,
}: DropboxVisualsPanelProps) {
  const { toast } = useToast();
  const [rounds, setRounds] = useState<RoundVisual[]>([]);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [folderExists, setFolderExists] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [missingCodes, setMissingCodes] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [projectCode, setProjectCode] = useState("");
  const [sceneCode, setSceneCode] = useState("");

  useEffect(() => {
    loadCodes();
  }, [sceneId, projectId]);

  async function loadCodes() {
    try {
      const [{ data: project }, { data: scene }] = await Promise.all([
        supabase.from("projects").select("project_code").eq("id", projectId).single(),
        supabase.from("scenes").select("scene_code").eq("id", sceneId).single(),
      ]);
      const pc = project?.project_code || "";
      const sc = scene?.scene_code || "";
      setProjectCode(pc);
      setSceneCode(sc);
      if (pc && sc) {
        setMissingCodes(false);
        await scan();
      } else {
        setMissingCodes(true);
      }
    } catch {
      setMissingCodes(true);
    }
  }

  async function scan() {
    setLoading(true);
    setScanError(null);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-scan-visuals", {
        body: { sceneId, action: "scan" },
      });
      if (error) throw error;
      if (data?.missingCodes) {
        setMissingCodes(true);
        return;
      }
      if (data?.error) {
        setScanError(data.error);
        setFolderExists(false);
        setRounds([]);
        return;
      }
      const visuals: RoundVisual[] = data?.rounds || [];
      setRounds(visuals);
      setFolderPath(data?.folderPath || null);
      setFolderExists(data?.folderExists ?? null);

    } catch (e: any) {
      toast({ title: "Scan failed", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-sans uppercase tracking-[0.28em] text-foreground/40">Dropbox Visuals</p>
        {projectCode && sceneCode && (
          <span className="text-[9px] font-sans uppercase tracking-[0.2em] text-foreground/35">
            {projectCode}-{sceneCode}
          </span>
        )}
      </div>

      {missingCodes && (
        <div className="flex items-center gap-2 py-3 text-foreground/40" style={{ fontSize: 11 }}>
          <AlertCircle style={{ width: 12, height: 12 }} strokeWidth={1.5} className="shrink-0 text-gold" />
          Scene codes not configured
        </div>
      )}

      {folderPath && !missingCodes && (
        <p className="text-foreground/20 font-mono truncate" style={{ fontSize: 9 }}>{folderPath}</p>
      )}

      {loading && (
        <div className="flex items-center justify-center py-6">
          <BrandLoader size="sm" />
        </div>
      )}

      {!loading && scanError && (
        <div className="flex items-start gap-2 py-3 text-foreground/50" style={{ fontSize: 11 }}>
          <AlertCircle style={{ width: 13, height: 13, marginTop: 1 }} strokeWidth={1.5} className="shrink-0 text-gold" />
          {scanError}
        </div>
      )}

      {!loading && !scanError && folderExists === false && (
        <div className="flex items-center gap-2 py-3 text-foreground/35" style={{ fontSize: 12 }}>
          <FolderOpen style={{ width: 14, height: 14 }} strokeWidth={1.5} />
          Folder not found in Dropbox.
        </div>
      )}

      {!loading && rounds.length > 0 && (
        <div className="space-y-1">
          {rounds.map((r) => (
            <div key={r.round} className="group flex items-center gap-4 py-3 border-t border-border/30">
              {r.link && (
                <div
                  className="shrink-0 rounded-sm overflow-hidden bg-foreground/5 cursor-pointer"
                  style={{ width: 48, height: 36 }}
                  onClick={() => onRoundSelected?.(r.round, r.link!, r.filename)}
                >
                  <img src={r.link} alt={r.filename} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-sans text-foreground" style={{ fontSize: 12 }}>
                  Round {String(r.round).padStart(2, "0")}
                  <span className="text-foreground/35 ml-2" style={{ fontSize: 10 }}>v{String(r.version).padStart(2, "0")}</span>
                </p>
                <p className="font-sans text-foreground/35 mt-0.5 truncate" style={{ fontSize: 9 }}>
                  {formatDate(r.modified_at)} · {formatSize(r.size)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {r.link && (
                  <>
                    <button onClick={() => onRoundSelected?.(r.round, r.link!, r.filename)} className="text-foreground/50 hover:text-gold transition-colors" title="Use this render">
                      <ImageIcon style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                    </button>
                    <a href={r.link} target="_blank" rel="noopener noreferrer" className="text-foreground/50 hover:text-gold transition-colors" title="Open in Dropbox">
                      <ExternalLink style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                    </a>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && folderExists === true && rounds.length === 0 && (
        <p className="text-foreground/30 py-3" style={{ fontSize: 12 }}>No VS visuals found in this folder yet.</p>
      )}
    </div>
  );
}
