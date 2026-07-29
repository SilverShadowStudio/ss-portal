import { useCallback, useEffect, useRef, useState } from "react";
import { UploadCloud, Check, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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
const norm = (s: string) => (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

interface Employee { id: string; name: string }

/**
 * Bulk payslip import for Salaries. Drop many payslip PDFs; each is parsed, the
 * employee is matched by the name on the payslip, and the month's real figures
 * are saved (dedupe by period). Payroll-summary PDFs and unmatched names are
 * skipped and reported. Progress bar + throughput ETA.
 */
export function BulkPayslipDropzone({ employees, onDone }: { employees: Employee[]; onDone: () => void }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(0);
  const [saved, setSaved] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [eta, setEta] = useState<{ seconds: number; at: number } | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!processing) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [processing]);
  useEffect(() => {
    if (finishedAt == null) return;
    const id = setTimeout(() => setFinishedAt(null), 8000);
    return () => clearTimeout(id);
  }, [finishedAt]);

  function matchEmployee(name: string | null | undefined): Employee | null {
    if (!name) return null;
    const n = norm(name);
    if (!n) return null;
    return employees.find((e) => norm(e.name) === n)
      ?? employees.find((e) => norm(e.name).includes(n) || n.includes(norm(e.name)))
      ?? null;
  }

  // Parse + save one payslip. Returns "saved" | "skipped".
  async function processOne(file: File, userId: string | null): Promise<"saved" | "skipped"> {
    const b64 = await fileToBase64(file);
    const { data, error } = await supabase.functions.invoke("parse-document", {
      body: { document_type: "payslip", file_data_base64: b64, file_mime_type: file.type },
    });
    if (error) throw error;
    if (!data?.success || !data?.data) return "skipped";
    const p = data.data as Record<string, any>;
    const emp = matchEmployee(p.employee_name);
    const net = Number(p.net);
    // No single employee, or no net → a payroll summary / unrecognised doc.
    if (!emp || !(net > 0)) return "skipped";

    const gross = Number(p.gross) || 0;
    const employerNi = Number(p.employer_ni) || 0;
    const periodLabel = (typeof p.period_label === "string" && p.period_label) ? p.period_label
      : (typeof p.period_end === "string" ? p.period_end : null);
    // Dedupe: replace the same person+month if re-imported.
    if (periodLabel) await supabase.from("payslips").delete().eq("account_id", emp.id).eq("period_label", periodLabel);

    const { data: inserted, error: insErr } = await supabase.from("payslips").insert({
      account_id: emp.id,
      period_label: periodLabel,
      period_end: typeof p.period_end === "string" ? p.period_end : null,
      gross,
      income_tax: p.income_tax != null ? Number(p.income_tax) : null,
      employee_ni: p.employee_ni != null ? Number(p.employee_ni) : null,
      student_loan: p.student_loan != null ? Number(p.student_loan) : null,
      net,
      employer_ni: employerNi,
      employer_pension: p.employer_pension != null ? Number(p.employer_pension) : 0,
      employer_cost: gross + employerNi,
      created_by: userId,
    }).select("id").single();
    if (insErr) throw insErr;
    // File the PDF to Dropbox (non-fatal — the data is already saved).
    await supabase.functions.invoke("dropbox-save-payslip", {
      body: { pdf_base64: b64, mime: file.type, employee_name: emp.name, period_end: typeof p.period_end === "string" ? p.period_end : "", payslip_id: inserted?.id },
    }).then(() => {}, () => {});
    return "saved";
  }

  const run = useCallback(async (files: File[]) => {
    if (employees.length === 0) { toast({ title: "Add a salaried person first", description: "Payslips match to an existing person by name.", variant: "destructive" }); return; }
    const accepted = files.filter((f) => ACCEPT.includes(f.type));
    if (accepted.length === 0) { toast({ title: "Only PDF, JPEG or PNG", variant: "destructive" }); return; }

    setProcessing(true); setFinishedAt(null);
    setTotal(accepted.length); setDone(0); setSaved(0); setSkipped(0); setEta(null);
    const startTs = Date.now();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    let idx = 0, completed = 0, ok = 0, skip = 0;
    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= accepted.length) break;
        try {
          const r = await processOne(accepted[i], userId);
          if (r === "saved") { ok++; setSaved(ok); } else { skip++; setSkipped(skip); }
        } catch { skip++; setSkipped(skip); }
        completed++; setDone(completed);
        const elapsed = (Date.now() - startTs) / 1000;
        const rate = completed / elapsed;
        setEta({ seconds: rate > 0 ? (accepted.length - completed) / rate : 0, at: Date.now() });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accepted.length) }, worker));

    setProcessing(false); setFinishedAt(Date.now());
    toast({ title: `${ok} payslip${ok === 1 ? "" : "s"} imported`, description: skip > 0 ? `${skip} skipped (summaries or unmatched names).` : "All matched and saved." });
    onDone();
  }, [employees]); // eslint-disable-line react-hooks/exhaustive-deps

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
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
        "relative w-full rounded-sm border border-dashed px-5 py-4 transition-colors",
        processing ? "cursor-default border-white/15 bg-white/[0.02]"
          : dragging ? "cursor-pointer border-[#C9A96A]/70 bg-[#C9A96A]/[0.06]"
          : "cursor-pointer border-white/15 bg-white/[0.02] hover:border-[#C9A96A]/40 hover:bg-white/[0.03]",
      ].join(" ")}
    >
      <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="hidden"
        onChange={(e) => { if (e.target.files?.length) run(Array.from(e.target.files)); e.target.value = ""; }} />

      {processing ? (
        <div className="animate-fade-in">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[11px] uppercase tracking-[0.22em] text-[#ecd39c]">Reading payslips</span>
            <span className="tabular-nums text-sm text-strong">{done} <span className="text-white/30">/</span> {total}</span>
          </div>
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-[#C9A96A] to-[#ecd39c] transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">{humanTime(liveEta)}</span>
            <span className="tabular-nums text-[10px] uppercase tracking-[0.18em] text-white/40">{saved} saved{skipped > 0 ? ` · ${skipped} skipped` : ""}</span>
          </div>
        </div>
      ) : finishedAt != null ? (
        <div className="flex items-center justify-center gap-2.5 animate-fade-in">
          {skipped > 0 ? <AlertTriangle className="h-4 w-4 text-[#C9A96A]" strokeWidth={1.5} /> : <Check className="h-4 w-4 text-[#C9A96A]" strokeWidth={1.5} />}
          <span className="text-sm text-standard">{saved} imported{skipped > 0 ? ` · ${skipped} skipped` : ""}</span>
          <span className="text-[11px] text-white/35">— drop more to continue</span>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-3 text-center">
          <UploadCloud className="h-5 w-5 text-white/35" strokeWidth={1.4} />
          <div className="flex flex-col items-start leading-tight">
            <span className="text-sm text-standard">Drop payslips to import<span className="text-white/35"> — or click to browse</span></span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-white/35">Matched to each person by name · summaries skipped</span>
          </div>
        </div>
      )}
    </div>
  );
}
