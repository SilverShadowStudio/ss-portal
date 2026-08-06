import { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud, Check, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { normalizeSupplier } from "@/lib/supplierNormalize";
import { mapExtractedToOverhead } from "./OverheadUploadFlow";
import { assessOverhead, type ConfidenceVerdict } from "@/lib/overheadConfidence";
import type { ExpenseCategory, Overhead } from "@/lib/finance";

/** A parsed invoice plus the verdict on whether it can land unattended. */
export interface ParsedInvoice {
  defaults: Partial<Overhead>;
  verdict: ConfidenceVerdict;
}

const STAGING_BUCKET = "overhead-invoices";
const ACCEPT = ["application/pdf", "image/jpeg", "image/png"];
const CONCURRENCY = 2;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const r = reader.result as string; const c = r.indexOf(","); resolve(c >= 0 ? r.slice(c + 1) : r); };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function humanTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "finishing…";
  const s = Math.ceil(sec);
  if (s < 60) return `~${s}s remaining`;
  const m = Math.floor(s / 60), r = s % 60;
  return `~${m}m ${String(r).padStart(2, "0")}s remaining`;
}

interface Props {
  categories: ExpenseCategory[];
  /** Called once every dropped file has been parsed + staged. Each item carries
   *  a confidence verdict: the parent records the confident ones straight into
   *  the books and opens the review form only for the rest. */
  onParsed: (items: ParsedInvoice[]) => void;
}

/**
 * Bulk invoice drop zone for Money Out. Drop any number of invoices; each is
 * parsed by Claude (parse-document) and its original staged to storage. A live
 * progress bar + throughput-based ETA runs while parsing. When all are parsed,
 * the pre-filled defaults are handed to the parent, which walks Fred through the
 * usual review form for each one before saving — nothing is saved automatically.
 */
export function BulkOverheadDropzone({ categories, onParsed }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  // ETA anchor: seconds-remaining as of a timestamp; a ticker interpolates.
  const [eta, setEta] = useState<{ seconds: number; at: number } | null>(null);
  const [, forceTick] = useState(0);

  // Smooth live countdown while parsing.
  useEffect(() => {
    if (!processing) return;
    const id = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [processing]);

  const activeCats = categories.filter((c) => c.active);
  const activeCodes = new Set(activeCats.map((c) => c.code));

  // Parse one invoice and stage its original. Returns the pre-filled overhead
  // defaults (incl. staging path) for the review form — nothing is saved here.
  async function processOne(file: File): Promise<ParsedInvoice> {
    const base64 = await fileToBase64(file);
    const { data, error } = await supabase.functions.invoke("parse-document", {
      body: {
        document_type: "overhead",
        file_data_base64: base64,
        file_mime_type: file.type,
        categories: activeCats.map((c) => ({ code: c.code, name: c.name })),
      },
    });
    if (error) throw error;
    if (!data?.success || !data?.data) throw new Error(data?.error || "Could not read the invoice");

    const raw = data.data as Record<string, unknown>;
    const defaults = mapExtractedToOverhead(raw);

    // Category: drop hallucinated codes; prefer Fred's supplier→category memory.
    // Whether the memory hit is itself the confidence signal — a supplier we've
    // filed before is a supplier whose category Fred already chose by hand.
    if (defaults.category_code && !activeCodes.has(defaults.category_code)) delete defaults.category_code;
    let categoryFromMemory = false;
    if (defaults.supplier_name) {
      const key = normalizeSupplier(defaults.supplier_name);
      if (key) {
        const { data: mapping } = await supabase.from("supplier_category_map" as any)
          .select("category_code").eq("supplier_normalized", key).maybeSingle();
        const cat = (mapping as { category_code?: string } | null)?.category_code;
        if (cat && activeCodes.has(cat)) { defaults.category_code = cat; categoryFromMemory = true; }
      }
    }

    // Stage the original so the save (attended or not) can file it to Dropbox.
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const stagingPath = `staging/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(STAGING_BUCKET).upload(stagingPath, file, { contentType: file.type, upsert: false });
    if (upErr) throw upErr;
    defaults.staging_storage_path = stagingPath;

    return { defaults, verdict: assessOverhead(raw, defaults, { categoryFromMemory }) };
  }

  const run = useCallback(async (files: File[]) => {
    const accepted = files.filter((f) => ACCEPT.includes(f.type));
    if (accepted.length === 0) { toast({ title: "Only PDF, JPEG or PNG invoices", variant: "destructive" }); return; }

    setProcessing(true);
    setFinishedAt(null);
    setTotal(accepted.length);
    setDone(0);
    setFailed(0);
    setEta(null);

    const startTs = Date.now();
    const parsed: ParsedInvoice[] = [];

    let idx = 0, completed = 0, failures = 0;
    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= accepted.length) break;
        try { parsed.push(await processOne(accepted[i])); }
        catch { failures++; setFailed(failures); }
        completed++;
        setDone(completed);
        const elapsed = (Date.now() - startTs) / 1000;
        const rate = completed / elapsed; // files per second
        const remaining = rate > 0 ? (accepted.length - completed) / rate : 0;
        setEta({ seconds: remaining, at: Date.now() });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accepted.length) }, worker));

    setProcessing(false);
    setFinishedAt(Date.now());
    if (failures > 0) {
      toast({
        title: `${failures} invoice${failures === 1 ? "" : "s"} couldn't be read`,
        description: "Parsed the rest — try the failed ones individually.",
        variant: "destructive",
      });
    }
    if (parsed.length > 0) onParsed(parsed);
  }, [categories]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-clear the "done" summary after a few seconds.
  useEffect(() => {
    if (finishedAt == null) return;
    const id = setTimeout(() => setFinishedAt(null), 6000);
    return () => clearTimeout(id);
  }, [finishedAt]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (processing) return;
    run(Array.from(e.dataTransfer.files));
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const liveEta = eta ? Math.max(0, eta.seconds - (Date.now() - eta.at) / 1000) : NaN;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!processing) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !processing && inputRef.current?.click()}
      className={[
        "relative w-full rounded-sm border border-dashed px-6 py-5 transition-colors",
        processing ? "cursor-default border-white/15 bg-white/[0.02]"
          : dragging ? "cursor-pointer border-[#C9A96A]/70 bg-[#C9A96A]/[0.06]"
          : "cursor-pointer border-white/15 bg-white/[0.02] hover:border-[#C9A96A]/40 hover:bg-white/[0.03]",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(e) => { if (e.target.files?.length) run(Array.from(e.target.files)); e.target.value = ""; }}
      />

      {processing ? (
        <div className="animate-fade-in">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[11px] uppercase tracking-[0.22em] text-[#ecd39c]">Parsing invoices</span>
            <span className="tabular-nums text-sm text-strong">{done} <span className="text-white/30">/</span> {total}</span>
          </div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-[#C9A96A] to-[#ecd39c] transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">{humanTime(liveEta)}</span>
            <span className="tabular-nums text-[10px] uppercase tracking-[0.18em] text-white/40">{pct}%{failed > 0 ? ` · ${failed} failed` : ""}</span>
          </div>
        </div>
      ) : finishedAt != null ? (
        <div className="flex items-center justify-center gap-2.5 animate-fade-in">
          {failed > 0
            ? <AlertTriangle className="h-4 w-4 text-[#C9A96A]" strokeWidth={1.5} />
            : <Check className="h-4 w-4 text-[#C9A96A]" strokeWidth={1.5} />}
          <span className="text-sm text-standard">{total - failed} parsed{failed > 0 ? ` · ${failed} failed` : ""}</span>
          <span className="text-[11px] text-white/35">— filing</span>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-3 text-center">
          <UploadCloud className="h-5 w-5 text-white/35" strokeWidth={1.4} />
          <div className="flex flex-col items-start leading-tight">
            <span className="text-sm text-standard">Drop invoices to file<span className="text-white/35"> — or click to browse</span></span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">Renamed, filed to Dropbox and recorded · we only stop if something looks off</span>
          </div>
        </div>
      )}
    </div>
  );
}
