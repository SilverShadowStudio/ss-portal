import { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Clock, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ClientLayout } from "@/components/ClientLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ArborescenceTitle } from "@/components/client/ArborescenceTitle";
import { LaneCard } from "@/components/client/LaneCard";
import { TaskDetail } from "@/components/client/TaskDetail";
import { SmartImage, preloadImages } from "@/components/ui/SmartImage";
import { NewProjectModal } from "@/components/client/NewProjectModal";
import { NewSceneModal } from "@/components/client/NewSceneModal";
import { NewRoundModal } from "@/components/client/NewRoundModal";
import {
  getStatusPhase,
  getSceneEffectivePhase,
  getPhaseDot,
  getProjectRollup,
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
  scenes: Scene[];
}

export default function Portfolio() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sceneRounds, setSceneRounds] = useState<Map<string, SceneRound[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isNewSceneModalOpen, setIsNewSceneModalOpen] = useState(false);
  const [isNewRoundModalOpen, setIsNewRoundModalOpen] = useState(false);
  const { user } = useAuth();

  // Drill-down state
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [selectedRound, setSelectedRound] = useState<SceneRound | null>(null);
  const location = useLocation();

  // Long-press / drag to reorder scenes. 250ms hold + 8px tolerance keeps
  // taps and clicks intact on cards.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  useEffect(() => {
    fetchProjects();
  }, []);

  // Honor a sceneId / projectId passed via navigation state (e.g. from the
  // dashboard pipeline) and auto-drill to the requested scene once data loads.
  useEffect(() => {
    const navState = location.state as {
      sceneId?: string;
      projectId?: string;
      roundId?: string;
    } | null;
    if (!navState?.sceneId || projects.length === 0) return;
    const project = projects.find(
      (p) => p.id === navState.projectId || p.scenes.some((s) => s.id === navState.sceneId)
    );
    if (!project) return;
    const scene = project.scenes.find((s) => s.id === navState.sceneId);
    if (!scene) return;
    setSelectedProject(project);
    setSelectedScene(scene);
    // If a specific round was requested, drill straight into it (e.g. the
    // dashboard hero card linking to the latest delivery). Otherwise just
    // open the scene.
    const requestedRound = navState.roundId
      ? sceneRounds.get(scene.id)?.find((r) => r.id === navState.roundId) ?? null
      : null;
    setSelectedRound(requestedRound);
    // Clear the state so refresh / back nav doesn't keep re-triggering.
    window.history.replaceState({}, "");
  }, [projects, location.state, sceneRounds]);

  // Keyboard navigation — when a round is open, ← / → flick to the previous
  // or next sibling round on the same scene. Skips when focus is in an input
  // or textarea so typing feedback isn't hijacked.
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
      const list = (sceneRounds.get(selectedScene.id) || []).slice().sort(
        (a, b) => a.round_number - b.round_number
      );
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

  // Preload every sibling round's visual the moment a scene is opened, so
  // arrow-key flicking between rounds swaps the image instantly from the
  // browser cache instead of waiting on a network round-trip.
  useEffect(() => {
    if (!selectedScene) return;
    const list = sceneRounds.get(selectedScene.id) || [];
    preloadImages(list.map((r) => r.preview_url));
  }, [selectedScene, sceneRounds]);

  // When a project is opened, preload every round image across all of its
  // scenes so navigating into scenes/rounds renders instantly from cache.
  useEffect(() => {
    if (!selectedProject) return;
    const urls: string[] = [];
    for (const scene of selectedProject.scenes) {
      const rounds = sceneRounds.get(scene.id) || [];
      for (const r of rounds) {
        if (r.preview_url) urls.push(r.preview_url);
      }
    }
    preloadImages(urls);
  }, [selectedProject, sceneRounds]);

  async function fetchProjects() {
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) return;

      // Resolve the user's account (Owner/Member of one company account).
      // RLS now scopes projects by account_id, not user_id.
      const { data: membership } = await supabase
        .from("account_members")
        .select("account_id")
        .eq("user_id", session.session.user.id)
        .maybeSingle();

      if (!membership?.account_id) {
        setProjects([]);
        setSceneRounds(new Map());
        return;
      }

      const { data: projectsData, error } = await supabase
        .from("projects")
        .select("id, name, status")
        .eq("account_id", membership.account_id)
        .eq("status", "active");

      if (error) throw error;

      const projectIds = (projectsData || []).map((p) => p.id);

      // Batch: fetch all scenes for all projects in one query
      const { data: allScenes } = projectIds.length
        ? await supabase
            .from("scenes")
            .select("id, name, status, current_round, paid_rounds, project_id, next_delivery_at, created_at")
            .in("project_id", projectIds)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true })
        : { data: [] as any[] };

      const sceneIds = (allScenes || []).map((s: any) => s.id);

      // Batch: fetch all rounds for all scenes in one query
      const { data: allRounds } = sceneIds.length
        ? await supabase
            .from("scene_rounds")
            .select("id, round_number, status, delivered_at, image_url, start_date, end_date, scene_id, kind")
            .in("scene_id", sceneIds)
            // Review rounds are a timeline-only artifact and must not show
            // up as separate cards in the per-scene round list.
            .eq("kind", "production")
            .order("round_number", { ascending: true })
        : { data: [] as any[] };

      // Resolve a preview URL per round from the most recent uploaded asset.
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
          if (previewByRoundId.has(key)) continue;
          const rawPath = (a as any).storage_path as string | null;
          if (!rawPath) continue;
          // storage_path is the filename only — strip any accidental leading slash
          // so getPublicUrl doesn't produce a double slash in the resulting URL.
          const path = rawPath.replace(/^\/+/, "");
          const { data: urlData } = supabase.storage
            .from("round-uploads")
            .getPublicUrl(path);
          previewByRoundId.set(key, urlData.publicUrl);
        }
      }

      // Group rounds by scene_id
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

      // Group scenes by project_id
      const scenesByProject = new Map<string, Scene[]>();
      for (const scene of allScenes || []) {
        const existing = scenesByProject.get(scene.project_id) || [];
        existing.push(scene as Scene);
        scenesByProject.set(scene.project_id, existing);
      }

      const projectList: Project[] = (projectsData || []).map((project) => ({
        ...project,
        scenes: scenesByProject.get(project.id) || [],
      }));

      setProjects(projectList);
      setSceneRounds(roundsMap);
    } catch (error) {
      console.error("Error fetching projects:", error);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Pick the preview image for a project card: the latest delivered round of
   * the most recently delivered scene. Falls back to whatever recent uploaded
   * preview we can find so the card never goes blank once a render exists.
   */
  const getProjectPreview = (project: Project): string | null => {
    // Prefer the most recent round currently "awaiting review" (delivered or
    // client_review) — that's the one the client needs to act on. Fall back
    // to any preview so the card never goes blank.
    let best: { delivered_at: number; round_number: number; preview: string } | null = null;
    let fallback: string | null = null;
    for (const scene of project.scenes) {
      const rounds = sceneRounds.get(scene.id) || [];
      for (const r of rounds) {
        if (!r.preview_url) continue;
        if (!fallback) fallback = r.preview_url;
        if (r.status !== "delivered" && r.status !== "client_review") continue;
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

  // Project rollup wrapper — supplies the per-scene round lookup so the
  // shared utility can compute the highest-priority phase across scenes.
  const projectRollup = (project: Project) =>
    getProjectRollup(project.scenes, (s) => sceneRounds.get(s.id) || []);

  // Build the single-line summary shown on the project card. Strict priority:
  //   1) any scenes awaiting review  -> "X scene(s) awaiting review"
  //   2) else any scenes in production -> "X scene(s) in production"
  //   3) else if all approved        -> "All scenes validated"
  const getProjectSummary = (project: Project): string => {
    if (project.scenes.length === 0) return "No scenes yet";
    const phases = project.scenes.map((s) =>
      getSceneEffectivePhase(s, sceneRounds.get(s.id) || [])
    );
    const awaiting = phases.filter((p) => p === "Awaiting Review").length;
    if (awaiting > 0)
      return `${awaiting} scene${awaiting !== 1 ? "s" : ""} awaiting review`;
    const inProd = phases.filter((p) => p === "In Production").length;
    if (inProd > 0)
      return `${inProd} scene${inProd !== 1 ? "s" : ""} in production`;
    if (phases.every((p) => p === "Approved")) return "All scenes validated";
    return `${project.scenes.length} scene${project.scenes.length !== 1 ? "s" : ""}`;
  };

  // Build the bottom-of-card estimate label for a round.
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

  const handleCreateProject = async (title: string) => {
    if (!user) return;

    try {
      // Look up the caller's account so the new project satisfies the
      // "Members can insert account projects" RLS check.
      const { data: membership, error: memErr } = await supabase
        .from("account_members")
        .select("account_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (memErr) throw memErr;
      if (!membership?.account_id) {
        toast.error("No company account found for this user");
        return;
      }

      const { data, error } = await supabase
        .from("projects")
        .insert({
          name: title,
          user_id: user.id,
          account_id: membership.account_id,
          status: "active",
        })
        .select("id, name, status")
        .single();

      if (error) throw error;

      const newProject: Project = { ...data, scenes: [] };

      // 1. Update state — prepend new project
      setProjects((prev) => [newProject, ...prev]);

      // 2. Auto-drilldown into the new project
      setSelectedProject(newProject);
      setSelectedScene(null);
      setSelectedRound(null);

      // 3. Close modal
      setIsNewTaskModalOpen(false);

      toast.success("Project created");

      // 4. CHAIN: Open Scene Modal after 300ms
      setTimeout(() => setIsNewSceneModalOpen(true), 300);
    } catch (error: any) {
      console.error("Error creating project:", error);
      toast.error(error.message || "Failed to create project");
    }
  };

  const handleCreateScene = async (title: string) => {
    if (!selectedProject || !user) return;

    try {
      const { data, error } = await supabase
        .from("scenes")
        .insert({
          name: title,
          project_id: selectedProject.id,
          status: "pending_instruction",
          current_round: 1,
          paid_rounds: 2,
        })
        .select("id, name, status, current_round, paid_rounds, project_id, next_delivery_at")
        .single();

      if (error) throw error;

      const newScene: Scene = data;
      // Activity log: scene creation (admin in Portfolio drilldown).
      try {
        const { logActivity } = await import("@/lib/activityLog");
        await logActivity({
          action: "scene_created",
          description: `Created scene "${title}"`,
          entityType: "scene",
          entityId: newScene.id,
          sceneId: newScene.id,
          sceneName: title,
          projectId: selectedProject.id,
          projectName: selectedProject.name,
        });
      } catch {}

      // Update project's scenes in local state
      const updatedProject = {
        ...selectedProject,
        scenes: [...selectedProject.scenes, newScene],
      };
      setProjects((prev) =>
        prev.map((p) => (p.id === selectedProject.id ? updatedProject : p))
      );
      setSelectedProject(updatedProject);

      // Auto-drilldown into the new scene
      setSelectedScene(newScene);
      setSelectedRound(null);

      // Initialize empty rounds map for the new scene
      setSceneRounds((prev) => new Map(prev).set(newScene.id, []));

      // Close modal
      setIsNewSceneModalOpen(false);

      toast.success("Scene created");

      // CHAIN: Open Round Modal after 300ms
      setTimeout(() => setIsNewRoundModalOpen(true), 300);
    } catch (error: any) {
      console.error("Error creating scene:", error);
      toast.error(error.message || "Failed to create scene");
    }
  };

  const handleCreateRound = async (instructions: string, deliveryDate?: Date, startDate?: Date) => {
    if (!selectedProject || !selectedScene) return;

    try {
      const existingRounds = sceneRounds.get(selectedScene.id) || [];
      const nextRoundNumber = existingRounds.length + 1;

      const startIso = (startDate ?? new Date()).toISOString();

      const { data, error } = await supabase
        .from("scene_rounds")
        .insert({
          scene_id: selectedScene.id,
          round_number: nextRoundNumber,
          status: "pending",
          start_date: startIso,
          instructions: instructions,
          ...(deliveryDate ? { end_date: deliveryDate.toISOString() } : {}),
        })
        .select("id, round_number, status, delivered_at, image_url, start_date, end_date, instructions")
        .single();

      if (error) throw error;

      const newRound: SceneRound = data;

      // Update rounds map
      setSceneRounds((prev) => {
        const updated = new Map(prev);
        const current = updated.get(selectedScene.id) || [];
        updated.set(selectedScene.id, [...current, newRound]);
        return updated;
      });

      // Auto-drilldown into the new round
      setSelectedRound(newRound);

      // Close modal
      setIsNewRoundModalOpen(false);

      toast.success("Round created — production will begin shortly");
    } catch (error: any) {
      console.error("Error creating round:", error);
      toast.error(error.message || "Failed to create round");
    }
  };

  // Build breadcrumbs
  const breadcrumbs = useMemo(() => {
    const items = [
      {
        label: "Projects",
        onClick: selectedProject
          ? () => {
              setSelectedProject(null);
              setSelectedScene(null);
              setSelectedRound(null);
            }
          : undefined,
      },
    ];

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
        // The scene IS the round detail view now — no intermediate page to
        // jump back to.
        onClick: undefined,
      });
    }

    return items;
  }, [selectedProject, selectedScene, selectedRound]);

  // A scene has a round "in production" when at least one of its rounds is
  // neither delivered nor approved. While that's the case we hide the
  // "New Round" header button so the client can't queue another one.
  const hasRoundInProduction = useMemo(() => {
    if (!selectedScene) return false;
    const rounds = sceneRounds.get(selectedScene.id) || [];
    return rounds.some((r) => r.status !== "delivered" && r.status !== "client_review" && r.status !== "approved");
  }, [selectedScene, sceneRounds]);

  if (loading) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </ClientLayout>
    );
  }

  // Determine what to render based on drill-down depth
  const renderContent = () => {
    // Level 4: Round Detail (TaskDetail)
    if (selectedProject && selectedScene && selectedRound) {
      const sceneRoundsList = sceneRounds.get(selectedScene.id) || [];
      const nextRoundNumber = sceneRoundsList.length + 1;
      // Only offer "Request next round" when:
      //  - the user is on the latest round of the scene, AND
      //  - that round is delivered/approved, AND
      //  - no other round is still in production.
      const isLatestRound =
        selectedRound.round_number ===
        Math.max(...sceneRoundsList.map((r) => r.round_number), 0);
      const canRequestNext =
        isLatestRound &&
        (selectedRound.status === "delivered" ||
          selectedRound.status === "approved") &&
        !hasRoundInProduction;
      // When the client is on an older round, lock it for new feedback and
      // point them at the round immediately following the highest delivered
      // round on the same scene.
      const highestDeliveredRoundNumber = Math.max(
        ...sceneRoundsList
          .filter((r) => r.status === "delivered" || r.status === "client_review" || r.status === "approved")
          .map((r) => r.round_number),
        0,
      );
      const successorRoundNumber = !isLatestRound && highestDeliveredRoundNumber > 0
        ? highestDeliveredRoundNumber
        : undefined;
      return (
        <TaskDetail
          roundId={selectedRound.id}
          projectName={selectedProject.name}
          sceneName={selectedScene.name}
          roundNumber={selectedRound.round_number}
          roundStatus={selectedRound.status}
          deliveredAt={selectedRound.delivered_at}
          startDate={selectedRound.start_date}
          endDate={selectedRound.end_date}
          onRequestNextRound={
            canRequestNext
              ? () => setIsNewRoundModalOpen(true)
              : undefined
          }
          nextRoundNumber={canRequestNext ? nextRoundNumber : undefined}
          isLocked={!isLatestRound}
          successorRoundNumber={successorRoundNumber}
          siblingRounds={sceneRoundsList.map((r) => ({
            id: r.id,
            round_number: r.round_number,
            status: r.status,
          }))}
          onSelectRound={(rid) => {
            const target = sceneRoundsList.find((r) => r.id === rid);
            if (target) setSelectedRound(target);
          }}
        />
      );
    }

    // Level 3: Scene → show rounds as cards
    if (selectedProject && selectedScene) {
      const rounds = sceneRounds.get(selectedScene.id) || [];
      // The "rounds as cards" intermediate page has been removed — clicking
      // a scene now jumps straight to the round detail. The only reason we
      // can land here is when the scene has zero rounds yet.
      return (
        <div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center p-20 border-2 border-dashed border-border rounded-[32px] bg-card"
          >
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-6">
              <Plus size={32} />
            </div>
            <h3 className="text-xl font-medium mb-2 font-serif">No rounds yet</h3>
            <p className="text-muted-foreground text-center max-w-sm font-sans text-sm">
              Rounds will appear here once production begins.
            </p>
            <button
              onClick={() => setIsNewRoundModalOpen(true)}
              className="flex items-center gap-2 px-6 py-3 mt-6 border-l-2 border-gold text-foreground text-[11px] uppercase tracking-[0.18em] font-medium hover:bg-foreground/5 transition-all font-sans"
            >
              <Plus size={18} />
              New Round
            </button>
          </motion.div>
        </div>
      );
    }

    // Level 2: Project → show scenes as cards
    if (selectedProject) {
      return (
        <div>
          {selectedProject.scenes.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center p-20 border-2 border-dashed border-border rounded-[32px] bg-card"
            >
              <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-6">
                <Plus size={32} />
              </div>
              <h3 className="text-xl font-medium mb-2 font-serif">No scenes yet</h3>
              <p className="text-muted-foreground text-center max-w-sm font-sans text-sm">
                Scenes will appear here once they are added to this project.
              </p>
              <button
                onClick={() => setIsNewSceneModalOpen(true)}
                className="flex items-center gap-2 px-6 py-3 mt-6 border-l-2 border-gold text-foreground text-[11px] uppercase tracking-[0.18em] font-medium hover:bg-foreground/5 transition-all font-sans"
              >
                <Plus size={18} />
                New Scene
              </button>
            </motion.div>
          ) : (
            (() => {
              // Apple-style organisation:
              //   1. Top    — Awaiting Review (action needed from client)
              //   2.        — Awaiting Brief
              //   3.        — Approved
              //   4. Bottom — In Production (we're working on it)
              // Inside each section, scenes are sub-grouped by their *current*
              // round number (lowest first), so all "Round 01" scenes appear
              // above "Round 02" scenes within the same phase.
              type SceneItem = (typeof selectedProject.scenes)[number];
              type SceneGroup = {
                key: string;
                label: string;
                scenes: SceneItem[];
              };
              const groups: Record<string, SceneGroup> = {
                review: { key: "review", label: "Awaiting Review", scenes: [] },
                brief: { key: "brief", label: "Awaiting Brief", scenes: [] },
                approved: { key: "approved", label: "Approved", scenes: [] },
                other: { key: "other", label: "Other", scenes: [] },
                production: { key: "production", label: "In Production", scenes: [] },
              };
              // Resolve the round number to sort a scene by — use the latest
              // round it has, falling back to its declared current_round.
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
              // Sort each group by round number ascending (Round 01 first).
              for (const g of Object.values(groups)) {
                g.scenes.sort((a, b) => sceneRoundNumber(a) - sceneRoundNumber(b));
              }
              const ordered = ["review", "brief", "approved", "other", "production"]
                .map((k) => groups[k])
                .filter((g) => g.scenes.length > 0);
              // Within a section, split scenes into round-number sub-groups
              // so "Round 01" scenes sit above "Round 02" scenes, etc.
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

              const handleDragEnd = async (
                ev: DragEndEvent,
                scenesInGroup: SceneItem[]
              ) => {
                const { active, over } = ev;
                if (!over || active.id === over.id) return;
                const oldIdx = scenesInGroup.findIndex((s) => s.id === active.id);
                const newIdx = scenesInGroup.findIndex((s) => s.id === over.id);
                if (oldIdx < 0 || newIdx < 0) return;
                const reorderedSubset = arrayMove(scenesInGroup, oldIdx, newIdx);
                // Splice reordered subset back into the project's full scene
                // list, preserving the positions of scenes from other groups.
                const subsetIds = new Set(scenesInGroup.map((s) => s.id));
                const queue = [...reorderedSubset];
                const newProjectScenes = selectedProject.scenes.map((s) =>
                  subsetIds.has(s.id) ? queue.shift()! : s
                );
                const updated: Project = { ...selectedProject, scenes: newProjectScenes };
                setSelectedProject(updated);
                setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
                // Persist sort_order for affected scenes.
                try {
                  await Promise.all(
                    newProjectScenes.map((s, i) =>
                      supabase.from("scenes").update({ sort_order: i }).eq("id", s.id)
                    )
                  );
                } catch (err) {
                  console.error("Failed to persist scene order", err);
                  toast.error("Couldn't save new order");
                }
              };

              const SortableSceneCard = ({ scene }: { scene: SceneItem }) => {
                const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
                  useSortable({ id: scene.id });
                const style: React.CSSProperties = {
                  transform: CSS.Transform.toString(transform),
                  transition,
                  opacity: isDragging ? 0.6 : 1,
                  zIndex: isDragging ? 10 : "auto",
                };
                return (
                  <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
                    {renderSceneCard(scene)}
                  </div>
                );
              };

              const renderSceneCard = (scene: typeof selectedProject.scenes[number]) => {
                const rounds = sceneRounds.get(scene.id) || [];
                const deliveredRounds = rounds.filter(
                  (r) => (r.status === "delivered" || r.status === "client_review" || r.status === "approved") && r.preview_url
                );
                const latestRound =
                  deliveredRounds.sort((a, b) => b.round_number - a.round_number)[0] ||
                  [...rounds].sort((a, b) => b.round_number - a.round_number)[0];
                const phase = getSceneEffectivePhase(scene, rounds);
                const sceneDot = getPhaseDot(phase);
                const isAwaitingReview = phase === "Awaiting Review";
                const isAwaitingBrief = phase === "Awaiting Brief";
                const isEmpty = rounds.length === 0;
                const borderClass = isAwaitingReview
                  ? "border-l-2 border-gold"
                  : isAwaitingBrief
                  ? "border-l-2 border-foreground/25"
                  : "";
                return (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => {
                      setSelectedScene(scene);
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
                    className={cn(
                      "group relative block text-left w-full overflow-hidden rounded-sm bg-card transition-smooth",
                      borderClass,
                      isEmpty && "border border-foreground/[0.15]"
                    )}
                    style={{ aspectRatio: "4 / 3" }}
                  >
                    {isEmpty ? (
                      <div className="absolute inset-0 flex flex-col justify-end p-6">
                        <h3 className="font-serif text-xl text-foreground/80 leading-tight">
                          {scene.name}
                        </h3>
                        <p className="mt-2 text-[11px] uppercase tracking-[0.15em] text-muted-foreground/60 font-sans">
                          Brief pending
                        </p>
                      </div>
                    ) : (
                      <>
                        <SmartImage
                          src={latestRound?.preview_url ?? null}
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
                          alt={scene.name}
                          fallback={
                            <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground">
                              <Clock size={28} />
                            </div>
                          }
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
                        <div className="absolute inset-x-0 bottom-0 p-6">
                          <h3 className="font-serif text-xl md:text-2xl text-foreground leading-tight">
                            {scene.name}
                          </h3>
                          <p className="mt-2 text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-sans">
                            {rounds.length} round{rounds.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </>
                    )}
                  </button>
                );
              };

              return (
                <div className="space-y-20">
                  {ordered.map((group) => {
                    const subgroups = subgroupByRound(group.scenes);
                    return (
                      <section key={group.key}>
                        {/* Apple-style section header: large, light, generous spacing */}
                        <header className="mb-8">
                          <div className="flex items-baseline justify-between gap-6">
                            <h2 className="font-sans text-[11px] font-medium uppercase tracking-[0.15em] text-foreground/80">
                              {group.label}
                            </h2>
                            <span className="text-[11px] font-sans text-muted-foreground/60 tabular-nums tracking-[0.05em]">
                              {group.scenes.length} {group.scenes.length === 1 ? "scene" : "scenes"}
                            </span>
                          </div>
                          <div className="mt-3 h-px w-full bg-border/40" />
                        </header>
                        <div className="space-y-12">
                          {subgroups.map(([roundNumber, scenesInRound]) => (
                            <div key={roundNumber}>
                              {/* Round sub-label — only shown when the
                                  section actually contains more than one
                                  round, to keep things calm when not needed. */}
                              {subgroups.length > 1 && (
                                <div className="mb-6 flex items-center gap-4">
                                  <div className="h-px w-10 bg-gold-muted" />
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-gold font-sans">
                                    Round {roundNumber.toString().padStart(2, "0")}
                                  </span>
                                  <div className="h-px flex-1 bg-gold-muted" />
                                </div>
                              )}
                              <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={(ev) => handleDragEnd(ev, scenesInRound)}
                              >
                                <SortableContext
                                  items={scenesInRound.map((s) => s.id)}
                                  strategy={rectSortingStrategy}
                                >
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {scenesInRound.map((scene) => (
                                      <SortableSceneCard key={scene.id} scene={scene} />
                                    ))}
                                  </div>
                                </SortableContext>
                              </DndContext>
                            </div>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              );
            })()
          )}
        </div>
      );
    }

    // Level 1: All projects
    return (
      <div>
        {projects.length === 0 ? (
          <motion.div
            key="projects-empty"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center p-20 border border-dashed border-border rounded-sm bg-card"
          >
            <div className="w-16 h-16 rounded-sm bg-primary/10 text-primary flex items-center justify-center mb-6">
              <Plus size={32} />
            </div>
            <h3 className="text-xl font-medium mb-3 font-serif">Create your first project</h3>
            <p className="text-muted-foreground mb-8 text-center max-w-sm font-sans leading-relaxed">
              Start by creating a new project to manage your visualisation tasks and deliverables.
            </p>
            <button
              onClick={() => setIsNewTaskModalOpen(true)}
              className="flex items-center gap-2 px-6 py-3 border-l-2 border-gold text-foreground text-[11px] uppercase tracking-[0.18em] font-medium hover:bg-foreground/5 transition-all font-sans"
            >
              <Plus size={16} />
              New Project
            </button>
          </motion.div>
        ) : projects.length === 1 ? (
          (() => {
            const project = projects[0];
            const rollup = projectRollup(project);
            const preview = getProjectPreview(project);
            return (
              <motion.button
                key="projects-featured"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => setSelectedProject(project)}
                className="group relative w-full overflow-hidden rounded-sm bg-card text-left transition-smooth"
                style={{ aspectRatio: "16 / 7" }}
              >
                <SmartImage
                  src={preview ?? null}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
                  alt={project.name}
                  fallback={
                    <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground">
                      <Clock size={32} />
                    </div>
                  }
                />
                <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to top, #121110 0%, transparent 50%)" }} />
                <div className="absolute inset-x-0 bottom-0 p-10 md:p-14">
                  {rollup.phase && (
                    <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-[hsl(var(--gold))] mb-3 font-sans">
                      {rollup.phase}
                    </p>
                  )}
                  <h2 className="font-serif text-3xl md:text-4xl font-normal tracking-[0.02em] text-white leading-tight">
                    {project.name}
                  </h2>
                  <p className="mt-3 text-sm text-muted-foreground font-sans leading-relaxed">
                    {getProjectSummary(project)}
                  </p>
                </div>
              </motion.button>
            );
          })()
        ) : (
          <motion.div
            key="projects-list"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {projects.map((project) => {
              const rollup = projectRollup(project);
              return (
                <LaneCard
                  key={project.id}
                  id={project.id}
                  phase={rollup.phase}
                  dot={rollup.dot}
                  title={project.name}
                  previewUrl={getProjectPreview(project) ?? undefined}
                  estimate={getProjectSummary(project)}
                  onClick={() => setSelectedProject(project)}
                />
              );
            })}
          </motion.div>
        )}
      </div>
    );
  };

  return (
    <>
    <ClientLayout>
      {/* Header */}
      <div className="mb-12 animate-fade-in">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-px w-10 bg-gold-muted" />
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-gold font-sans">Portfolio</span>
        </div>

        <motion.div
          // Hopping between sibling rounds on the same scene must NOT
          // re-trigger the title fade — only deeper navigation changes
          // (project / scene level) should re-animate the H1.
          key={`${selectedProject?.id || "home"}-${selectedScene?.id || ""}-${selectedRound ? "round" : ""}`}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4">
            {selectedRound
              ? `ROUND ${selectedRound.round_number.toString().padStart(2, "0")}`
              : selectedScene
              ? selectedScene.name.toUpperCase()
              : selectedProject
              ? selectedProject.name.toUpperCase()
              : "YOUR COMMISSIONS"}
          </h1>
          {!selectedProject && !selectedScene && !selectedRound && (
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[hsl(var(--gold))]/70 font-sans mb-2">
              Active
            </p>
          )}
        </motion.div>

        <div className="flex items-center justify-between">
          <ArborescenceTitle items={breadcrumbs} />
          {!selectedRound && !(selectedScene && hasRoundInProduction) && (
            <button
              onClick={() => {
                if (selectedScene) {
                  setIsNewRoundModalOpen(true);
                } else if (selectedProject) {
                  setIsNewSceneModalOpen(true);
                } else {
                  setIsNewTaskModalOpen(true);
                }
              }}
              className="flex items-center gap-2 px-6 py-3 border-l-2 border-gold text-foreground text-[11px] uppercase tracking-[0.18em] font-medium hover:bg-foreground/5 transition-all font-sans"
            >
              <Plus size={18} />
              {selectedScene ? "New Round" : selectedProject ? "New Scene" : "New Project"}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          // Keyed only on project + scene (and a flat "round" marker), so
          // switching between Round 01 / Round 02 / Round 03 of the same
          // scene keeps the same React subtree alive — the visuals flick
          // into each other without an exit/enter fade.
          key={`${selectedProject?.id || "home"}-${selectedScene?.id || ""}-${selectedRound ? "round" : ""}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.25 }}
        >
          {renderContent()}
        </motion.div>
      </AnimatePresence>
    </ClientLayout>
    <NewProjectModal
      isOpen={isNewTaskModalOpen}
      onClose={() => setIsNewTaskModalOpen(false)}
      onCreate={handleCreateProject}
    />
    <NewSceneModal
      isOpen={isNewSceneModalOpen}
      onClose={() => setIsNewSceneModalOpen(false)}
      onCreate={handleCreateScene}
      projectName={selectedProject?.name}
    />
    <NewRoundModal
      isOpen={isNewRoundModalOpen}
      onClose={() => setIsNewRoundModalOpen(false)}
      onCreate={handleCreateRound}
      onCreateWithDate={handleCreateRound}
      sceneName={selectedScene?.name}
      sceneId={selectedScene?.id}
      roundNumber={selectedScene ? (sceneRounds.get(selectedScene.id)?.length || 0) + 1 : 1}
    />
    </>
  );
}
