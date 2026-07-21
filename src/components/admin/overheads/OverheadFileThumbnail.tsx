import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Overhead } from "@/lib/finance";

interface PreviewData {
  source: "dropbox" | "staging";
  mime_type: string;
  thumbnail_data_uri: string | null;
  full_url: string | null;
}

type State = "idle" | "loading" | "ready" | "error" | "no_file";

interface Props {
  overhead: Overhead;
}

/**
 * Clickable thumbnail of the invoice file attached to an overhead.
 * - Filed (dropbox_path): thumbnail rendered from Dropbox JPEG, click opens
 *   the temporary link in a new tab.
 * - Staged (staging_storage_path only): no thumbnail (Dropbox thumbnail API
 *   doesn't cover Storage files); click opens a Supabase signed URL.
 * - Neither: renders nothing.
 */
export function OverheadFileThumbnail({ overhead }: Props) {
  const [state, setState] = useState<State>("idle");
  const [preview, setPreview] = useState<PreviewData | null>(null);

  useEffect(() => {
    if (!overhead.dropbox_path && !overhead.staging_storage_path) {
      setState("no_file");
      return;
    }
    let cancelled = false;
    setState("loading");
    setPreview(null);

    (async () => {
      const { data, error } = await supabase.functions.invoke("overhead-file-preview", {
        body: { overhead_id: overhead.id },
      });
      if (cancelled) return;
      if (error || !data?.available) {
        setState("error");
        return;
      }
      setPreview({
        source:             data.source,
        mime_type:          data.mime_type,
        thumbnail_data_uri: data.thumbnail_data_uri,
        full_url:           data.full_url,
      });
      setState("ready");
    })();

    return () => { cancelled = true; };
  }, [overhead.id, overhead.dropbox_path, overhead.staging_storage_path]);

  if (state === "no_file") return null;

  return (
    <div className="border-t border-divider pt-4">
      <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40 mb-2">Invoice file</p>

      {state === "loading" && (
        <div className="w-40 h-52 border border-divider rounded-sm bg-muted/40 animate-pulse" />
      )}

      {state === "error" && (
        <p className="text-xs text-recessive">Preview unavailable.</p>
      )}

      {state === "ready" && preview && (
        <div className="flex items-start gap-5">
          <a
            href={preview.full_url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="block group"
            aria-label="Open full-size invoice"
          >
            {preview.thumbnail_data_uri ? (
              <img
                src={preview.thumbnail_data_uri}
                alt="Invoice thumbnail"
                className="w-40 h-auto border border-divider rounded-sm bg-muted/40 transition-opacity group-hover:opacity-90"
              />
            ) : (
              <div className="w-40 h-52 border border-divider rounded-sm bg-muted/40 flex items-center justify-center transition-opacity group-hover:opacity-90">
                <span className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">
                  {(preview.mime_type.split("/")[1] ?? "file").toUpperCase()}
                </span>
              </div>
            )}
          </a>
          <div className="flex flex-col gap-2 text-xs text-recessive">
            <p>
              {preview.source === "dropbox"
                ? "Filed to Dropbox."
                : "Staged, awaiting Dropbox filing."}
            </p>
            <a
              href={preview.full_url ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold hover:underline underline-offset-4 self-start"
            >
              Open full-size
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
