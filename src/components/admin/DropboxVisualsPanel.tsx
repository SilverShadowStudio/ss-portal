import { useState, useEffect } from "react";
import { FolderOpen, ImageIcon, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { deliverRoundAndStartReview } from "@/lib/reviewWindow";

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

const DELIVERED_STATES = ["delivered", "client_review", "approved"];

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

      // Auto-deliver and sync assets — fire-and-forget so scan display is unaffected by errors.
      if (visuals.length > 0) {
        autoDeliverAndSyncAssets(visuals).catch((err) =>
          console.error("[DropboxVisualsPanel] auto-deliver failed:", err)
        );
      }
    } catch (e: any) {
      toast({ title: "Scan failed", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function autoDeliverAndSyncAssets(visuals: RoundVisual[]) {
    // Fetch all production rounds for this scene so we can match by round_number.
    const { data: sceneRounds } = await supabase
      .from("scene_rounds")
      .select("id, round_number, status")
      .eq("scene_id", sceneId)
      .eq("kind", "production");

    if (!sceneRounds) return;

    const roundByNumber = new Map(sceneRounds.map((r) => [r.round_number, r]));

    for (const visual of visuals) {
      const sceneRound = roundByNumber.get(visual.round);
      if (!sceneRound) continue;

      // Ensure a round_assets row exists for this Dropbox path.
      const { data: existingAsset } = await supabase
        .from("round_assets")
        .select("id")
        .eq("scene_round_id", sceneRound.id)
        .eq("dropbox_path", visual.path)
        .maybeSingle();

      if (!existingAsset) {
        const { error: insertError } = await supabase.from("round_assets").insert({
          scene_round_id: sceneRound.id,
          dropbox_path: visual.path,
          dropbox_file_id: visual.path, // use path as surrogate ID (scan doesn't return real Dropbox file IDs)
          filename: visual.filename,
          file_size: visual.size,
          version: visual.version,
          is_current: true,
          source: "dropbox",
        });
        if (insertError) {
          console.error("[DropboxVisualsPanel] round_assets insert failed:", insertError.message, insertError.details, { path: visual.path, round: visual.round });
        }
      }

      // Deliver the round if it hasn't been delivered yet.
      if (!DELIVERED_STATES.includes(sceneRound.status)) {
        await deliverRoundAndStartReview(sceneRound.id);
      }
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
          <Loader2 className="h-4 w-4 animate-spin text-foreground/30" />
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
