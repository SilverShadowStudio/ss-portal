import { useState, useRef } from "react";
import { Upload, X, Image as ImageIcon, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { deliverRoundAndStartReview } from "@/lib/reviewWindow";
import { logActivity } from "@/lib/activityLog";

interface AssetUploaderProps {
  sceneRoundId: string;
  onUploadComplete: () => void;
}

export function AssetUploader({ sceneRoundId, onUploadComplete }: AssetUploaderProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const allowedTypes = ["image/jpeg", "image/png", "image/tiff", "image/webp"];
  const maxFileSize = 50 * 1024 * 1024; // 50MB

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(e.target.files || []);
    
    const validFiles = selectedFiles.filter(file => {
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: "Invalid file type",
          description: `${file.name} is not a supported image format`,
          variant: "destructive",
        });
        return false;
      }
      if (file.size > maxFileSize) {
        toast({
          title: "File too large",
          description: `${file.name} exceeds 50MB limit`,
          variant: "destructive",
        });
        return false;
      }
      return true;
    });

    setFiles(prev => [...prev, ...validFiles]);
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function handleUpload() {
    if (files.length === 0) return;

    setUploading(true);
    setProgress(0);

    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) throw new Error("Not authenticated");

      const userId = session.session.user.id;
      let successCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${sceneRoundId}/${timestamp}_${safeName}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from("scene-assets")
          .upload(storagePath, file, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) {
          console.error("Upload error:", uploadError);
          toast({
            title: "Upload failed",
            description: `Failed to upload ${file.name}`,
            variant: "destructive",
          });
          continue;
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from("scene-assets")
          .getPublicUrl(storagePath);

        // Create asset record
        const { error: insertError } = await supabase
          .from("round_assets")
          .insert({
            scene_round_id: sceneRoundId,
            filename: file.name,
            file_size: file.size,
            source: "upload",
            storage_path: storagePath,
            version: 1,
            is_current: true,
          });

        if (insertError) {
          console.error("Insert error:", insertError);
          // Try to clean up the uploaded file
          await supabase.storage.from("scene-assets").remove([storagePath]);
          toast({
            title: "Error",
            description: `Failed to save ${file.name} metadata`,
            variant: "destructive",
          });
          continue;
        }

        successCount++;
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }

      if (successCount > 0) {
        // Mark the production round as delivered (capping its timeline bar
        // at "now") and spawn the sibling review round.
        await deliverRoundAndStartReview(sceneRoundId);

        // Activity log: bulk asset upload event.
        await logActivity({
          action: "asset_uploaded",
          description: `Uploaded ${successCount} ${successCount === 1 ? "asset" : "assets"}`,
          actorRole: "admin",
          entityType: "scene_round",
          entityId: sceneRoundId,
          roundId: sceneRoundId,
          metadata: { count: successCount },
        });

        toast({
          title: "Upload complete",
          description: `${successCount} ${successCount === 1 ? "asset" : "assets"} uploaded successfully`,
        });
        setFiles([]);
        onUploadComplete();
      }
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: "An error occurred during upload",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        className="relative rounded-lg border-2 border-dashed border-border bg-secondary/30 p-6 transition-colors hover:border-gold/50 hover:bg-secondary/50"
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={allowedTypes.join(",")}
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            Click to upload images
          </p>
          <p className="text-xs text-muted-foreground">
            JPG, PNG, TIFF, WebP up to 50MB each
          </p>
        </div>
      </div>

      {/* Selected files */}
      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-label text-muted-foreground">
            SELECTED FILES ({files.length})
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {files.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between rounded bg-secondary px-3 py-2"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm text-foreground">
                    {file.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(index);
                  }}
                  className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload button */}
      {files.length > 0 && (
        <Button
          className="w-full"
          onClick={handleUpload}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading... {progress}%
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Upload {files.length} {files.length === 1 ? "file" : "files"}
            </>
          )}
        </Button>
      )}
    </div>
  );
}
