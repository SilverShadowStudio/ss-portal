import { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud, Check, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { IncomeInvoiceReviewDialog, mapInvoiceToForm, type FormState } from "./IncomeInvoiceUpload";

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

interface Parsed { form: FormState; sourceFile: File }

/**
 * Bulk income-invoice drop zone for Revenue. Drop any number of invoices; each
 * is parsed by Claude, with a live progress bar + throughput ETA. When parsing
 * finishes, the pre-filled income-invoice review form opens for each in turn —
 * Fred validates/saves (or skips) each before it's recorded. Mirrors the Money
 * Out drop zone.
 */
export function BulkIncomeDropzone({ onSaved }: { onSaved: () => void }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [eta, setEta] = useState<{ seconds: number; at: number } | null>(null);
  const [, forceTick] = useState(0);

  // Review queue
  const [queue, setQueue] = useState<Parsed[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    if (!processing) return;
    const id = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [processing]);

  useEffect(() => {
    if (finishedAt == null) return;
    const id = setTimeout(() => setFinishedAt(null), 6000);
    return () => clearTimeout(id);
  }, [finishedAt]);

  async function processOne(file: File): Promise<Parsed> {
    const base64 = await fileToBase64(file);
    const { data, error } = await supabase.functions.invoke("parse-document", {
      body: { document_type: "invoice", file_data_base64: base64, file_mime_type: file.type },
    });
    if (error) throw error;
    if (!data?.success || !data?.data) throw new Error(data?.error || "Could not read the invoice");
    return { form: mapInvoiceToForm(data.data as Record<string, unknown>), sourceFile: file };
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
    const parsed: Parsed[] = [];
    const failedNames: string[] = [];
    let idx = 0, completed = 0, failures = 0;
    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= accepted.length) break;
        try { parsed.push(await processOne(accepted[i])); }
        catch { failures++; setFailed(failures); failedNames.push(accepted[i].name); }
        completed++;
        setDone(completed);
        const elapsed = (Date.now() - startTs) / 1000;
        const rate = completed / elapsed;
        setEta({ seconds: rate > 0 ? (accepted.length - completed) / rate : 0, at: Date.now() });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accepted.length) }, worker));

    setProcessing(false);
    setFinishedAt(Date.now());
    if (failures > 0) {
      const names = failedNames.join(", ");
      toast({ title: `${failures} invoice${failures === 1 ? "" : "s"} couldn't be read`, description: `${names} — parsed the rest; try ${failures === 1 ? "this one" : "these"} on its own via New income invoice.`, variant: "destructive" });
    }
    if (parsed.length > 0) { setQueue(parsed); setQIndex(0); setReviewOpen(true); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleReviewOpenChange(open: boolean) {
    if (open) { setReviewOpen(true); return; }
    // Advance to the next queued invoice (skip on cancel, next on save).
    if (qIndex + 1 < queue.length) {
      setQIndex(qIndex + 1); // dialog stays open, resets to next invoice
    } else {
      setReviewOpen(false);
      setQueue([]);
      setQIndex(0);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (processing) return;
    run(Array.from(e.dataTransfer.files));
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const liveEta = eta ? Math.max(0, eta.seconds - (Date.now() - eta.at) / 1000) : NaN;
  const current = queue[qIndex];

  return (
    <>
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
            {failed > 0 ? <AlertTriangle className="h-4 w-4 text-[#C9A96A]" strokeWidth={1.5} /> : <Check className="h-4 w-4 text-[#C9A96A]" strokeWidth={1.5} />}
            <span className="text-sm text-standard">{total - failed} parsed{failed > 0 ? ` · ${failed} failed` : ""}</span>
            <span className="text-[11px] text-white/35">— review each to save</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3 text-center">
            <UploadCloud className="h-5 w-5 text-white/35" strokeWidth={1.4} />
            <div className="flex flex-col items-start leading-tight">
              <span className="text-sm text-standard">Drop income invoices to parse<span className="text-white/35"> — or click to browse</span></span>
              <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">PDF, JPEG or PNG · as many as you like</span>
            </div>
          </div>
        )}
      </div>

      {current && (
        <IncomeInvoiceReviewDialog
          open={reviewOpen}
          onOpenChange={handleReviewOpenChange}
          initial={current.form}
          sourceFile={current.sourceFile}
          onSaved={onSaved}
          queueLabel={queue.length > 1 ? `${qIndex + 1} of ${queue.length}` : null}
        />
      )}
    </>
  );
}
