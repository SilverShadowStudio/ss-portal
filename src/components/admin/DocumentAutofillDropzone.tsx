import { useRef, useState, useCallback } from "react";
import { FileUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { BrandLoader } from "@/components/ui/BrandLoader";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ACCEPT = ".pdf,.jpg,.jpeg,.png";
const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"];

interface Props {
  documentType: "invoice" | "quotation" | "overhead";
  /** Called with the extracted JSON on success. Manual entry stays available. */
  onExtracted: (data: Record<string, unknown>) => void;
  /** Lets the parent disable submit while a document is being read. */
  onLoadingChange?: (loading: boolean) => void;
  disabled?: boolean;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(","); // strip the data:...;base64, prefix
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function DocumentAutofillDropzone({ documentType, onExtracted, onLoadingChange, disabled }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);

  const setBusy = useCallback((b: boolean) => { setLoading(b); onLoadingChange?.(b); }, [onLoadingChange]);

  const handleFile = useCallback(async (file: File) => {
    if (!ALLOWED_MIME.includes(file.type)) {
      toast({ title: "Unsupported file", description: "Upload a PDF, JPEG, or PNG.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "File too large", description: "Maximum size is 10MB.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const file_data_base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("parse-document", {
        body: { document_type: documentType, file_data_base64, file_mime_type: file.type },
      });
      if (error) throw error;
      if (!data?.success || !data?.data) throw new Error(data?.error || "Extraction failed");
      onExtracted(data.data as Record<string, unknown>);
      toast({ title: "Document read", description: "Review the pre-filled fields before saving." });
    } catch (err) {
      console.warn("[DocumentAutofillDropzone] extraction failed:", err);
      toast({ title: "Couldn't read the document — please fill manually", variant: "destructive" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [documentType, onExtracted, setBusy, toast]);

  return (
    <div className="space-y-2">
      <p className="font-sans text-[9px] uppercase tracking-[0.28em] text-foreground/40">Auto-fill from document</p>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!loading) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (loading) return;
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed bg-muted/40 px-4 py-6 text-center transition-colors disabled:opacity-60",
          dragOver ? "border-solid border-gold bg-gold/5" : "border-gold/40 hover:border-gold/70",
        )}
      >
        {loading ? (
          <>
            <BrandLoader size="md" />
            <span className="font-sans text-[12px] text-foreground/70 animate-pulse">Reading your document…</span>
          </>
        ) : (
          <>
            <FileUp className="h-5 w-5 text-gold" strokeWidth={1.5} />
            <span className="font-sans text-[12px] text-foreground/75">
              Drag a PDF or image here, or click to browse.
            </span>
            <span className="font-sans text-[11px] text-foreground/40">
              Claude will extract the details and pre-fill the form below.
            </span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
    </div>
  );
}

// ── Shared helpers reused by both invoice + quotation forms ─────────────────

const COMPANY_SUFFIX_RE = /\b(limited|ltd|inc|llc|studios?)\b/gi;
function normaliseCompany(s: string): string {
  return s.toLowerCase().replace(COMPANY_SUFFIX_RE, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Suffix-stripping bidirectional fuzzy match (mirrors airtable-find-matching-clients).
 * Returns the account only on a SINGLE unambiguous match; null for none or multiple.
 */
export function matchAccountByName<T extends { company_name: string }>(
  name: string | null | undefined,
  accounts: T[],
): T | null {
  if (!name) return null;
  const q = normaliseCompany(name);
  if (!q) return null;
  const matches = accounts.filter((a) => {
    const c = normaliseCompany(a.company_name);
    return !!c && (c === q || c.includes(q) || q.includes(c));
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Small gold "AUTO" pill shown beside a label after extraction pre-filled the field. */
export function AutoPill() {
  return (
    <span
      className="ml-1.5 inline-flex items-center rounded-sm bg-gold/15 px-1 py-px font-sans align-middle text-gold"
      style={{ fontSize: 8, letterSpacing: "0.1em" }}
    >
      AUTO
    </span>
  );
}
