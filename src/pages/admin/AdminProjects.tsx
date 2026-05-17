import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Plus, Clock, ChevronRight, MoreVertical, Trash2, ArchiveRestore, Pencil } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArborescenceTitle } from "@/components/client/ArborescenceTitle";
import { LaneCard } from "@/components/client/LaneCard";
import { TaskDetail } from "@/components/client/TaskDetail";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { ArchiveProjectDialog } from "@/components/admin/ArchiveProjectDialog";
import { cn } from "@/lib/utils";
import {
  getStatusPhase as sharedGetStatusPhase,
  getSceneEffectivePhase as sharedGetSceneEffectivePhase,
  getPhaseDot,
} from "@/lib/scenePhase";

interface Scene {
  id: string;
  name: string;
  status: string;
  current_round: number;
  paid_rounds: number;
  project_id: string;
  next_delivery_at: string | null;
}

interface SceneRound {
  id: string;
  round_number: number;
  status: string;
  delivered_at: string | null;
  image_url: string | null;
  start_date: string | null;
  end_date: string | null;
  instructions?: string | null;
  /** Resolved preview URL — either image_url or the latest uploaded asset. */
  preview_url?: string | null;
}

interface Project {
  id: string;
  name: string;
  status: string;
  user_id: string;
  scenes: Scene[];
  archived_at?: string | null;
  dropbox_folder_url?: string | null;
}

interface Client {
  user_id: string;
  account_id: string | null;
  full_name: string | null;
  company: string | null;
  projects: Project[];
}

export default function AdminProjects() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  // The ?client= query param carries an account_id (one account can own
  // many users). We resolve it to the set of user_ids via account_members
  // before auto-selecting the matching client entry below.
  const accountParam = searchParams.get("client");
  const [clients, setClients] = useState<Client[]>([]);
  const [allClientOptions, setAllClientOptions] = useState<
    { user_id: string; label: string }[]
  >([]);
  const [sceneRounds, setSceneRounds] = useState<Map<string, SceneRound[]>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [projectToArchive, setProjectToArchive] = useState<Project | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  // Drill-down state — mirrors client Portfolio
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [selectedRound, setSelectedRound] = useState<SceneRound | null>(null);

  // Create project modal
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDropboxUrl, setNewProjectDropboxUrl] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Edit project dialog (Dropbox folder URL)
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [editProjectTarget, setEditProjectTarget] = useState<Project | null>(null);
  const [editProjectDropboxUrl, setEditProjectDropboxUrl] = useState("");
  const [isSavingProject, setIsSavingProject] = useState(false);

  // Create balance invoice (L5 round detail)
  const [creatingBalanceInvoice, setCreatingBalanceInvoice] = useState(false);

  async function handleCreateBalanceInvoice(sceneId: string) {
    if (creatingBalanceInvoice) return;
    if (!window.confirm(
      "Create a balance invoice for this scene? This will raise the remaining balance " +
      "from the most recent signed quotation and email the client."
    )) return;
    setCreatingBalanceInvoice(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-balance-invoice", {
        body: { scene_id: sceneId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const num = data?.invoiceNumber || "—";
      toast.success(`Balance invoice ${num} created`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to create balance invoice");
    } finally {
      setCreatingBalanceInvoice(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [showArchived]);

  // Honor a sceneId / projectId / roundId passed via navigation state
  // (e.g. from the admin timeline) and auto-drill once data has loaded.
  useEffect(() => {
    const navState = location.state as {
      sceneId?: string;
      projectId?: string;
      roundId?: string;
    } | null;
    if (!navState?.sceneId || clients.length === 0) return;
    let foundClient: Client | null = null;
    let foundProject: Project | null = null;
    let foundScene: Scene | null = null;
    for (const c of clients) {
      for (const p of c.projects) {
        const s = p.scenes.find((s) => s.id === navState.sceneId);
        if (s) {
          foundClient = c;
          foundProject = p;
          foundScene = s;
          break;
        }
      }
      if (foundScene) break;
    }
    if (!foundScene) return;
    setSelectedClient(foundClient);
    setSelectedProject(foundProject);
    setSelectedScene(foundScene);
    const list = sceneRounds.get(foundScene.id) || [];
    const requested = navState.roundId
      ? list.find((r) => r.id === navState.roundId) ?? null
      : null;
    const fallback = (() => {
      const sorted = [...list].sort((a, b) => b.round_number - a.round_number);
      return (
        sorted.find((r) => r.status === "delivered" || r.status === "client_review" || r.status === "approved") ??
        sorted[0] ??
        null
      );
    })();
    setSelectedRound(requested ?? fallback);
    window.history.replaceState({}, "");
  }, [clients, sceneRounds, location.state]);

  // Keyboard navigation — when a round is open, ← / → flick to the previous
  // or next sibling round on the same scene. Skips when focus is in an
  // editable field so typing stays unaffected. Mirrors the client Portfolio.
  useEffect(() => {
    if (!selectedScene || !selectedRound) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      const list = (sceneRounds.get(selectedScene.id) || [])
        .slice()
        .sort((a, b) => a.round_number - b.round_number);
      if (list.length < 2) return;
      const idx = list.findIndex((r) => r.id === selectedRound.id);
      if (idx === -1) return;
      const nextIdx =
        e.key === "ArrowLeft"
          ? (idx - 1 + list.length) % list.length
          : (idx + 1) % list.length;
      const next = list[nextIdx];
      if (next && next.id !== selectedRound.id) {
        e.preventDefault();
        setSelectedRound(next);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedScene, selectedRound, sceneRounds]);

  async function fetchData() {
    try {
      setLoading(true);

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, company");

      setAllClientOptions(
        (profiles || []).map((p) => ({
          user_id: p.user_id,
          label: p.full_name || p.company || "Unknown",
        }))
      );

      const profileMap = new Map(
        (profiles || []).map((p) => [p.user_id, p])
      );

      // user_id → account_id from account_members. Each user belongs to
      // at most one account (UNIQUE(user_id) on account_members).
      const { data: memberRows } = await supabase
        .from("account_members")
        .select("user_id, account_id");
      const accountByUser = new Map<string, string>();
      for (const m of memberRows || []) {
        if (m.user_id && m.account_id) accountByUser.set(m.user_id, m.account_id);
      }

      const { data: projectsData, error: projectsError } = await supabase
        .from("projects")
        .select("id, name, status, user_id, created_at, archived_at, dropbox_folder_url")
        .order("created_at", { ascending: false });
      if (projectsError) throw projectsError;

      // Filter on the client so admins can toggle the archived view without
      // a separate query path. RLS already gives admins both archived and
      // non-archived rows.
      const visibleProjects = (projectsData || []).filter((p) =>
        showArchived ? !!p.archived_at : !p.archived_at,
      );

      const projectIds = visibleProjects.map((p) => p.id);

      const { data: allScenes } = projectIds.length
        ? await supabase
            .from("scenes")
            .select(
              "id, name, status, current_round, paid_rounds, project_id, next_delivery_at, created_at"
            )
            .in("project_id", projectIds)
            .order("created_at", { ascending: true })
        : { data: [] as any[] };

      const sceneIds = (allScenes || []).map((s: any) => s.id);

      const { data: allRounds } = sceneIds.length
        ? await supabase
            .from("scene_rounds")
            .select(
              "id, round_number, status, delivered_at, image_url, start_date, end_date, scene_id, kind"
            )
            .in("scene_id", sceneIds)
            // Review rounds are a timeline-only artifact — exclude from
            // the admin's per-scene round list so each delivery still
            // shows up as a single round card.
            .eq("kind", "production")
            .order("round_number", { ascending: true })
        : { data: [] as any[] };

      // Pull the most recent current asset per round so cards can preview the
      // uploaded render even when scene_rounds.image_url has not been set.
      const roundIds = (allRounds || []).map((r: any) => r.id);
      const previewByRoundId = new Map<string, string>();
      if (roundIds.length) {
        const { data: assetRows } = await supabase
          .from("round_assets")
          .select("scene_round_id, storage_path, source, created_at, is_current")
          .in("scene_round_id", roundIds)
          .eq("is_current", true)
          .eq("source", "upload")
          .order("created_at", { ascending: false });
        for (const a of assetRows || []) {
          const key = (a as any).scene_round_id as string;
          if (previewByRoundId.has(key)) continue; // first hit = newest
          const rawPath = (a as any).storage_path as string | null;
          if (!rawPath) continue;
          const path = rawPath.replace(/^\/+/, "");
          const { data: urlData } = supabase.storage
            .from("round-uploads")
            .getPublicUrl(path);
          previewByRoundId.set(key, urlData.publicUrl);
        }
      }

      const roundsMap = new Map<string, SceneRound[]>();
      for (const round of allRounds || []) {
        const existing = roundsMap.get((round as any).scene_id) || [];
        const enriched: SceneRound = {
          ...(round as any),
          preview_url:
            (round as any).image_url ||
            previewByRoundId.get((round as any).id) ||
            null,
        };
        existing.push(enriched);
        roundsMap.set((round as any).scene_id, existing);
      }

      const scenesByProject = new Map<string, Scene[]>();
      for (const scene of allScenes || []) {
        const existing = scenesByProject.get(scene.project_id) || [];
        existing.push(scene as Scene);
        scenesByProject.set(scene.project_id, existing);
      }

      // Group projects by client (user_id)
      const clientsMap = new Map<string, Client>();
      for (const p of visibleProjects) {
        const profile = profileMap.get(p.user_id);
        let client = clientsMap.get(p.user_id);
        if (!client) {
          client = {
            user_id: p.user_id,
            account_id: accountByUser.get(p.user_id) ?? null,
            full_name: profile?.full_name ?? null,
            company: profile?.company ?? null,
            projects: [],
          };
          clientsMap.set(p.user_id, client);
        }
        client.projects.push({
          id: p.id,
          name: p.name,
          status: p.status,
          user_id: p.user_id,
          scenes: scenesByProject.get(p.id) || [],
          archived_at: p.archived_at ?? null,
          dropbox_folder_url: (p as any).dropbox_folder_url ?? null,
        });
      }

      const clientList = Array.from(clientsMap.values()).sort((a, b) => {
        const an = (a.full_name || a.company || "").toLowerCase();
        const bn = (b.full_name || b.company || "").toLowerCase();
        return an.localeCompare(bn);
      });

      setClients(clientList);
      setSceneRounds(roundsMap);
      // Auto-select a client when navigating in from /admin/clients.
      // accountParam is an account_id; resolve to the set of user_ids on
      // that account, then pick the first matching client entry.
      if (accountParam) {
        const { data: memberRows } = await supabase
          .from("account_members")
          .select("user_id")
          .eq("account_id", accountParam);
        const userIdSet = new Set(
          (memberRows ?? [])
            .map((m: any) => m.user_id as string | null)
            .filter((v): v is string => !!v),
        );

        let target = clientList.find((c) => userIdSet.has(c.user_id));
        if (!target && userIdSet.size > 0) {
          // No projects yet for any user on this account — build a synthetic
          // entry so the UI shows "No projects" rather than the full
          // all-clients view.
          const firstUserId = [...userIdSet][0];
          const profileRow = (profiles || []).find(
            (p) => p.user_id === firstUserId,
          );
          target = {
            user_id: firstUserId,
            account_id: accountParam,
            full_name: profileRow?.full_name ?? null,
            company: profileRow?.company ?? null,
            projects: [],
          };
        }
        if (target) setSelectedClient(target);
      }
    } catch (error) {
      console.error("Error fetching admin projects:", error);
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Pick the preview image for a project card: the latest delivered round of
   * the most recently delivered scene. Falls back to any uploaded preview so
   * the card stays meaningful as soon as a render exists.
   */
  const getProjectPreview = (project: Project): string | null => {
    let best: { delivered_at: number; round_number: number; preview: string } | null = null;
    let fallback: string | null = null;
    for (const scene of project.scenes) {
      const rounds = sceneRounds.get(scene.id) || [];
      for (const r of rounds) {
        if (!r.preview_url) continue;
        if (!fallback) fallback = r.preview_url;
        if (r.status !== "delivered" && r.status !== "client_review" && r.status !== "approved") continue;
        const ts = r.delivered_at ? new Date(r.delivered_at).getTime() : 0;
        if (
          !best ||
          ts > best.delivered_at ||
          (ts === best.delivered_at && r.round_number > best.round_number)
        ) {
          best = { delivered_at: ts, round_number: r.round_number, preview: r.preview_url };
        }
      }
    }
    return best?.preview ?? fallback;
  };

  // Use the shared phase utilities so admin and client see identical
  // status phrasing ("Awaiting Review", not "Client Review", etc.).
  const getStatusPhase = sharedGetStatusPhase;
  const getSceneEffectivePhase = sharedGetSceneEffectivePhase;

  const getRoundEstimate = (round: SceneRound) => {
    if (round.status === "delivered") return "Ready for review";
    if (round.status === "approved") return "Approved";
    if (round.end_date) {
      const days = Math.max(
        0,
        Math.ceil((new Date(round.end_date).getTime() - Date.now()) / 86400000)
      );
      if (days === 0) return "Ready today";
      return `Ready in ${days} day${days !== 1 ? "s" : ""}`;
    }
    return "In production";
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return undefined;
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const clientLabel = (c: Client | null) =>
    c ? c.full_name || c.company || "Unknown Client" : "";

  // Breadcrumbs: Clients → {Client} → {Project} → {Scene} → Round NN
  const breadcrumbs = useMemo(() => {
    const items: { label: string; onClick?: () => void }[] = [
      {
        label: "Clients",
        onClick: () => navigate("/admin/clients"),
      },
    ];

    if (selectedClient) {
      items.push({
        label: clientLabel(selectedClient),
        onClick: selectedProject
          ? () => {
              setSelectedProject(null);
              setSelectedScene(null);
              setSelectedRound(null);
            }
          : undefined,
      });
    }

    if (selectedProject) {
      items.push({
        label: selectedProject.name,
        onClick: selectedScene
          ? () => {
              setSelectedScene(null);
              setSelectedRound(null);
            }
          : undefined,
      });
    }

    if (selectedScene) {
      items.push({
        label: selectedScene.name,
        onClick: selectedRound ? () => setSelectedRound(null) : undefined,
      });
    }

    if (selectedRound) {
      items.push({
        label: `Round ${selectedRound.round_number.toString().padStart(2, "0")}`,
      });
    }

    return items;
  }, [selectedClient, selectedProject, selectedScene, selectedRound]);

  const handleCreateProject = async () => {
    if (!newProjectName || !selectedClientId) {
      toast.error("Please provide project name and select a client.");
      return;
    }
    setIsCreating(true);
    try {
      const { data: membership, error: memErr } = await supabase
        .from("account_members")
        .select("account_id")
        .eq("user_id", selectedClientId)
        .maybeSingle();
      if (memErr) throw memErr;
      if (!membership?.account_id) {
        toast.error("No company account found for this client. Provision them via Admin → Clients first.");
        return;
      }

      const { data: newProject, error } = await supabase.from("projects").insert({
        name: newProjectName,
        user_id: selectedClientId,
        account_id: membership.account_id,
        status: "active",
        ...(newProjectDropboxUrl.trim() ? { dropbox_folder_url: newProjectDropboxUrl.trim() } : {}),
      }).select("id").single();
      if (error) throw error;

      // Fire-and-forget: sync to Airtable Projects table + auto-generate project code
      if (newProject?.id) {
        supabase.functions
          .invoke("airtable-sync-project", { body: { project_id: newProject.id } })
          .catch((e: unknown) => console.warn("[AdminProjects] airtable-sync-project:", e));
      }

      toast.success(`${newProjectName} has been created.`);
      // Activity log: project creation.
      const { logActivity } = await import("@/lib/activityLog");
      await logActivity({
        action: "project_created",
        description: `Created project "${newProjectName}"`,
        actorRole: "admin",
        entityType: "project",
        projectName: newProjectName,
      });
      setIsAddDialogOpen(false);
      setNewProjectName("");
      setNewProjectDropboxUrl("");
      setSelectedClientId("");
      fetchData();
    } catch (error: any) {
      console.error("Error creating project:", error);
      toast.error(error.message || "Failed to create project");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveProjectDropbox = async () => {
    if (!editProjectTarget) return;
    setIsSavingProject(true);
    try {
      const { error } = await supabase
        .from("projects")
        .update({ dropbox_folder_url: editProjectDropboxUrl.trim() || null })
        .eq("id", editProjectTarget.id);
      if (error) throw error;
      setEditProjectOpen(false);
      setEditProjectTarget(null);
      fetchData();
    } catch (error: any) {
      toast.error(error.message || "Failed to save project settings");
    } finally {
      setIsSavingProject(false);
    }
  };

  const handleRestoreProject = async (project: Project) => {
    setRestoring(project.id);
    try {
      const { error } = await supabase
        .from("projects")
        .update({
          archived_at: null,
          archived_by: null,
          archive_reason: null,
        })
        .eq("id", project.id);
      if (error) throw error;
      toast.success(`"${project.name}" restored`);
      const { logActivity } = await import("@/lib/activityLog");
      await logActivity({
        action: "project_restored",
        description: `Restored project "${project.name}"`,
        actorRole: "admin",
        entityType: "project",
        projectId: project.id,
        projectName: project.name,
      });
      fetchData();
    } catch (err: any) {
      console.error("restore project failed", err);
      toast.error(err.message || "Failed to restore project");
    } finally {
      setRestoring(null);
    }
  };

  /**
   * Wraps a LaneCard with an absolutely-positioned admin actions menu
   * (Archive or Restore depending on the current view).
   */
  const renderProjectCard = (project: Project, onOpen: () => void) => {
    const isArchived = !!project.archived_at;
    return (
      <div key={project.id} className={cn("relative", isArchived && "opacity-70")}>
        <LaneCard
          id={project.id}
          phase={
            isArchived
              ? "Archived"
              : project.status === "active"
              ? "Active Project"
              : project.status.toUpperCase()
          }
          title={project.name}
          previewUrl={getProjectPreview(project) ?? undefined}
          estimate={`${project.scenes.length} scene${
            project.scenes.length !== 1 ? "s" : ""
          }`}
          onClick={onOpen}
        />
        <div className="absolute right-3 top-3 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                aria-label="Project actions"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-muted-foreground backdrop-blur transition-colors hover:bg-background hover:text-foreground"
              >
                <MoreVertical size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(e) => e.stopPropagation()}
            >
              {isArchived ? (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleRestoreProject(project);
                  }}
                  disabled={restoring === project.id}
                >
                  <ArchiveRestore size={14} className="mr-2" />
                  {restoring === project.id ? "Restoring…" : "Restore project"}
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setEditProjectTarget(project);
                      setEditProjectDropboxUrl(project.dropbox_folder_url ?? "");
                      setEditProjectOpen(true);
                    }}
                  >
                    <Pencil size={14} className="mr-2" />
                    Edit project…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={(e) => {
                      e.preventDefault();
                      setProjectToArchive(project);
                    }}
                  >
                    <Trash2 size={14} className="mr-2" />
                    Archive project…
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    // Level 5: Round detail
    if (selectedProject && selectedScene && selectedRound) {
      const sceneRoundsList = sceneRounds.get(selectedScene.id) || [];
      const isApproved = selectedRound.status === "approved";
      return (
        <>
          {isApproved && (
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                disabled={creatingBalanceInvoice}
                onClick={() => handleCreateBalanceInvoice(selectedScene.id)}
                className="inline-flex items-center px-3 py-1.5 bg-gold text-background hover:bg-gold/90 disabled:opacity-50 transition-colors font-sans uppercase"
                style={{ fontSize: 10, letterSpacing: "0.18em" }}
              >
                {creatingBalanceInvoice ? "Creating…" : "Create balance invoice"}
              </button>
            </div>
          )}
          <TaskDetail
          roundId={selectedRound.id}
          sceneId={selectedScene.id}
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          sceneName={selectedScene.name}
          roundNumber={selectedRound.round_number}
          roundStatus={selectedRound.status}
          deliveredAt={selectedRound.delivered_at}
          startDate={selectedRound.start_date}
          endDate={selectedRound.end_date}
          isAdmin
          siblingRounds={sceneRoundsList.map((r) => ({
            id: r.id,
            round_number: r.round_number,
            status: r.status,
          }))}
          onSelectRound={(rid) => {
            const target = sceneRoundsList.find((r) => r.id === rid);
            if (target) setSelectedRound(target);
          }}
          onUploaded={() => {
            // Flip the local round to "delivered" so the AssetViewer renders
            // immediately, and refresh the underlying data in the background.
            const nowIso = new Date().toISOString();
            setSelectedRound((r) =>
              r ? { ...r, status: "delivered", delivered_at: nowIso } : r
            );
            setSceneRounds((prev) => {
              const next = new Map(prev);
              const list = next.get(selectedScene.id) || [];
              next.set(
                selectedScene.id,
                list.map((r) =>
                  r.id === selectedRound.id
                    ? { ...r, status: "delivered", delivered_at: nowIso }
                    : r
                )
              );
              return next;
            });
            fetchData();
          }}
        />
        </>
      );
    }

    // Level 4: Scene → rounds
    if (selectedProject && selectedScene) {
      const rounds = sceneRounds.get(selectedScene.id) || [];
      return (
        <div>
          {rounds.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center p-20 border-2 border-dashed border-border rounded-[32px] bg-card"
            >
              <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-6">
                <Clock size={32} />
              </div>
              <h3 className="text-xl font-medium mb-2 font-serif">
                No rounds yet
              </h3>
              <p className="text-muted-foreground text-center max-w-sm font-sans text-sm">
                Rounds will appear here once production begins.
              </p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {rounds.map((round) => {
                const phase = getStatusPhase(round.status);
                const title = `Round ${round.round_number
                  .toString()
                  .padStart(2, "0")}`;
                const estimate = getRoundEstimate(round);
                const lastUpdate = formatDate(round.delivered_at);
                return (
                  <button
                    key={round.id}
                    type="button"
                    onClick={() => setSelectedRound(round)}
                    className="text-left relative min-w-[320px] bg-card border border-border rounded-2xl p-6 cursor-pointer group transition-colors hover:border-primary/40"
                  >
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        {phase && (
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-primary mb-1 block font-sans">
                            {phase}
                          </span>
                        )}
                        <h3 className="text-lg font-medium tracking-tight group-hover:text-primary font-serif">
                          {title}
                        </h3>
                      </div>
                      <div className="p-2 rounded-full bg-muted group-hover:bg-primary/10 transition-all">
                        <ChevronRight
                          size={16}
                          className="text-muted-foreground group-hover:text-primary"
                        />
                      </div>
                    </div>

                    <div className="aspect-video rounded-xl overflow-hidden bg-muted mb-6 border border-border/50">
                      {round.preview_url ? (
                        <img
                          src={round.preview_url}
                          className="w-full h-full object-cover"
                          alt={title}
                          draggable={false}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <Clock size={24} />
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground font-sans">
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} />
                        <span>{estimate}</span>
                      </div>
                      {lastUpdate && <span>{lastUpdate}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // Level 3: Project → scenes
    if (selectedProject) {
      return (
        <div className="space-y-8">
          {selectedProject.scenes.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center p-20 border-2 border-dashed border-border rounded-[32px] bg-card"
            >
              <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-6">
                <Clock size={32} />
              </div>
              <h3 className="text-xl font-medium mb-2 font-serif">
                No scenes yet
              </h3>
              <p className="text-muted-foreground text-center max-w-sm font-sans text-sm">
                Scenes will appear here once they are added to this project.
              </p>
            </motion.div>
          ) : (() => {
            // Mirror the client Portfolio organisation: section by phase
            // (Awaiting Review → Awaiting Brief → Approved → In Production)
            // with round-number sub-groups inside each section.
            type SceneItem = Scene;
            type SceneGroup = { key: string; label: string; scenes: SceneItem[] };
            const groups: Record<string, SceneGroup> = {
              review: { key: "review", label: "Awaiting Review", scenes: [] },
              brief: { key: "brief", label: "Awaiting Brief", scenes: [] },
              approved: { key: "approved", label: "Approved", scenes: [] },
              other: { key: "other", label: "Other", scenes: [] },
              production: { key: "production", label: "In Production", scenes: [] },
            };
            const sceneRoundNumber = (scene: SceneItem) => {
              const rounds = sceneRounds.get(scene.id) || [];
              if (rounds.length === 0) return scene.current_round || 1;
              return Math.max(...rounds.map((r) => r.round_number));
            };
            for (const scene of selectedProject.scenes) {
              const rounds = sceneRounds.get(scene.id) || [];
              const phase = getSceneEffectivePhase(scene, rounds);
              const bucket =
                phase === "Awaiting Review"
                  ? "review"
                  : phase === "Awaiting Brief"
                  ? "brief"
                  : phase === "Approved"
                  ? "approved"
                  : phase === "In Production"
                  ? "production"
                  : "other";
              groups[bucket].scenes.push(scene);
            }
            for (const g of Object.values(groups)) {
              g.scenes.sort((a, b) => sceneRoundNumber(a) - sceneRoundNumber(b));
            }
            const orderedSections = ["review", "brief", "approved", "other", "production"]
              .map((k) => groups[k])
              .filter((g) => g.scenes.length > 0);
            const subgroupByRound = (scenes: SceneItem[]) => {
              const map = new Map<number, SceneItem[]>();
              for (const s of scenes) {
                const n = sceneRoundNumber(s);
                const arr = map.get(n) || [];
                arr.push(s);
                map.set(n, arr);
              }
              return [...map.entries()].sort((a, b) => a[0] - b[0]);
            };
            const renderSceneCard = (scene: Scene) => {
              const rounds = sceneRounds.get(scene.id) || [];
              const deliveredRounds = rounds.filter(
                (r) => (r.status === "delivered" || r.status === "client_review" || r.status === "approved") && r.preview_url
              );
              const latestRound =
                deliveredRounds.sort((a, b) => b.round_number - a.round_number)[0] ||
                [...rounds].sort((a, b) => b.round_number - a.round_number)[0];
              const phase = getSceneEffectivePhase(scene, rounds);
              const sceneDot = getPhaseDot(phase);
              const estimate = `${rounds.length} round${
                rounds.length !== 1 ? "s" : ""
              }`;
              const lastUpdate = formatDate(scene.next_delivery_at);
              return (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => {
                      setSelectedScene(scene);
                      // Mirror the client portfolio: skip the intermediate
                      // "rounds as cards" page and jump straight into the
                      // round detail. Prefer the latest delivered/approved
                      // round; otherwise fall back to the highest-numbered
                      // round (typically the one in production).
                      const sorted = [...rounds].sort(
                        (a, b) => b.round_number - a.round_number
                      );
                      const target =
                        sorted.find(
                          (r) =>
                            r.status === "delivered" || r.status === "client_review" || r.status === "approved"
                        ) ?? sorted[0] ?? null;
                      setSelectedRound(target);
                    }}
                    className="text-left relative min-w-[320px] bg-card border border-border rounded-2xl p-6 cursor-pointer group transition-colors hover:border-primary/40"
                  >
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        {phase && (
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-primary mb-1 flex items-center gap-2 font-sans">
                            {sceneDot && (
                              <span
                                aria-hidden
                                className={
                                  sceneDot === "red"
                                    ? "inline-block h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_6px_hsl(0_84%_60%/0.55)]"
                                    : sceneDot === "green"
                                    ? "inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_hsl(142_71%_45%/0.55)]"
                                    : "inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/40"
                                }
                              />
                            )}
                            <span>{phase}</span>
                          </span>
                        )}
                        <h3 className="text-lg font-medium tracking-tight group-hover:text-primary font-serif">
                          {scene.name}
                        </h3>
                      </div>
                      <div className="p-2 rounded-full bg-muted group-hover:bg-primary/10 transition-all">
                        <ChevronRight
                          size={16}
                          className="text-muted-foreground group-hover:text-primary"
                        />
                      </div>
                    </div>

                    <div className="aspect-video rounded-xl overflow-hidden bg-muted mb-6 border border-border/50">
                      {latestRound?.preview_url ? (
                        <img
                          src={latestRound.preview_url}
                          className="w-full h-full object-cover"
                          alt={scene.name}
                          draggable={false}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <Clock size={24} />
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground font-sans">
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} />
                        <span>{estimate}</span>
                      </div>
                      {lastUpdate && <span>{lastUpdate}</span>}
                    </div>
                  </button>
              );
            };
            return (
              <div className="space-y-20">
                {orderedSections.map((group) => {
                  const subgroups = subgroupByRound(group.scenes);
                  return (
                    <section key={group.key}>
                      <header className="mb-8">
                        <div className="flex items-baseline justify-between gap-6">
                          <h2 className="font-serif text-2xl md:text-3xl font-normal tracking-tight text-foreground">
                            {group.label}
                          </h2>
                          <span className="text-xs font-sans text-muted-foreground tabular-nums">
                            {group.scenes.length} {group.scenes.length === 1 ? "scene" : "scenes"}
                          </span>
                        </div>
                        <div className="mt-4 h-px w-full bg-border/60" />
                      </header>
                      <div className="space-y-12">
                        {subgroups.map(([roundNumber, scenesInRound]) => (
                          <div key={roundNumber}>
                            {subgroups.length > 1 && (
                              <div className="mb-6 flex items-center gap-4">
                                <div className="h-px w-10 bg-gold-muted" />
                                <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-gold font-sans">
                                  Round {roundNumber.toString().padStart(2, "0")}
                                </span>
                                <div className="h-px flex-1 bg-gold-muted" />
                              </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                              {scenesInRound.map((scene) => renderSceneCard(scene))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            );
          })()}
        </div>
      );
    }

    // Level 2: Client → projects
    if (selectedClient) {
      return (
        <div>
          {selectedClient.projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-20 border-2 border-dashed border-border rounded-[32px] bg-card">
              <p className="text-muted-foreground text-sm">
                No projects for this client yet.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {selectedClient.projects.map((project) =>
                renderProjectCard(project, () => setSelectedProject(project)),
              )}
            </div>
          )}
        </div>
      );
    }

    // Level 1: All clients with their projects, vertically separated
    if (clients.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center p-20 border-2 border-dashed border-border rounded-[32px] bg-card">
          <p className="text-muted-foreground text-sm">No projects yet.</p>
        </div>
      );
    }

    return (
      <div className="space-y-14">
        {clients.map((client, idx) => {
          const label = clientLabel(client);
          const totalScenes = client.projects.reduce(
            (sum, p) => sum + p.scenes.length,
            0
          );
          return (
            <motion.section
              key={client.user_id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.04 }}
              className="space-y-5"
            >
              <button
                type="button"
                onClick={() => setSelectedClient(client)}
                className="group flex w-full items-end justify-between border-b border-border pb-4 text-left"
              >
                <div>
                  <div className="mb-2 flex items-center gap-3">
                    <div className="h-px w-8 bg-gold-muted" />
                    <span className="text-label-gold">Client</span>
                  </div>
                  <h2 className="font-serif text-2xl tracking-tight text-foreground md:text-3xl group-hover:text-primary transition-colors">
                    {label.toUpperCase()}
                  </h2>
                </div>
                <div className="flex items-center gap-4 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  <span>
                    {client.projects.length} project
                    {client.projects.length !== 1 ? "s" : ""}
                  </span>
                  <span>·</span>
                  <span>
                    {totalScenes} scene{totalScenes !== 1 ? "s" : ""}
                  </span>
                  <ChevronRight
                    size={16}
                    className="text-muted-foreground group-hover:text-primary"
                  />
                </div>
              </button>

              {client.projects.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No projects for this client yet.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {client.projects.map((project) =>
                    renderProjectCard(project, () => {
                      setSelectedClient(client);
                      setSelectedProject(project);
                    }),
                  )}
                </div>
              )}
            </motion.section>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      {/* Header */}
      <div className="mb-12 animate-fade-in">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-px w-8 bg-primary" />
          <span className="text-label-gold">Project Management</span>
        </div>

        <motion.div
          key={breadcrumbs.map((b) => b.label).join("/")}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4">
            {selectedRound
              ? `ROUND ${selectedRound.round_number
                  .toString()
                  .padStart(2, "0")}`
              : selectedScene
              ? selectedScene.name.toUpperCase()
              : selectedProject
              ? selectedProject.name.toUpperCase()
              : selectedClient
              ? clientLabel(selectedClient).toUpperCase()
              : "ALL CLIENTS"}
          </h1>
        </motion.div>

        <div className="flex items-center justify-between">
          <ArborescenceTitle items={breadcrumbs} />
          {selectedClient && !selectedProject && selectedClient.account_id && (
            <button
              type="button"
              onClick={() => navigate(`/admin/clients/${selectedClient.account_id}`)}
              className="font-sans uppercase text-foreground/55 hover:text-foreground transition-colors bg-transparent border-0 p-0 cursor-pointer"
              style={{ fontSize: 10, letterSpacing: "0.18em" }}
            >
              View profile →
            </button>
          )}
          {!selectedClient && (
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground cursor-pointer select-none">
                <Switch
                  checked={showArchived}
                  onCheckedChange={setShowArchived}
                />
                Show archived
              </label>
            <Dialog
              open={isAddDialogOpen}
              onOpenChange={setIsAddDialogOpen}
            >
              <DialogTrigger asChild>
                <button className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full text-sm font-medium hover:bg-primary/90 transition-all shadow-lg shadow-primary/10 dark:shadow-none font-sans">
                  <Plus size={18} />
                  New Project
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Project</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <label className="text-label text-muted-foreground">
                      PROJECT NAME
                    </label>
                    <Input
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder="The Emory Hotel"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-label text-muted-foreground">
                      CLIENT
                    </label>
                    <Select
                      value={selectedClientId}
                      onValueChange={setSelectedClientId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a client" />
                      </SelectTrigger>
                      <SelectContent>
                        {allClientOptions.map((c) => (
                          <SelectItem key={c.user_id} value={c.user_id}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-label text-muted-foreground">
                      DROPBOX FOLDER
                    </label>
                    <Input
                      type="url"
                      value={newProjectDropboxUrl}
                      onChange={(e) => setNewProjectDropboxUrl(e.target.value)}
                      placeholder="https://www.dropbox.com/home/..."
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleCreateProject}
                    disabled={isCreating}
                  >
                    {isCreating ? "Creating..." : "Create Project"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${selectedClient?.user_id || "home"}-${
            selectedProject?.id || ""
          }-${selectedScene?.id || ""}-${selectedRound?.id || ""}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.25 }}
        >
          {renderContent()}
        </motion.div>
      </AnimatePresence>

      <Dialog open={editProjectOpen} onOpenChange={(open) => {
        setEditProjectOpen(open);
        if (!open) setEditProjectTarget(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editProjectTarget?.name ?? "Edit Project"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <label className="text-label text-muted-foreground">
                DROPBOX FOLDER
              </label>
              <Input
                type="url"
                value={editProjectDropboxUrl}
                onChange={(e) => setEditProjectDropboxUrl(e.target.value)}
                placeholder="https://www.dropbox.com/home/..."
              />
            </div>
            <Button
              className="w-full"
              onClick={handleSaveProjectDropbox}
              disabled={isSavingProject}
            >
              {isSavingProject ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {projectToArchive && (
        <ArchiveProjectDialog
          projectId={projectToArchive.id}
          projectName={projectToArchive.name}
          open={!!projectToArchive}
          onOpenChange={(open) => {
            if (!open) setProjectToArchive(null);
          }}
          onArchived={() => {
            setProjectToArchive(null);
            // If we were drilled into the archived project, pop back up.
            if (selectedProject?.id === projectToArchive.id) {
              setSelectedProject(null);
              setSelectedScene(null);
              setSelectedRound(null);
            }
            fetchData();
          }}
        />
      )}
    </AdminLayout>
  );
}
