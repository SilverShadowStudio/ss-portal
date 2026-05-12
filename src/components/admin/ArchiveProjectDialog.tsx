import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ArchiveProjectDialogProps {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArchived?: () => void;
}

/**
 * Two-step typed confirmation:
 *   1. Type the exact project name
 *   2. Type the literal word "Delete"
 * Then invokes the `archive-project` edge function which:
 *   - removes every uploaded file from storage
 *   - stamps archived_at on the project (soft delete; restorable by admin)
 */
export function ArchiveProjectDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
  onArchived,
}: ArchiveProjectDialogProps) {
  const [typedName, setTypedName] = useState("");
  const [typedConfirm, setTypedConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset inputs every time the dialog re-opens.
  useEffect(() => {
    if (open) {
      setTypedName("");
      setTypedConfirm("");
      setSubmitting(false);
    }
  }, [open]);

  const nameMatches = typedName === projectName;
  const confirmMatches = typedConfirm === "Delete";
  const canSubmit = nameMatches && confirmMatches && !submitting;

  const handleArchive = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "archive-project",
        {
          body: {
            project_id: projectId,
            typed_name: typedName,
            typed_confirm: typedConfirm,
          },
        },
      );
      if (error) throw error;
      const filesDeleted = (data as { files_deleted?: number })?.files_deleted ?? 0;
      toast.success(
        `"${projectName}" archived${filesDeleted ? ` — ${filesDeleted} file${filesDeleted === 1 ? "" : "s"} removed` : ""}`,
      );
      const { logActivity } = await import("@/lib/activityLog");
      await logActivity({
        action: "project_archived",
        description: `Archived project "${projectName}"`,
        entityType: "project",
        projectId,
        projectName,
        metadata: { files_deleted: filesDeleted },
      });
      onOpenChange(false);
      onArchived?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to archive project";
      console.error("archive-project failed", err);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <AlertDialogTitle>Archive this project?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">
              This will hide{" "}
              <span className="font-semibold text-foreground">{projectName}</span>{" "}
              from the client and permanently remove every uploaded file
              (renders, source uploads, pin attachments) from storage.
            </span>
            <span className="block">
              The project record itself stays so an admin can restore it later
              from the archived view, but deleted files cannot be recovered.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Step 1 — Type the project name
            </label>
            <Input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={projectName}
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Step 2 — Type{" "}
              <span className="font-mono text-foreground">Delete</span> to
              confirm
            </label>
            <Input
              value={typedConfirm}
              onChange={(e) => setTypedConfirm(e.target.value)}
              placeholder="Delete"
              autoComplete="off"
              disabled={!nameMatches}
            />
          </div>
        </div>

        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleArchive}
            disabled={!canSubmit}
          >
            {submitting ? "Archiving…" : "Archive project"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}