import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FolderMappingManager } from "@/components/admin/FolderMappingManager";
import { SceneCard } from "@/components/admin/SceneCard";

interface SceneRound {
  id: string;
  round_number: number;
  status: string;
}

interface Scene {
  id: string;
  name: string;
  status: string;
  current_round: number;
  paid_rounds: number;
  project_id: string;
  projectName: string;
  clientName: string;
  hasMapping: boolean;
  assetCount: number;
  currentRoundId: string | null;
  rounds: SceneRound[];
  reviewDeadline: string | null;
}

interface Project {
  id: string;
  name: string;
  user_id: string;
  clientName: string;
}

export default function AdminScenes() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [folderMappingScene, setFolderMappingScene] = useState<Scene | null>(null);
  const [newSceneName, setNewSceneName] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [paidRounds, setPaidRounds] = useState("2");
  const [reviewDeadline, setReviewDeadline] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      // Fetch profiles for client mapping
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, company");

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      // Fetch projects
      const { data: projectsData } = await supabase
        .from("projects")
        .select("id, name, user_id");

      const projectList: Project[] = (projectsData || []).map(project => ({
        ...project,
        clientName: profileMap.get(project.user_id)?.full_name || 
                   profileMap.get(project.user_id)?.company || 
                   "Unknown Client",
      }));
      setProjects(projectList);

      const projectMap = new Map(projectList.map(p => [p.id, p]));

      // Fetch folder mappings
      const { data: mappings } = await supabase
        .from("folder_mappings")
        .select("scene_id");

      const mappedSceneIds = new Set(mappings?.map(m => m.scene_id) || []);

      // Fetch scenes with their rounds
      const { data: scenesData, error } = await supabase
        .from("scenes")
        .select(`
          id,
          name,
          status,
          current_round,
          paid_rounds,
          project_id,
          review_deadline,
          scene_rounds (
            id,
            round_number,
            status
          )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get asset counts for each scene's current round
      const sceneList: Scene[] = [];
      for (const scene of scenesData || []) {
        const project = projectMap.get(scene.project_id);
        const sceneRounds = (scene.scene_rounds as any[]) || [];
        const currentRound = sceneRounds.find(
          r => r.round_number === scene.current_round
        );
        
        let assetCount = 0;
        if (currentRound) {
          const { count } = await supabase
            .from("round_assets")
            .select("*", { count: "exact", head: true })
            .eq("scene_round_id", currentRound.id)
            .eq("is_current", true);
          assetCount = count || 0;
        }

        sceneList.push({
          id: scene.id,
          name: scene.name,
          status: scene.status,
          current_round: scene.current_round,
          paid_rounds: scene.paid_rounds,
          project_id: scene.project_id,
          projectName: project?.name || "Unknown Project",
          clientName: project?.clientName || "Unknown Client",
          hasMapping: mappedSceneIds.has(scene.id),
          assetCount,
          currentRoundId: currentRound?.id || null,
          rounds: sceneRounds.map(r => ({
            id: r.id,
            round_number: r.round_number,
            status: r.status,
          })),
          reviewDeadline: (scene as any).review_deadline || null,
        });
      }

      setScenes(sceneList);
    } catch (error) {
      console.error("Error fetching scenes:", error);
      toast({
        title: "Error",
        description: "Failed to load scenes",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const filteredScenes = scenes.filter(scene => {
    const searchLower = searchQuery.toLowerCase();
    return (
      scene.name.toLowerCase().includes(searchLower) ||
      scene.projectName.toLowerCase().includes(searchLower) ||
      scene.clientName.toLowerCase().includes(searchLower)
    );
  });

  const handleCreateScene = async () => {
    if (!newSceneName || !selectedProjectId) {
      toast({
        title: "Missing Information",
        description: "Please provide scene name and select a project.",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    try {
      // Create scene
      const { data: newScene, error: sceneError } = await supabase
        .from("scenes")
        .insert({
          name: newSceneName,
          project_id: selectedProjectId,
          status: "pending_instruction",
          current_round: 1,
          paid_rounds: parseInt(paidRounds) || 2,
          review_deadline: reviewDeadline || null,
        })
        .select()
        .single();

      if (sceneError) throw sceneError;

      // Create first round
      const { error: roundError } = await supabase
        .from("scene_rounds")
        .insert({
          scene_id: newScene.id,
          round_number: 1,
          status: "pending",
        });

      if (roundError) throw roundError;

      toast({
        title: "Scene Created",
        description: `${newSceneName} has been created. Now link a Dropbox folder to start syncing assets.`,
      });
      const { logActivity } = await import("@/lib/activityLog");
      await Promise.all([
        logActivity({
          action: "scene_created",
          description: `Created scene "${newSceneName}"`,
          actorRole: "admin",
          entityType: "scene",
          entityId: newScene.id,
          sceneId: newScene.id,
          sceneName: newSceneName,
          projectId: selectedProjectId,
        }),
        logActivity({
          action: "round_created",
          description: `Created Round 01 for "${newSceneName}"`,
          actorRole: "admin",
          entityType: "scene_round",
          sceneId: newScene.id,
          sceneName: newSceneName,
          projectId: selectedProjectId,
          roundNumber: 1,
        }),
      ]);
      
      setIsAddDialogOpen(false);
      setNewSceneName("");
      setSelectedProjectId("");
      setPaidRounds("2");
      setReviewDeadline("");
      fetchData();
    } catch (error) {
      console.error("Error creating scene:", error);
      toast({
        title: "Error",
        description: "Failed to create scene",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <AdminLayout>
      {/* Header */}
      <div className="mb-10 flex items-end justify-between animate-fade-in">
        <div>
          <div className="mb-4 flex items-center gap-3">
            <div className="h-px w-12 bg-gold-muted" />
            <span className="text-label-gold">Scene Management</span>
          </div>
          <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4">
            SCENES
          </h1>
          <p className="text-sm text-muted-foreground">All production scenes across all clients.</p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Scene
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Scene</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <label className="text-label text-muted-foreground">SCENE NAME</label>
                <Input
                  value={newSceneName}
                  onChange={(e) => setNewSceneName(e.target.value)}
                  placeholder="Master Bedroom"
                />
              </div>
              <div className="space-y-2">
                <label className="text-label text-muted-foreground">PROJECT</label>
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name} — {project.clientName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-label text-muted-foreground">NUMBER OF ROUNDS</label>
                <Input
                  type="number"
                  min="1"
                  max="99"
                  value={paidRounds}
                  onChange={(e) => setPaidRounds(e.target.value)}
                  placeholder="2"
                />
              </div>
              <div className="space-y-2">
                <label className="text-label text-muted-foreground">REVIEW DEADLINE</label>
                <Input
                  type="datetime-local"
                  value={reviewDeadline}
                  onChange={(e) => setReviewDeadline(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  When the client must complete their review
                </p>
              </div>
              <Button 
                className="w-full" 
                onClick={handleCreateScene}
                disabled={isCreating}
              >
                {isCreating ? "Creating..." : "Create Scene"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="mb-8 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search scenes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Scenes List */}
      <div className="space-y-6" style={{ animationDelay: "0.15s" }}>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
          </div>
        ) : filteredScenes.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-12 text-center animate-fade-in">
            <p className="text-muted-foreground">
              {searchQuery ? "No scenes match your search" : "No scenes yet"}
            </p>
          </div>
        ) : (
          filteredScenes.map((scene, index) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              index={index}
              onFolderMappingClick={() => setFolderMappingScene(scene)}
              onDeleted={() => fetchData()}
            />
          ))
        )}
      </div>

      {/* Folder Mapping Dialog */}
      <Dialog open={!!folderMappingScene} onOpenChange={(open) => !open && setFolderMappingScene(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Folder — {folderMappingScene?.name}</DialogTitle>
          </DialogHeader>
          {folderMappingScene && (
            <div className="pt-4">
              <FolderMappingManager
                sceneId={folderMappingScene.id}
                sceneName={folderMappingScene.name}
                onMappingChange={() => {
                  fetchData();
                  setFolderMappingScene(null);
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

    </AdminLayout>
  );
}
