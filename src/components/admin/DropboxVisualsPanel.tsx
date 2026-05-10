import { useState, useEffect } from "react";
import { RefreshCw, FolderOpen, ImageIcon, Loader2, AlertCircle, CheckCircle2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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
  sceneName: string;
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

  // Code editor state
  const [projectCode, setProjectCode] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [sceneCode, setSceneCode] = useState("");
  const [sceneSlug, setSceneSlug] = useState("");
  const [savingCodes, setSavingCodes] = useState(false);
  const [showCodeEditor, setShowCodeEditor] = useState(false);

  useEffect(() => {
    loadCodes();
  }, [sceneId, projectId]);

  async function loadCodes() {
    const [{ data: project }, { data: scene }] = await Promise.all([
      supabase.from("projects").select("project_code, project_slug").eq("id", projectId).single(),
      supabase.from("scenes").select("scene_code, scene_slug").eq("id", sceneId).single(),
    ]);
    if (project) {
      setProjectCode(project.project_code || "");
      setProjectSlug(project.project_slug || "");
    }
    if (scene) {
      setSceneCode(scene.scene_code || "");
      setSceneSlug(scene.scene_slug || "");
    }

    // Auto-scan if codes are set
    if (project?.project_code && project?.project_slug && scene?.scene_code && scene?.scene_slug) {
      scan();
    }
  }

  async function saveCodes() {
    setSavingCodes(true);
    try {
      await Promise.all([
        supabase.from("projects").update({ project_code: projectCode.toUpperCase(), project_slug: projectSlug }).eq("id", projectId),
        supabase.from("scenes").update({ scene_code: sceneCode.toUpperCase(), scene_slug: sceneSlug }).eq("id", sceneId),
      ]);
      toast({ title: "Codes saved." });
      setShowCodeEditor(false);
      setMissingCodes(false);
      scan();
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message, variant: "destructive" });
    } finally {
      setSavingCodes(false);
    }
  }

  async function scan() {
    setLoading(true);
    setMissingCodes(false);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-scan-visuals", {
        body: { sceneId, action: "scan" },
      });
      if (error) throw error;
      if (data.missingCodes) {
        setMissingCodes(true);
        setShowCodeEditor(true);
        return;
      }
      setRounds(data.rounds || []);
      setFolderPath(data.folderPath);
      setFolderExists(data.folderExists);
    } catch (e: any) {
      toast({ title: "Scan failed", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "w-full bg-transparent border-b border-border/50 py-1.5 text-sm text-foreground focus:outline-none focus:border-gold transition-colors placeholder:text-foreground/25";
  const labelCls = "block text-[9px] uppercase tracking-[0.26em] text-foreground/40 mb-1";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-sans uppercase tracking-[0.28em] text-foreground/40">
          Dropbox Visuals
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCodeEditor(!showCodeEditor)}
            className="text-[9px] font-sans uppercase tracking-[0.2em] text-foreground/35 hover:text-foreground transition-colors"
          >
            {projectCode && sceneCode ? `${projectCode}-${sceneCode}` : "Set codes"}
          </button>
          <button
            onClick={scan}
            disabled={loading}
            className="flex items-center gap-1.5 text-[9px] font-sans uppercase tracking-[0.2em] text-foreground/40 hover:text-foreground transition-colors disabled:opacity-30"
          >
            <RefreshCw style={{ width: 10, height: 10 }} className={loading ? "animate-spin" : ""} strokeWidth={1.5} />
            Scan
          </button>
        </div>
      </div>

      {/* Code editor */}
      {showCodeEditor && (
        <div className="border border-border/40 rounded-sm p-4 space-y-4">
          {missingCodes && (
            <div className="flex items-center gap-2 text-gold" style={{ fontSize: 11 }}>
              <AlertCircle style={{ width: 12, height: 12 }} strokeWidth={1.5} />
              Set the production codes to enable automatic Dropbox sync.
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Project code (e.g. CP107)</label>
              <input
                type="text"
                value={projectCode}
                onChange={(e) => setProjectCode(e.target.value)}
                placeholder="CP107"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Project name slug (e.g. Charles-Street)</label>
              <input
                type="text"
                value={projectSlug}
                onChange={(e) => setProjectSlug(e.target.value)}
                placeholder="Charles-Street"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Scene code (e.g. SC05)</label>
              <input
                type="text"
                value={sceneCode}
                onChange={(e) => setSceneCode(e.target.value)}
                placeholder="SC05"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Scene name slug (e.g. Facade)</label>
              <input
                type="text"
                value={sceneSlug}
                onChange={(e) => setSceneSlug(e.target.value)}
                placeholder="Facade"
                className={inputCls}
              />
            </div>
          </div>
          {projectCode && projectSlug && sceneCode && sceneSlug && (
            <p className="text-foreground/35 font-mono" style={{ fontSize: 10 }}>
              → {`/00_Production/PRD01_Client-Projects/${projectCode}_${projectSlug}/${sceneCode}_${sceneSlug}/VS_Visuals`}
            </p>
          )}
          <button
            onClick={saveCodes}
            disabled={savingCodes || !projectCode || !projectSlug || !sceneCode || !sceneSlug}
            className="flex items-center gap-2 bg-foreground text-background font-sans uppercase hover:opacity-80 disabled:opacity-40 transition-opacity"
            style={{ height: 34, paddingLeft: 16, paddingRight: 16, fontSize: 10, letterSpacing: "0.26em" }}
          >
            {savingCodes ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />}
            Save and scan
          </button>
        </div>
      )}

      {/* Folder path */}
      {folderPath && (
        <p className="text-foreground/25 font-mono truncate" style={{ fontSize: 9 }}>
          {folderPath}
        </p>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-foreground/30" />
        </div>
      )}

      {/* Folder not found */}
      {!loading && folderExists === false && (
        <div className="flex items-center gap-2 py-4 text-foreground/35" style={{ fontSize: 12 }}>
          <FolderOpen style={{ width: 14, height: 14 }} strokeWidth={1.5} />
          Folder not found in Dropbox. Create it and drop files to auto-sync.
        </div>
      )}

      {/* Rounds */}
      {!loading && rounds.length > 0 && (
        <div className="space-y-1">
          {rounds.map((r) => (
            <div
              key={r.round}
              className="flex items-center gap-4 py-3 border-t border-border/30 group"
            >
              {/* Thumbnail */}
              {r.link && (
                <div
                  className="shrink-0 rounded-sm overflow-hidden bg-foreground/5 cursor-pointer"
                  style={{ width: 48, height: 36 }}
                  onClick={() => onRoundSelected?.(r.round, r.link!, r.filename)}
                >
                  <img
                    src={r.link}
                    alt={r.filename}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-sans text-foreground" style={{ fontSize: 12 }}>
                  Round {String(r.round).padStart(2, "0")}
                  <span className="text-foreground/35 ml-2" style={{ fontSize: 10 }}>
                    v{String(r.version).padStart(2, "0")}
                  </span>
                </p>
                <p className="font-sans text-foreground/35 mt-0.5 truncate" style={{ fontSize: 9 }}>
                  {formatDate(r.modified_at)} · {formatSize(r.size)}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {r.link && (
                  <>
                    <button
                      onClick={() => onRoundSelected?.(r.round, r.link!, r.filename)}
                      className="text-foreground/50 hover:text-gold transition-colors"
                      title="Use this render"
                    >
                      <ImageIcon style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                    </button>
                    <a
                      href={r.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground/50 hover:text-gold transition-colors"
                      title="Open in Dropbox"
                    >
                      <ExternalLink style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                    </a>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && folderExists === true && rounds.length === 0 && (
        <p className="text-foreground/30 py-4" style={{ fontSize: 12 }}>
          No VS visuals found. Drop files named CP{projectCode?.replace("CP", "")}-{sceneCode}-VS_R01_01.jpg into the folder.
        </p>
      )}
    </div>
  );
}
