import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Clock, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { DURATION, FM_EASE } from "@/lib/motion";
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
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ArborescenceTitle } from "@/components/client/ArborescenceTitle";
import { LaneCard } from "@/components/client/LaneCard";
import { TaskDetail } from "@/components/client/TaskDetail";
import { SmartImage, preloadImages } from "@/components/ui/SmartImage";
import { NewProjectModal } from "@/components/client/NewProjectModal";
import { NewSceneModal } from "@/components/client/NewSceneModal";
import { NewRoundModal } from "@/components/client/NewRoundModal";
import { RescheduleRoundModal } from "@/components/client/RescheduleRoundModal";
import { BookingModal } from "@/components/client/BookingModal";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { computeRoundSchedule } from "@/lib/roundSchedule";
import { logActivity } from "@/lib/activityLog";
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
  /** Idle weeks between this round's delivery and the next round's start.
   *  Default 1 (matches pre-buffer scheduling). Range 1-12 in the UI. */
  buffer_weeks?: number | null;
  /** Resolved preview URL — either image_url or the latest uploaded asset. */
  preview_url?: string | null;
  /** True for rounds imported from Dropbox VS_Visuals history at scene-link time. */
  is_legacy?: boolean | null;
}

// ── Future-booking predicates (Isabelle button) ──
// A "booked" round is a pending round whose production start is more than a
// week out — a slot held for the future rather than work starting now. No
// new status or column: it's derived from status='pending' + start_date.
const ROUND_BOOKING_LEAD_MS = 7 * 24 * 60 * 60 * 1000;
function isFutureBookedRound(round: { status: string; start_date: string | null }): boolean {
  if (round.status !== "pending" || !round.start_date) return false;
  return new Date(round.start_date).getTime() > Date.now() + ROUND_BOOKING_LEAD_MS;
}
/** A booked round stays editable until the Friday-noon cutoff before its start. */
function isBookedEditableRound(round: { status: string; start_date: string | null }): boolean {
  if (!isFutureBookedRound(round) || !round.start_date) return false;
  const cutoff = new Date(round.start_date);
  cutoff.setDate(cutoff.getDate() - 3); // Monday → previous Friday
  cutoff.setHours(12, 0, 0, 0);
  return Date.now() < cutoff.getTime();
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
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [bookingMode, setBookingMode] = useState<'calendar' | 'calendar_no_quote' | 'delivery' | 'delivery_no_quote'>('calendar');
  // When the user opens the Round modal on a scene that already has a
  // draft, we pre-load it here so the modal updates that row on save
  // (one-draft-per-scene rule, enforced at DB level by the partial unique
  // index added in migration 20260519000001).
  const [editingDraft, setEditingDraft] = useState<{ id: string; instructions: string | null; buffer_weeks: number | null; status?: string | null; start_date?: string | null } | null>(null);
  // Reschedule modal — the round being rescheduled is the currently
  // selected one (only ever surfaced from the in-production view).
  const [rescheduleTarget, setRescheduleTarget] = useState<SceneRound | null>(null);
  const { user } = useAuth();

  // Drill-down state
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [selectedRound, setSelectedRound] = useState<SceneRound | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Long-press / drag to reorder scenes. 250ms hold + 8px tolerance keeps
  // taps and clicks intact on cards.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  useEffect(() => {
    fetchProjects();
  }, []);

  // Honor a sceneId / projectId / roundId passed via navigation state
  // (e.g. dashboard pipeline) OR via query params (e.g. email deep-link
  // /portfolio?project=…&scene=…&round=…). Query params take precedence
  // over location.state. After consuming, both are cleared.
  useEffect(() => {
    if (projects.length === 0) return;

    const paramProject = searchParams.get("project");
    const paramScene = searchParams.get("scene");
    const paramRound = searchParams.get("round");
    const navState = location.state as {
      sceneId?: string;
      projectId?: string;
      roundId?: string;
    } | null;

    const sceneId = paramScene || navState?.sceneId;
    const projectId = paramProject || navState?.projectId;
    const roundId = paramRound || navState?.roundId;
    if (!sceneId && !projectId) return;

    const project = projects.find(
      (p) => p.id === projectId || (sceneId && p.scenes.some((s) => s.id === sceneId)),
    );
    if (!project) return;
    const scene = sceneId
      ? project.scenes.find((s) => s.id === sceneId)
      : null;

    setSelectedProject(project);
    if (scene) setSelectedScene(scene);
    const requestedRound = roundId && scene
      ? sceneRounds.get(scene.id)?.find((r) => r.id === roundId) ?? null
      : null;
    setSelectedRound(requestedRound);

    // Clear navigation state so refresh / back nav doesn't keep re-triggering.
    if (navState) window.history.replaceState({}, "");
    // Clear query params for the same reason. Use navigate(replace) so the
    // back button doesn't bounce the user out via the deep-link URL.
    if (paramProject || paramScene || paramRound) {
      navigate(location.pathname, { replace: true });
    }
  }, [projects, location.state, location.pathname, searchParams, sceneRounds, navigate]);

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

      const { data: accountData } = await supabase
        .from("accounts")
        .select("booking_mode")
        .eq("id", membership.account_id)
        .maybeSingle();
      setBookingMode((accountData?.booking_mode as 'calendar' | 'calendar_no_quote' | 'delivery' | 'delivery_no_quote') || 'calendar');

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
            .select("id, round_number, status, delivered_at, image_url, start_date, end_date, scene_id, kind, buffer_weeks, is_legacy")
            .in("scene_id", sceneIds)
            // Review rounds are a timeline-only artifact and must not show
            // up as separate cards in the per-scene round list.
            .eq("kind", "production")
            .order("round_number", { ascending: true })
        : { data: [] as any[] };

      // Resolve a preview URL per round — prefer Dropbox-delivered renders,
      // fall back to Supabase-uploaded assets.
      const roundIds = (allRounds || []).map((r: any) => r.id);
      const previewByRoundId = new Map<string, string>();
      if (roundIds.length) {
        const { data: assetRows } = await supabase
          .from("round_assets")
          .select("scene_round_id, storage_path, dropbox_path, source, created_at, is_current")
          .in("scene_round_id", roundIds)
          .eq("is_current", true)
          .order("created_at", { ascending: false });

        // Collect the most-recent asset per round, preferring Dropbox over upload.
        const dropboxByRound = new Map<string, any>();
        const uploadByRound = new Map<string, any>();
        for (const a of assetRows || []) {
          const key = (a as any).scene_round_id as string;
          if ((a as any).dropbox_path && !dropboxByRound.has(key)) {
            dropboxByRound.set(key, a);
          } else if ((a as any).source === "upload" && (a as any).storage_path && !uploadByRound.has(key)) {
            uploadByRound.set(key, a);
          }
        }

        // Resolve upload previews synchronously (Dropbox-covered rounds are skipped).
        for (const [key, a] of uploadByRound) {
          if (dropboxByRound.has(key)) continue;
          const rawPath = ((a as any).storage_path as string).replace(/^\/+/, "");
          const { data: urlData } = supabase.storage.from("scene-assets").getPublicUrl(rawPath);
          previewByRoundId.set(key, urlData.publicUrl);
        }

        // Resolve Dropbox previews via edge function (parallel).
        // Use the thumbnail endpoint, not get-temporary-link: grid cards only
        // need a 640x480 preview, not the full-resolution render. The lightbox
        // (AssetViewer) still fetches full-res when an asset is opened.
        if (dropboxByRound.size > 0) {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData?.session?.access_token;
          if (token) {
            await Promise.all(
              [...dropboxByRound.entries()].map(async ([key, a]) => {
                try {
                  const res = await fetch(
                    `${SUPABASE_URL}/functions/v1/dropbox-api?action=get-thumbnail`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ path: (a as any).dropbox_path, size: "w640h480" }),
                    }
                  );
                  if (res.ok) {
                    const data = await res.json();
                    if (data.thumbnail) previewByRoundId.set(key, data.thumbnail);
                  }
                } catch { /* ignore — round simply won't have a preview */ }
              })
            );
          }
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

  // Open the Round modal. If a draft round already exists for this scene
  // (enforced unique by the partial index in 20260519000001), preload it so
  // Save Draft updates that row and Submit For Production transitions it
  // out of draft state.
  const openRoundModalForScene = async (sceneId: string) => {
    try {
      // Prefer an in-progress draft; otherwise a future-booked pending round
      // that is still before its cutoff is editable too (Isabelle button).
      const { data } = await supabase
        .from("scene_rounds")
        .select("id, instructions, buffer_weeks, status, start_date")
        .eq("scene_id", sceneId)
        .in("status", ["draft", "pending"])
        .order("round_number", { ascending: false });
      const editable = (data ?? []).find(
        (r) =>
          r.status === "draft" ||
          isBookedEditableRound(r as { status: string; start_date: string | null }),
      );
      if (editable) {
        setEditingDraft({
          id: editable.id,
          instructions: editable.instructions,
          buffer_weeks: (editable as { buffer_weeks?: number | null }).buffer_weeks ?? null,
          status: editable.status,
          start_date: (editable as { start_date?: string | null }).start_date ?? null,
        });
      } else {
        setEditingDraft(null);
      }
    } catch (e) {
      console.warn("[Portfolio] draft lookup failed:", e);
      setEditingDraft(null);
    }
    setIsNewRoundModalOpen(true);
  };

  // Save Draft — persist instructions on the existing draft row (if any),
  // or INSERT a new scene_rounds row with status='draft'. The edge
  // functions (airtable-auto-sync, dropbox-save-round-files) skip drafts,
  // so nothing leaks outside the portal.
  const handleSaveDraft = async (instructions: string, bufferWeeks: number) => {
    if (!selectedScene) return;
    try {
      if (editingDraft) {
        const { data, error } = await supabase
          .from("scene_rounds")
          .update({ instructions, buffer_weeks: bufferWeeks, updated_at: new Date().toISOString() } as Record<string, unknown>)
          .eq("id", editingDraft.id)
          .select("id, round_number, status, delivered_at, image_url, start_date, end_date, instructions, buffer_weeks")
          .single();
        if (error) throw error;
        const updated: SceneRound = data;
        setSceneRounds((prev) => {
          const next = new Map(prev);
          const list = next.get(selectedScene.id) || [];
          next.set(selectedScene.id, list.map((r) => (r.id === updated.id ? updated : r)));
          return next;
        });
        toast.success("Draft saved");
      } else {
        const existingRounds = sceneRounds.get(selectedScene.id) || [];
        const nextRoundNumber = existingRounds.length + 1;
        const { data, error } = await supabase
          .from("scene_rounds")
          .insert({
            scene_id: selectedScene.id,
            round_number: nextRoundNumber,
            status: "draft",
            start_date: new Date().toISOString(),
            instructions,
            buffer_weeks: bufferWeeks,
          } as Record<string, unknown>)
          .select("id, round_number, status, delivered_at, image_url, start_date, end_date, instructions, buffer_weeks")
          .single();
        if (error) throw error;
        const newDraft: SceneRound = data;
        setSceneRounds((prev) => {
          const next = new Map(prev);
          const list = next.get(selectedScene.id) || [];
          next.set(selectedScene.id, [...list, newDraft]);
          return next;
        });
        // Fires only on first draft creation, never on subsequent updates.
        await logActivity({
          action: "round_drafted",
          actorRole: "client",
          description: `Round ${String(newDraft.round_number).padStart(2, "0")} saved as draft`,
          entityType: "scene_round",
          entityId: newDraft.id,
          sceneId: selectedScene.id,
          sceneName: selectedScene.name,
          projectId: selectedProject?.id ?? null,
          projectName: selectedProject?.name ?? null,
          roundId: newDraft.id,
          roundNumber: newDraft.round_number,
        });
        toast.success("Draft saved");
      }
      setIsNewRoundModalOpen(false);
      setEditingDraft(null);
    } catch (err: any) {
      console.error("Save draft failed:", err);
      toast.error(err?.message || "Could not save draft");
    }
  };

  // Discard a draft — remove the scene_rounds row. Files attached to the
  // scene (round_uploads) are left alone, since they live at the scene
  // level, not the round level. The client can remove individual files
  // from the modal's upload widgets before discarding if they want them
  // gone too.
  const handleDiscardDraft = async (draftId: string) => {
    if (!selectedScene) return;
    try {
      const { error } = await supabase
        .from("scene_rounds")
        .delete()
        .eq("id", draftId)
        .eq("status", "draft");
      if (error) throw error;
      setSceneRounds((prev) => {
        const next = new Map(prev);
        const list = next.get(selectedScene.id) || [];
        next.set(selectedScene.id, list.filter((r) => r.id !== draftId));
        return next;
      });
      setIsNewRoundModalOpen(false);
      setEditingDraft(null);
      toast.success("Draft discarded");
    } catch (err: any) {
      console.error("Discard draft failed:", err);
      toast.error(err?.message || "Could not discard draft");
    }
  };

  // Push a round's delivery (end_date) to a later Monday. start_date is
  // shifted to the prior Monday (end_date - 7d). No edge-function side
  // effects — the activity_log entry is the visible signal for admins.
  const handleRescheduleRound = async (round: SceneRound, newEndDate: Date) => {
    if (!selectedScene || !selectedProject) return;
    const newEnd = new Date(newEndDate);
    newEnd.setHours(11, 0, 0, 0);
    const newStart = new Date(newEnd);
    newStart.setDate(newEnd.getDate() - 7);
    try {
      const { data, error } = await supabase
        .from("scene_rounds")
        .update({
          start_date: newStart.toISOString(),
          end_date: newEnd.toISOString(),
        })
        .eq("id", round.id)
        .select("id, round_number, status, delivered_at, image_url, start_date, end_date, instructions, buffer_weeks")
        .single();
      if (error) throw error;
      setSceneRounds((prev) => {
        const next = new Map(prev);
        const list = next.get(selectedScene.id) || [];
        next.set(selectedScene.id, list.map((r) => (r.id === data.id ? { ...r, ...data } : r)));
        return next;
      });
      if (selectedRound?.id === data.id) {
        setSelectedRound((prev) => (prev ? { ...prev, ...data } : prev));
      }
      const dateStr = newEnd.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      await logActivity({
        action: "round_rescheduled",
        description: `Round ${round.round_number.toString().padStart(2, "0")} rescheduled to ${dateStr}`,
        actorRole: "client",
        entityType: "scene_round",
        entityId: round.id,
        projectId: selectedProject.id,
        projectName: selectedProject.name,
        sceneId: selectedScene.id,
        sceneName: selectedScene.name,
        roundId: round.id,
        roundNumber: round.round_number,
        metadata: {
          new_end_date: newEnd.toISOString(),
          new_start_date: newStart.toISOString(),
        },
      });
      setRescheduleTarget(null);
      toast.success(`Rescheduled to ${dateStr}`);
    } catch (err: any) {
      console.error("Reschedule failed:", err);
      toast.error(err?.message || "Could not reschedule");
    }
  };

  const handleCreateRound = async (
    instructions: string,
    deliveryDate?: Date,
    startDate?: Date,
    bufferWeeks?: number,
  ) => {
    if (!selectedProject || !selectedScene) return;

    try {
      const startIso = (startDate ?? new Date()).toISOString();
      const buffer = bufferWeeks ?? 1;
      // A future-dated start (> 1 week out) means this is a booked slot
      // (Isabelle button) rather than an immediate "next available" request.
      const effectiveStart = startDate ?? new Date();
      const isBooked = effectiveStart.getTime() > Date.now() + 7 * 24 * 60 * 60 * 1000;
      const bookedDescription = (roundNumber: number) =>
        `Round ${String(roundNumber).padStart(2, "0")} booked — production starts ${effectiveStart.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;

      // Submit-from-draft path: a draft row already exists for this scene.
      // Transition it from 'draft' → 'pending' and fill in the schedule.
      // The status_changed trigger on scene_rounds fires airtable-auto-sync
      // which routes draft→non-draft as the "Submit moment" — Airtable +
      // notification email kick off there.
      if (editingDraft) {
        const { data, error } = await supabase
          .from("scene_rounds")
          .update({
            status: "pending",
            start_date: startIso,
            instructions,
            buffer_weeks: buffer,
            ...(deliveryDate ? { end_date: deliveryDate.toISOString() } : {}),
          } as Record<string, unknown>)
          .eq("id", editingDraft.id)
          .select("id, round_number, status, delivered_at, image_url, start_date, end_date, instructions, buffer_weeks")
          .single();
        if (error) throw error;
        const updatedRound: SceneRound = data;
        setSceneRounds((prev) => {
          const updated = new Map(prev);
          const current = updated.get(selectedScene.id) || [];
          updated.set(
            selectedScene.id,
            current.map((r) => (r.id === updatedRound.id ? updatedRound : r)),
          );
          return updated;
        });
        // Dropbox folder + file upload is gated to skip drafts. Fire it
        // explicitly here at submit time so the production pipeline sees
        // the round's files.
        supabase.functions.invoke("dropbox-save-round-files", {
          body: { record: { ...data, scene_id: selectedScene.id } },
        }).catch((e: unknown) => console.warn("[Portfolio] dropbox submit-from-draft failed:", e));
        // Round 01: return to the scenes view rather than drilling down
        // into the round detail — there's nothing to look at yet, and the
        // scenes overview is the more useful place to land after the
        // brief has been submitted.
        if (isBooked) {
          await logActivity({
            action: "round_booked",
            actorRole: "client",
            description: bookedDescription(updatedRound.round_number),
            entityType: "scene_round",
            entityId: updatedRound.id,
            sceneId: selectedScene.id,
            sceneName: selectedScene.name,
            projectId: selectedProject.id,
            projectName: selectedProject.name,
            roundId: updatedRound.id,
            roundNumber: updatedRound.round_number,
            metadata: {
              start_date: effectiveStart.toISOString(),
              delivery_date: deliveryDate?.toISOString() ?? null,
            },
          });
        }
        if (updatedRound.round_number === 1) {
          setSelectedRound(null);
          setSelectedScene(null);
        } else {
          setSelectedRound(updatedRound);
        }
        setIsNewRoundModalOpen(false);
        setEditingDraft(null);
        toast.success(isBooked ? "Production slot booked" : "Round submitted — production will begin shortly");
        return;
      }

      const existingRounds = sceneRounds.get(selectedScene.id) || [];
      const nextRoundNumber = existingRounds.length + 1;

      const { data, error } = await supabase
        .from("scene_rounds")
        .insert({
          scene_id: selectedScene.id,
          round_number: nextRoundNumber,
          status: "pending",
          start_date: startIso,
          instructions: instructions,
          buffer_weeks: buffer,
          ...(deliveryDate ? { end_date: deliveryDate.toISOString() } : {}),
        } as Record<string, unknown>)
        .select("id, round_number, status, delivered_at, image_url, start_date, end_date, instructions, buffer_weeks")
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

      if (isBooked) {
        await logActivity({
          action: "round_booked",
          actorRole: "client",
          description: bookedDescription(newRound.round_number),
          entityType: "scene_round",
          entityId: newRound.id,
          sceneId: selectedScene.id,
          sceneName: selectedScene.name,
          projectId: selectedProject.id,
          projectName: selectedProject.name,
          roundId: newRound.id,
          roundNumber: newRound.round_number,
          metadata: {
            start_date: effectiveStart.toISOString(),
            delivery_date: deliveryDate?.toISOString() ?? null,
          },
        });
      }

      // Round 01: return to the scenes view rather than drilling down
      // into the round detail — there's nothing to look at yet. For
      // subsequent rounds we keep the existing auto-drilldown behaviour.
      if (newRound.round_number === 1) {
        setSelectedRound(null);
        setSelectedScene(null);
      } else {
        setSelectedRound(newRound);
      }

      // Close modal
      setIsNewRoundModalOpen(false);

      toast.success(isBooked ? "Production slot booked" : "Round created — production will begin shortly");
    } catch (error: any) {
      console.error("Error creating round:", error);
      toast.error(error.message || "Failed to create round");
    }
  };

  // Direct path for Round 2+: skip the brief modal entirely. The previous
  // round's sketches (asset_drawings) and pin annotations (asset_pins) are
  // the brief — production reads them in place.
  const handleRequestNextRoundDirect = async () => {
    if (!selectedProject || !selectedScene || !selectedRound) return;
    try {
      const existingRounds = sceneRounds.get(selectedScene.id) || [];
      const nextRoundNumber = existingRounds.length + 1;
      const previousLabel = String(selectedRound.round_number).padStart(2, "0");
      const nextLabel = String(nextRoundNumber).padStart(2, "0");
      // Anchor the next round's start to the previous round's delivery
      // plus its chosen buffer; clamped against the default "next slot
      // from now" so a delayed request never lands in the past. The new
      // round inherits the same buffer until the client overrides it on
      // a future round modal.
      const buffer = selectedRound.buffer_weeks ?? 1;
      const previousEnd = selectedRound.end_date ? new Date(selectedRound.end_date) : null;
      const schedule = computeRoundSchedule(new Date(), {
        previousRoundEnd: previousEnd,
        bufferWeeks: buffer,
      });

      const { data, error } = await supabase
        .from("scene_rounds")
        .insert({
          scene_id: selectedScene.id,
          round_number: nextRoundNumber,
          status: "pending",
          start_date: schedule.start.toISOString(),
          end_date: schedule.delivery.toISOString(),
          instructions: `See annotations on Round ${previousLabel}`,
          buffer_weeks: buffer,
        } as Record<string, unknown>)
        .select("id, round_number, status, delivered_at, image_url, start_date, end_date, instructions, buffer_weeks")
        .single();
      if (error) throw error;

      const newRound: SceneRound = data;
      setSceneRounds((prev) => {
        const updated = new Map(prev);
        const current = updated.get(selectedScene.id) || [];
        updated.set(selectedScene.id, [...current, newRound]);
        return updated;
      });
      setSelectedRound(newRound);

      await logActivity({
        action: "round_created",
        actorRole: "client",
        description: `Round ${nextLabel} requested via annotations`,
        entityType: "scene_round",
        entityId: newRound.id,
        sceneId: selectedScene.id,
        sceneName: selectedScene.name,
        projectId: selectedProject.id,
        projectName: selectedProject.name,
        roundNumber: nextRoundNumber,
      });

      toast.success(`Round ${nextLabel} requested. Your sketches and annotations are the brief.`);
    } catch (error: any) {
      console.error("Error requesting next round:", error);
      toast.error(error.message || "Failed to request round");
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
          <BrandLoader size="lg" />
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
      // Reschedule eligibility: the viewed round is still upcoming
      // (pending / in_production / in_progress) AND its production start is
      // still more than 7 days away. Once within the 7-day cutoff the link
      // is hidden entirely — admins handle exceptions out-of-band.
      const reschedulableStatuses = ["pending", "in_production", "in_progress"];
      const daysUntilStart = selectedRound.start_date
        ? (new Date(selectedRound.start_date).getTime() - Date.now()) / 86400000
        : null;
      const canReschedule =
        reschedulableStatuses.includes(selectedRound.status) &&
        daysUntilStart !== null &&
        daysUntilStart > 7;
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
          onReschedule={
            canReschedule ? () => setRescheduleTarget(selectedRound) : undefined
          }
          onRequestNextRound={
            // British Airways-mode: the round-request affordance now opens the
            // BookingModal (reserve slots). The old NewRoundModal brief flow +
            // handleRequestNextRoundDirect are kept for now (Commit 1, Option b).
            canRequestNext ? () => setIsBookingOpen(true) : undefined
          }
          nextRoundNumber={canRequestNext ? nextRoundNumber : undefined}
          isLocked={!isLatestRound}
          successorRoundNumber={successorRoundNumber}
          isLegacy={selectedRound.is_legacy ?? false}
          siblingRounds={sceneRoundsList.map((r) => ({
            id: r.id,
            round_number: r.round_number,
            status: r.status,
            is_legacy: r.is_legacy ?? false,
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
          <div className="flex flex-col items-center justify-center gap-6 min-h-[50vh] animate-fade-in">
            <p
              className="font-serif italic text-center text-foreground"
              style={{ fontSize: 15, opacity: 0.15 }}
            >
              No rounds yet.
            </p>
            <button
              type="button"
              onClick={() => setIsBookingOpen(true)}
              className="inline-flex items-center gap-2 border border-gold bg-transparent px-6 py-3 font-sans uppercase text-[10px] tracking-[0.24em] text-gold transition-colors hover:bg-gold/10"
              style={{ borderRadius: 2 }}
            >
              Book rounds
            </button>
          </div>
        </div>
      );
    }

    // Level 2: Project → show scenes as cards
    if (selectedProject) {
      return (
        <div>
          {selectedProject.scenes.length === 0 ? (
            <div className="flex items-center justify-center min-h-[50vh] animate-fade-in">
              <p
                className="font-serif italic text-center text-foreground"
                style={{ fontSize: 15, opacity: 0.15 }}
              >
                No scenes yet.
              </p>
            </div>
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
                brief: { key: "brief", label: "Awaiting Round 01 Brief", scenes: [] },
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
                // Latest round is a draft → the client started a brief but
                // hasn't submitted. Card flips into a "DRAFT" treatment and
                // a click reopens the modal rather than drilling down.
                const latestByNumber = [...rounds].sort((a, b) => b.round_number - a.round_number)[0];
                const hasDraft = !!latestByNumber && latestByNumber.status === "draft";
                // A future-booked round (pending, > 1 week out, before cutoff)
                // stays editable — clicking the card re-opens the modal, the
                // same affordance as a draft re-open.
                const hasEditableBooked = !!latestByNumber && isBookedEditableRound(latestByNumber);
                // If the ONLY rounds on this scene are drafts, render the
                // empty-state layout (no preview image) so the card doesn't
                // show a Clock icon for a not-yet-submitted brief.
                const isEmpty = rounds.length === 0 || rounds.every((r) => r.status === "draft");
                const borderClass = hasDraft
                  ? ""
                  : isAwaitingReview
                  ? "border-l-2 border-gold"
                  : isAwaitingBrief
                  ? "border-l-2 border-foreground/25"
                  : "";
                const draftBorderStyle = hasDraft
                  ? { borderLeft: "2px solid #8A8070" }
                  : {};
                return (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => {
                      if (hasDraft || hasEditableBooked) {
                        setSelectedScene(scene);
                        openRoundModalForScene(scene.id);
                        return;
                      }
                      if (rounds.length === 0) {
                        setSelectedScene(scene);
                        setIsBookingOpen(true);
                        return;
                      }
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
                      isEmpty && !hasDraft && "border border-foreground/[0.15]"
                    )}
                    style={{ aspectRatio: "4 / 3", ...draftBorderStyle }}
                  >
                    {isEmpty ? (
                      <div className="absolute inset-0 flex flex-col justify-end p-6">
                        <h3 className="font-serif text-xl text-foreground/80 leading-tight">
                          {scene.name}
                        </h3>
                        {hasDraft ? (
                          <p
                            className="mt-2 font-sans uppercase"
                            style={{ fontSize: 10, letterSpacing: "0.15em", color: "#8A8070" }}
                          >
                            Draft
                          </p>
                        ) : hasEditableBooked ? (
                          <p
                            className="mt-2 font-sans uppercase"
                            style={{ fontSize: 10, letterSpacing: "0.15em", color: "#8A8070" }}
                          >
                            Booked
                          </p>
                        ) : (
                          <p className="mt-2 text-[11px] uppercase tracking-[0.15em] text-muted-foreground/60 font-sans">
                            Awaiting Round 01 Brief
                          </p>
                        )}
                      </div>
                    ) : (
                      <>
                        <SmartImage
                          src={latestRound?.preview_url ?? null}
                          className="absolute inset-0 h-full w-full object-cover transition-transform duration-deliberate group-hover:scale-[1.02]"
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
                          {hasDraft ? (
                            <p
                              className="mt-2 font-sans uppercase"
                              style={{ fontSize: 10, letterSpacing: "0.15em", color: "#8A8070" }}
                            >
                              Draft
                            </p>
                          ) : hasEditableBooked ? (
                            <p
                              className="mt-2 font-sans uppercase"
                              style={{ fontSize: 10, letterSpacing: "0.15em", color: "#8A8070" }}
                            >
                              Booked
                            </p>
                          ) : (
                            <p className="mt-2 text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-sans">
                              {rounds.length} round{rounds.length !== 1 ? "s" : ""}
                            </p>
                          )}
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
          <div
            key="projects-empty"
            className="flex items-center justify-center min-h-[50vh] animate-fade-in"
          >
            <p
              className="font-serif italic text-center text-foreground"
              style={{ fontSize: 15, opacity: 0.15 }}
            >
              No active commissions.
            </p>
          </div>
        ) : projects.length === 1 ? (
          (() => {
            const project = projects[0];
            const rollup = projectRollup(project);
            const preview = getProjectPreview(project);
            return (
              <button
                key="projects-featured"
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
              </button>
            );
          })()
        ) : (
          <div
            key="projects-list"
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
          </div>
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

        {/* Title row — the contextual "Add a …" CTA sits top-right, baseline-
            aligned with the H1. Text-only gold-underlined treatment matches
            the ENTER CTA in the invitation email. */}
        <div className="flex items-baseline justify-between gap-6">
          <div>
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
          </div>
          {!selectedRound && !(selectedScene && hasRoundInProduction) && (
            <button
              onClick={() => {
                if (selectedScene) {
                  openRoundModalForScene(selectedScene.id);
                } else if (selectedProject) {
                  setIsNewSceneModalOpen(true);
                } else {
                  setIsNewTaskModalOpen(true);
                }
              }}
              className="shrink-0 font-sans uppercase hover:opacity-80 transition-opacity"
              style={{
                fontSize: 11,
                letterSpacing: "0.15em",
                color: "#B89A6A",
                borderBottom: "1px solid #B89A6A",
                paddingBottom: 6,
              }}
            >
              {selectedScene ? "Add a round" : selectedProject ? "Add a scene" : "Add a project"}
            </button>
          )}
        </div>

        <div className="mt-2">
          <ArborescenceTitle items={breadcrumbs} />
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ type: "tween", duration: DURATION.quick / 1000, ease: FM_EASE.default }}
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
      onClose={() => { setIsNewRoundModalOpen(false); setEditingDraft(null); }}
      onCreate={handleCreateRound}
      onCreateWithDate={handleCreateRound}
      onSaveDraft={handleSaveDraft}
      onDiscardDraft={handleDiscardDraft}
      sceneName={selectedScene?.name}
      sceneId={selectedScene?.id}
      roundNumber={selectedScene ? (sceneRounds.get(selectedScene.id)?.length || 0) + 1 : 1}
      existingDraft={editingDraft}
    />
    <RescheduleRoundModal
      isOpen={!!rescheduleTarget}
      onClose={() => setRescheduleTarget(null)}
      onConfirm={(d) => rescheduleTarget && handleRescheduleRound(rescheduleTarget, d)}
      sceneName={selectedScene?.name || ""}
      roundNumber={rescheduleTarget?.round_number || 1}
      currentEndDate={rescheduleTarget?.end_date || null}
    />
    {selectedScene && (
      <BookingModal
        isOpen={isBookingOpen}
        onClose={() => setIsBookingOpen(false)}
        sceneId={selectedScene.id}
        sceneName={selectedScene.name}
        projectName={selectedProject?.name}
        onBooked={fetchProjects}
        bookingMode={bookingMode}
      />
    )}
    </>
  );
}
