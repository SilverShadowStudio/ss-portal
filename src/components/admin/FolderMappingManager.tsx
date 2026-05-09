import { useState, useEffect } from "react";
import { FolderOpen, Link as LinkIcon, Unlink, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface FolderMapping {
  id: string;
  project_id: string | null;
  scene_id: string | null;
  dropbox_folder_path: string;
  created_at: string;
}

interface DropboxEntry {
  ".tag": "folder" | "file";
  name: string;
  path_lower: string;
  path_display: string;
  id: string;
}

interface FolderMappingManagerProps {
  sceneId?: string;
  projectId?: string;
  sceneName?: string;
  projectName?: string;
  onMappingChange?: () => void;
}

export function FolderMappingManager({
  sceneId,
  projectId,
  sceneName,
  projectName,
  onMappingChange,
}: FolderMappingManagerProps) {
  const [mapping, setMapping] = useState<FolderMapping | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBrowseOpen, setIsBrowseOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState("");
  const [folders, setFolders] = useState<DropboxEntry[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchMapping();
  }, [sceneId, projectId]);

  async function fetchMapping() {
    try {
      let query = supabase.from("folder_mappings").select("*");
      
      if (sceneId) {
        query = query.eq("scene_id", sceneId);
      } else if (projectId) {
        query = query.eq("project_id", projectId);
      }

      const { data, error } = await query.single();
      
      if (!error && data) {
        setMapping(data);
      } else {
        setMapping(null);
      }
    } catch {
      setMapping(null);
    } finally {
      setLoading(false);
    }
  }

  async function browseFolder(path: string) {
    setBrowsing(true);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-api?action=list-folder", {
        body: { path },
      });

      if (error) throw error;

      const folderEntries = (data.entries || []).filter(
        (e: DropboxEntry) => e[".tag"] === "folder"
      );
      setFolders(folderEntries);
      setCurrentPath(path);
    } catch (error) {
      console.error("Error browsing folder:", error);
      toast({
        title: "Error",
        description: "Failed to browse Dropbox folders",
        variant: "destructive",
      });
    } finally {
      setBrowsing(false);
    }
  }

  async function selectFolder(path: string) {
    try {
      // Delete existing mapping if any
      if (mapping) {
        await supabase.from("folder_mappings").delete().eq("id", mapping.id);
      }

      // Create new mapping
      const { error } = await supabase.from("folder_mappings").insert({
        scene_id: sceneId || null,
        project_id: projectId || null,
        dropbox_folder_path: path,
      });

      if (error) throw error;

      toast({
        title: "Folder Linked",
        description: `Linked to ${path}`,
      });

      setIsBrowseOpen(false);
      fetchMapping();
      onMappingChange?.();
    } catch (error) {
      console.error("Error saving mapping:", error);
      toast({
        title: "Error",
        description: "Failed to save folder mapping",
        variant: "destructive",
      });
    }
  }

  async function unlinkFolder() {
    if (!mapping) return;

    try {
      await supabase.from("folder_mappings").delete().eq("id", mapping.id);
      toast({
        title: "Folder Unlinked",
        description: "Dropbox folder has been disconnected",
      });
      setMapping(null);
      onMappingChange?.();
    } catch (error) {
      console.error("Error unlinking folder:", error);
      toast({
        title: "Error",
        description: "Failed to unlink folder",
        variant: "destructive",
      });
    }
  }

  async function rescanFolder() {
    if (!sceneId) return;

    setIsRescanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("dropbox-api?action=rescan-folder", {
        body: { sceneId },
      });

      if (error) throw error;

      toast({
        title: "Rescan Complete",
        description: `Found ${data.added} new files, ${data.updated} updated files`,
      });

      onMappingChange?.();
    } catch (error) {
      console.error("Error rescanning folder:", error);
      toast({
        title: "Error",
        description: "Failed to rescan folder",
        variant: "destructive",
      });
    } finally {
      setIsRescanning(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {mapping ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-secondary/50 px-3 py-2">
          <div className="flex items-center gap-2 overflow-hidden">
            <FolderOpen className="h-4 w-4 shrink-0 text-gold" />
            <span className="truncate text-sm text-foreground">
              {mapping.dropbox_folder_path}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {sceneId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={rescanFolder}
                disabled={isRescanning}
                className="h-7 px-2"
              >
                <RefreshCw className={`h-3 w-3 ${isRescanning ? "animate-spin" : ""}`} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={unlinkFolder}
              className="h-7 px-2 text-destructive hover:text-destructive"
            >
              <Unlink className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setIsBrowseOpen(true);
            browseFolder("");
          }}
          className="w-full justify-start gap-2"
        >
          <LinkIcon className="h-3 w-3" />
          Link Dropbox Folder
        </Button>
      )}

      <Dialog open={isBrowseOpen} onOpenChange={setIsBrowseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Select Dropbox Folder for {sceneName || projectName}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1 text-sm">
              <button
                onClick={() => browseFolder("")}
                className="text-gold hover:underline"
              >
                Root
              </button>
              {currentPath.split("/").filter(Boolean).map((part, i, arr) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-muted-foreground">/</span>
                  <button
                    onClick={() => browseFolder("/" + arr.slice(0, i + 1).join("/"))}
                    className="text-gold hover:underline"
                  >
                    {part}
                  </button>
                </span>
              ))}
            </div>

            {/* Folder list */}
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {browsing ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : folders.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No subfolders found
                </p>
              ) : (
                folders.map((folder) => (
                  <div
                    key={folder.id}
                    className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-secondary"
                  >
                    <button
                      onClick={() => browseFolder(folder.path_lower)}
                      className="flex items-center gap-2 text-left"
                    >
                      <FolderOpen className="h-4 w-4 text-gold" />
                      <span className="text-sm text-foreground">{folder.name}</span>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => selectFolder(folder.path_lower)}
                      className="h-6 px-2 text-xs"
                    >
                      Select
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Select current folder button */}
            <Button
              className="w-full"
              onClick={() => selectFolder(currentPath || "/")}
            >
              Use This Folder
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
