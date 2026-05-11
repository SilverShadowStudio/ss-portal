import { useRef, useState } from "react";
import { Upload, X, CheckCircle2, AlertCircle, Loader2, FileIcon } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Status = "pending" | "uploading" | "success" | "error";

interface FileItem {
  file: File;
  status: Status;
  error?: string;
}

export default function AdminBatchUpload() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).map((file) => ({ file, status: "pending" as Status }));
    setItems((prev) => [...prev, ...arr]);
  }

  function removeAt(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function clearAll() {
    setItems([]);
    setOverallProgress(0);
  }

  async function handleUpload() {
    if (items.length === 0 || uploading) return;
    setUploading(true);
    setOverallProgress(0);

    let done = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].status === "success") {
        done++;
        setOverallProgress(Math.round((done / items.length) * 100));
        continue;
      }
      setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: "uploading", error: undefined } : it)));
      const file = items[i].file;
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("filename", file.name);
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Not authenticated");

        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "oodhsoiwnqxcimzmzick";
        const url = `https://${projectId}.supabase.co/functions/v1/admin-batch-upload`;
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || `Upload failed (${res.status})`);
        }
        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: "success" } : it)));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: "error", error: msg } : it)));
      }
      done++;
      setOverallProgress(Math.round((done / items.length) * 100));
    }

    setUploading(false);
  }

  const successCount = items.filter((i) => i.status === "success").length;
  const errorCount = items.filter((i) => i.status === "error").length;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Batch Upload</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload multiple files at once to the round-uploads bucket. Files are stored flat under their original filenames.
          </p>
        </div>

        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "relative cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors",
            dragOver ? "border-gold bg-secondary/60" : "border-border bg-secondary/30 hover:border-gold/50 hover:bg-secondary/50"
          )}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
          <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">Click or drop files here</p>
          <p className="text-xs text-muted-foreground">Any file type. Multiple files supported.</p>
        </div>

        {items.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-label text-muted-foreground">
                {items.length} {items.length === 1 ? "FILE" : "FILES"}
                {(successCount > 0 || errorCount > 0) && (
                  <span className="ml-2 normal-case tracking-normal text-muted-foreground/80">
                    · {successCount} succeeded{errorCount > 0 ? `, ${errorCount} failed` : ""}
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={clearAll} disabled={uploading}>
                  Clear
                </Button>
                <Button size="sm" onClick={handleUpload} disabled={uploading}>
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading… {overallProgress}%
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload {items.length} {items.length === 1 ? "file" : "files"}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {uploading && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-gold transition-all"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
            )}

            <div className="max-h-[480px] space-y-1.5 overflow-y-auto rounded-lg border border-border bg-card p-2">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded px-3 py-2 hover:bg-muted/40"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm text-foreground">{item.file.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {(item.file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    {item.status === "success" && (
                      <span className="flex items-center gap-1 text-xs text-emerald-500">
                        <CheckCircle2 className="h-4 w-4" /> Uploaded
                      </span>
                    )}
                    {item.status === "error" && (
                      <span
                        className="flex items-center gap-1 text-xs text-destructive"
                        title={item.error}
                      >
                        <AlertCircle className="h-4 w-4" /> Failed
                      </span>
                    )}
                    {item.status === "pending" && (
                      <span className="text-xs text-muted-foreground">Pending</span>
                    )}
                    {!uploading && (
                      <button
                        onClick={() => removeAt(idx)}
                        className="p-1 text-muted-foreground hover:text-foreground"
                        title="Remove"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}