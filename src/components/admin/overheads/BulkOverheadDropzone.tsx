import { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud, Check, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { normalizeSupplier } from "@/lib/supplierNormalize";
import { mapExtractedToOverhead } from "./OverheadUploadFlow";
import type { ExpenseCategory } from "@/lib/finance";

const STAGING_BUCKET = "overhead-invoices";
const ACCEPT = ["application/pdf", "image/jpeg", "image/png"];
const CONCURRENCY = 4;

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
  onComplete: () => void;
}

/**
 * Bulk invoice drop zone for Money Out. Drop any number of invoices; each is
 * parsed by Claude (parse-document) and inserted straight into overheads with
 * the smart paid/unpaid default — the row's staging_storage_path triggers
 * Dropbox filing automatically. Shows a live progress bar and a throughput-based
 * ETA while parsing. Fred reviews/edits the rows in the table afterwards.
 */
export function BulkOverheadDropzone({ categories, onComplete }: Props) {
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

  async function processOne(file: File, createdBy: string | null) {
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

    const defaults = mapExtractedToOverhead(data.data as Record<string, unknown>);

    // Category: drop hallucinated codes; prefer Fred's supplier→category memory.
    if (defaults.category_code && !activeCodes.has(defaults.category_code)) delete defaults.category_code;
    if (defaults.supplier_name) {
      const key = normalizeSupplier(defaults.supplier_name);
      if (key) {
        const { data: mapping } = await supabase.from("supplier_category_map" as any)
          .select("category_code").eq("supplier_normalized", key).maybeSingle();
        const cat = (mapping as { category_code?: string } | null)?.category_code;
        if (cat && activeCodes.has(cat)) defaults.category_code = cat;
      }
    }

    // Stage the original so the row can be filed to Dropbox by the DB trigger.
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const stagingPath = `staging/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(STAGING_BUCKET).upload(stagingPath, file, { contentType: file.type, upsert: false });
    if (upErr) throw upErr;

    const { error: insErr } = await supabase.from("overheads" as any).insert({
      supplier_name: defaults.supplier_name ?? file.name.replace(/\.[a-z0-9]+$/i, ""),
      category_code: defaults.category_code ?? null,
      description: defaults.description ?? null,
      currency: "GBP",
      net_amount: defaults.net_amount ?? 0,
      vat_amount: defaults.vat_amount ?? 0,
      gross_amount: defaults.gross_amount ?? 0,
      vat_treatment: defaults.vat_treatment ?? "standard",
      invoice_number: defaults.invoice_number ?? null,
      invoice_date: defaults.invoice_date ?? null,
      due_date: defaults.due_date ?? null,
      payment_date: defaults.payment_date ?? null,
      payment_status: defaults.payment_date ? "paid" : "unpaid",
      source: "dropzone",
      staging_storage_path: stagingPath,
      created_by: createdBy,
    });
    if (upErr) throw upErr;
    if (insErr) throw insErr;
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
    const { data: userData } = await supabase.auth.getUser();
    const createdBy = userData.user?.id ?? null;

    let idx = 0, completed = 0, failures = 0;
    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= accepted.length) break;
        try { await processOne(accepted[i], createdBy); }
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
    const ok = accepted.length - failures;
    toast({
      title: `${ok} invoice${ok === 1 ? "" : "s"} added`,
      description: failures > 0 ? `${failures} couldn't be read — try those individually.` : "Review them in the table below.",
      variant: failures > 0 ? "destructive" : undefined,
    });
    onComplete();
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
          <span className="text-sm text-standard">{total - failed} added{failed > 0 ? ` · ${failed} to retry` : ""}</span>
          <span className="text-[11px] text-white/35">— drop more to continue</span>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-3 text-center">
          <UploadCloud className="h-5 w-5 text-white/35" strokeWidth={1.4} />
          <div className="flex flex-col items-start leading-tight">
            <span className="text-sm text-standard">Drop invoices to parse<span className="text-white/35"> — or click to browse</span></span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">PDF, JPEG or PNG · as many as you like</span>
          </div>
        </div>
      )}
    </div>
  );
}
