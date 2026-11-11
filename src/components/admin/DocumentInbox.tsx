import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UploadCloud, Loader2, FolderOpen } from "lucide-react";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FeedList, useFeedDismissals } from "@/components/ui/FeedList";
import { OverheadForm } from "@/components/admin/overheads/OverheadForm";
import { IncomeInvoiceReviewDialog, mapInvoiceToForm, type FormState } from "@/components/admin/finance/IncomeInvoiceUpload";
import { parseOverheadFile, fileToBase64, OVERHEAD_STAGING_BUCKET, type ParsedInvoice } from "@/lib/overheadIntake";
import { recordOverheadUnattended } from "@/lib/overheadRecord";
import { describeFlags } from "@/lib/overheadConfidence";
import type { ExpenseCategory } from "@/lib/finance";

// The Dropzone (called the Document Inbox until 11 Nov 2026) — drop any
// document; the portal reads it, works out what it is, renames it to the studio
// convention and files it in Dropbox. The filing strategy lives in
// supabase/functions/parse-document/inbox.ts. Its history is a standard feed
// (components/ui/FeedList): click a line to clear it, the title shows it all.

const sb = supabase as any;
const ENDPOINT = `${SUPABASE_URL}/functions/v1/parse-document?action=inbox`;
const ADMIN_ROOT = "/03_Portal_Admin_Docs";
const CONCURRENCY = 2;
// Enough to be "the whole history" for years at the studio's pace.
const HISTORY_LIMIT = 300;

type Status = "processing" | "filed" | "to_check" | "duplicate" | "failed";

interface InboxRow {
  id: string;
  created_at: string;
  original_filename: string;
  status: Status;
  doc_type: string | null;
  summary: string | null;
  reasoning: string | null;
  dropbox_path: string | null;
  error_text: string | null;
}

interface Pending { key: string; name: string; note?: string }

/** The function hands supplier and client invoices back for the P&L intake. */
type Handoff = "ap_invoice" | "ar_invoice";
type ReviewOutcome = "saved" | "cancelled";

const money = (n: number, ccy = "GBP") =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: ccy || "GBP", maximumFractionDigits: 2 }).format(n || 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STATUS_LABEL: Record<Status, string> = {
  processing: "Reading",
  filed: "Filed",
  to_check: "To check",
  duplicate: "Already filed",
  failed: "Failed",
};

const STATUS_CHIP: Record<Status, string> = {
  processing: "bg-white/10 text-white/60",
  filed: "bg-gold/20 text-[#ecd39c]",
  to_check: "bg-[#c98a4a]/20 text-[#e8b98a]",
  duplicate: "bg-white/10 text-white/60",
  failed: "bg-destructive/20 text-destructive",
};

const DOC_TYPE_LABEL: Record<string, string> = {
  ar_invoice: "Client invoice",
  ap_invoice: "Supplier invoice",
  freelancer_invoice: "Freelancer invoice",
  quotation: "Quotation",
  client_project_agreement: "Project agreement",
  client_partnership_agreement: "Partnership agreement",
  employee_document: "Employee document",
  payslip: "Payslip",
  freelancer_document: "Freelancer document",
  intern_document: "Intern document",
  supplier_agreement: "Supplier agreement",
  agency_agreement: "Agency agreement",
  contract_template: "Template",
  bank_document: "Banking",
  tax_document: "Tax",
  company_document: "Company record",
  correspondence: "Correspondence",
  project_material: "Project material",
  other: "Unclassified",
};

function splitPath(path: string | null): { folder: string; name: string } {
  if (!path) return { folder: "", name: "" };
  const i = path.lastIndexOf("/");
  return { folder: path.slice(0, i), name: path.slice(i + 1) };
}

const shortFolder = (folder: string) =>
  folder.toLowerCase().startsWith(ADMIN_ROOT.toLowerCase()) ? folder.slice(ADMIN_ROOT.length + 1) || "/" : folder;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token ?? ""}`, apikey: SUPABASE_PUBLISHABLE_KEY };
}

export function DocumentInbox() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [moveRow, setMoveRow] = useState<InboxRow | null>(null);
  const [history, setHistory] = useState(false);
  const { dismissed, dismiss } = useFeedDismissals("dropzone");

  // ── Invoices go to the books ────────────────────────────────────────────
  // The Dropzone is the only drop zone, so a supplier or client invoice has to
  // end up in the P&L, not just in Dropbox. The function hands those back and
  // they run through the P&L's own intake — the same confidence gate, the same
  // review forms, the same filing — one at a time, since a review is modal.
  const [categories, setCategories] = useState<ExpenseCategory[] | null>(null);
  const [expenseReview, setExpenseReview] = useState<{ item: ParsedInvoice; label: string | null } | null>(null);
  const [incomeReview, setIncomeReview] = useState<{ form: FormState; file: File } | null>(null);
  const reviewDone = useRef<((o: ReviewOutcome) => void) | null>(null);
  const reviewSaved = useRef(false);
  const intakeChain = useRef<Promise<void>>(Promise.resolve());

  const loadCategories = useCallback(async (): Promise<ExpenseCategory[]> => {
    if (categories) return categories;
    const { data } = await sb.from("expense_categories").select("*").order("code");
    const list = (data ?? []) as ExpenseCategory[];
    setCategories(list);
    return list;
  }, [categories]);

  const settle = useCallback(async (id: string, fields: Record<string, unknown>): Promise<InboxRow | null> => {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { ...(await authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify({ op: "settle", id, ...fields }),
    });
    const body = await res.json().catch(() => ({}));
    return (body.row as InboxRow) ?? null;
  }, []);

  /** Wait for whichever review form is open to be saved or closed. */
  const awaitReview = () => new Promise<ReviewOutcome>((resolve) => {
    reviewSaved.current = false;
    reviewDone.current = resolve;
  });
  const closeReview = () => {
    const done = reviewDone.current;
    reviewDone.current = null;
    setExpenseReview(null);
    setIncomeReview(null);
    done?.(reviewSaved.current ? "saved" : "cancelled");
  };

  /** Where Dropbox put an expense: the trigger files it moments after the row lands. */
  const filedPathFor = async (stagingPath: string): Promise<string | null> => {
    for (let i = 0; i < 15; i++) {
      const { data } = await sb.from("overheads").select("dropbox_path").eq("staging_storage_path", stagingPath).maybeSingle();
      if (data?.dropbox_path) return data.dropbox_path as string;
      await sleep(2000);
    }
    return null;
  };

  const intakeExpense = async (row: InboxRow, file: File) => {
    const cats = await loadCategories();
    const item = await parseOverheadFile(file, cats);
    const staged = item.defaults.staging_storage_path ?? null;
    const supplier = item.defaults.supplier_name ?? "Supplier";
    const gross = money(item.defaults.gross_amount ?? 0, item.defaults.currency ?? "GBP");

    if (item.verdict.auto) {
      const outcome = await recordOverheadUnattended(item.defaults);
      if (outcome.status !== "recorded" && staged) void supabase.storage.from(OVERHEAD_STAGING_BUCKET).remove([staged]);
      if (outcome.status === "duplicate") {
        return settle(row.id, { status: "duplicate", summary: `${supplier} — already in your books (same supplier and invoice number). Nothing was filed twice.` });
      }
      if (outcome.status === "failed") {
        return settle(row.id, { status: "to_check", reasoning: `Read as a supplier invoice but couldn't be recorded: ${outcome.error}` });
      }
      const path = staged ? await filedPathFor(staged) : null;
      return settle(row.id, { status: "filed", dropbox_path: path, summary: `${supplier} ${gross} — recorded in P&L, Money out, as unpaid. Pay it from its row.` });
    }

    // Not sure enough to land unattended: the P&L's own review form, right here.
    setExpenseReview({ item, label: describeFlags(item.verdict.flags) || null });
    const outcome = await awaitReview();
    if (outcome === "cancelled") {
      if (staged) void supabase.storage.from(OVERHEAD_STAGING_BUCKET).remove([staged]);
      return settle(row.id, { status: "to_check", reasoning: "Read as a supplier invoice, but the review was closed without saving, so it isn't in the books. Drop it again to record it." });
    }
    const path = staged ? await filedPathFor(staged) : null;
    return settle(row.id, { status: "filed", dropbox_path: path, summary: `${supplier} — reviewed and recorded in P&L, Money out, as unpaid.` });
  };

  const intakeIncome = async (row: InboxRow, file: File) => {
    const { data, error } = await supabase.functions.invoke("parse-document", {
      body: { document_type: "invoice", file_data_base64: await fileToBase64(file), file_mime_type: file.type },
    });
    if (error || !data?.success || !data?.data) {
      return settle(row.id, { status: "to_check", reasoning: `Read as a client invoice but its figures couldn't be extracted: ${(data as { error?: string } | null)?.error ?? error?.message ?? "unknown error"}` });
    }
    // Client invoices always get a look before they count as income, as in the P&L.
    setIncomeReview({ form: mapInvoiceToForm(data.data as Record<string, unknown>), file });
    const outcome = await awaitReview();
    return outcome === "saved"
      ? settle(row.id, { status: "filed", summary: "Recorded in P&L, Money in, and filed to Dropbox with the invoice." })
      : settle(row.id, { status: "to_check", reasoning: "Read as a client invoice, but the review was closed without saving, so it isn't in the books. Drop it again to record it." });
  };

  /** Queue an invoice for the books. Runs strictly one after another. */
  const intake = (row: InboxRow, file: File, kind: Handoff, key: string) => {
    intakeChain.current = intakeChain.current.then(async () => {
      setPending((p) => p.map((x) => (x.key === key ? { ...x, note: "into the books" } : x)));
      try {
        const settled = kind === "ap_invoice" ? await intakeExpense(row, file) : await intakeIncome(row, file);
        if (settled) setRows((r) => [settled, ...r.filter((x) => x.id !== settled.id)].slice(0, HISTORY_LIMIT));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const settled = await settle(row.id, { status: "to_check", reasoning: `Couldn't be recorded in the books: ${msg}` });
        if (settled) setRows((r) => [settled, ...r.filter((x) => x.id !== settled.id)].slice(0, HISTORY_LIMIT));
        toast({ title: `${file.name} wasn't recorded`, description: msg, variant: "destructive" });
      }
      setPending((p) => p.filter((x) => x.key !== key));
    });
    return intakeChain.current;
  };

  const loadRecent = useCallback(async () => {
    const { data } = await sb
      .from("document_inbox")
      .select("id, created_at, original_filename, status, doc_type, summary, reasoning, dropbox_path, error_text")
      .neq("status", "processing")
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    setRows((data ?? []) as InboxRow[]);
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  const fileOne = useCallback(async (file: File): Promise<{ row: InboxRow; handoff: Handoff | null }> => {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("route_invoices", "1");
    const res = await fetch(ENDPOINT, { method: "POST", headers: await authHeaders(), body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.row) throw new Error(body.error ?? `Upload failed (${res.status})`);
    return { row: body.row as InboxRow, handoff: (body.handoff as Handoff | undefined) ?? null };
  }, []);

  const run = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const queue = files.map((f, i) => ({ file: f, key: `${Date.now()}-${i}-${f.name}` }));
    setPending((p) => [...p, ...queue.map((q) => ({ key: q.key, name: q.file.name }))]);
    let idx = 0;
    const worker = async () => {
      while (idx < queue.length) {
        const q = queue[idx++];
        try {
          const { row, handoff } = await fileOne(q.file);
          if (handoff) { void intake(row, q.file, handoff, q.key); continue; } // pending until settled
          setRows((r) => [row, ...r.filter((x) => x.id !== row.id)].slice(0, HISTORY_LIMIT));
        } catch (err) {
          toast({ title: `${q.file.name} couldn't be filed`, description: err instanceof Error ? err.message : String(err), variant: "destructive" });
        }
        setPending((p) => p.filter((x) => x.key !== q.key));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    await intakeChain.current;
    loadRecent();
  }, [fileOne, loadRecent, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    run(Array.from(e.dataTransfer.files));
  }

  const busy = pending.length > 0;

  return (
    <div className="mb-4 animate-fade-in" style={{ animationDelay: "0.05s" }}>
      <div className="ssr-zone">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-px w-6 bg-gold-muted" />
          {/* Same as every feed's title: it brings the whole history back. */}
          <button type="button" onClick={() => setHistory((h) => !h)}
            title={history ? "Back to what's new" : "Show everything ever dropped"}
            className="text-label transition-colors hover:text-foreground">
            Dropzone
          </button>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={[
            "ssr-tile relative flex min-h-[200px] w-full cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed px-6 py-10 text-center transition-colors",
            dragging ? "border-[#C9A96A]/70 bg-[#C9A96A]/[0.06]" : "border-white/15 hover:border-[#C9A96A]/40",
          ].join(" ")}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) run(Array.from(e.target.files)); e.target.value = ""; }}
          />
          {busy ? (
            <Loader2 className="mb-4 h-7 w-7 animate-spin text-[#C9A96A]" strokeWidth={1.4} />
          ) : (
            <UploadCloud className="mb-4 h-7 w-7 text-white/35" strokeWidth={1.4} />
          )}
          <span className="text-base text-standard">
            {busy ? `Reading ${pending.length} document${pending.length === 1 ? "" : "s"}` : "Drop any document here"}
            {!busy && <span className="text-white/35"> — or click to browse</span>}
          </span>
          <span className="mt-2 text-[10px] uppercase tracking-[0.18em] text-white/35">
            Read, classified, renamed and filed to Dropbox · invoices go into the P&amp;L
          </span>
          {busy && (
            <div className="mt-5 flex w-full max-w-md flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
              {pending.map((p) => (
                <div key={p.key} className="flex items-center gap-2 text-left text-xs text-white/50">
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  <span className="truncate">{p.name}{p.note && <span className="text-white/30"> — {p.note}</span>}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <div className="mt-6">
            <div className="mb-3 flex items-center">
              <p className="text-label">{history ? "Everything dropped" : "Recently filed"}</p>
              <span className="ml-auto text-[10px] tracking-[0.2em] text-muted-foreground">
                {history ? `${rows.length} IN HISTORY` : `${rows.filter((r) => !dismissed.has(r.id)).length} NEW`}
              </span>
            </div>
            <FeedList
              headerless
              title="Dropzone"
              items={rows}
              dismissed={dismissed}
              onDismiss={dismiss}
              history={history}
              onHistoryChange={setHistory}
              emptyText="All caught up — click Dropzone for the history"
              renderItem={(row) => <InboxRowTile row={row} onMove={() => setMoveRow(row)} />}
            />
          </div>
        )}
      </div>

      {/* The P&L review forms. OverheadForm stays mounted (CLAUDE.md); the income dialog mounts with its data, as on the P&L page. */}
      <OverheadForm
        open={!!expenseReview}
        onOpenChange={(o) => { if (!o) closeReview(); }}
        mode="create"
        initial={null}
        defaultValues={expenseReview?.item.defaults ?? null}
        categories={categories ?? []}
        onSaved={() => { reviewSaved.current = true; }}
        reviewReason={expenseReview?.label ?? null}
        previewStagingPath={expenseReview?.item.verdict.showDocument ? expenseReview.item.defaults.staging_storage_path ?? null : null}
      />
      {incomeReview && (
        <IncomeInvoiceReviewDialog
          open
          onOpenChange={(o) => { if (!o) closeReview(); }}
          initial={incomeReview.form}
          sourceFile={incomeReview.file}
          onSaved={() => { reviewSaved.current = true; }}
        />
      )}

      <MoveDialog
        row={moveRow}
        onClose={() => setMoveRow(null)}
        onMoved={(row) => setRows((r) => r.map((x) => (x.id === row.id ? row : x)))}
      />
    </div>
  );
}

function InboxRowTile({ row, onMove }: { row: InboxRow; onMove: () => void }) {
  const { folder, name } = splitPath(row.dropbox_path);
  const canMove = !!row.dropbox_path && row.status !== "duplicate";
  return (
    <div className="ssr-tile ssr-tile-hover flex flex-col gap-1.5 px-4 py-3 pr-10 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex shrink-0 items-center gap-2 sm:w-36 sm:flex-col sm:items-start sm:gap-1">
        <span className={`rounded-sm px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${STATUS_CHIP[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
        {row.doc_type && <span className="text-[10px] uppercase tracking-[0.14em] text-white/35">{DOC_TYPE_LABEL[row.doc_type] ?? row.doc_type}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-strong" title={name || row.original_filename}>{name || row.original_filename}</p>
        {folder && <p className="truncate text-xs text-white/40" title={folder}>{shortFolder(folder)}</p>}
        <p className="mt-1 text-xs text-standard">
          {row.status === "failed" ? row.error_text : row.status === "to_check" ? row.reasoning : row.summary}
        </p>
        {name && name !== row.original_filename && (
          <p className="mt-0.5 truncate text-[11px] text-white/30">Dropped as {row.original_filename}</p>
        )}
      </div>
      {canMove && (
        <div className="flex shrink-0 items-center gap-4 sm:pt-0.5" onClick={(e) => e.stopPropagation()}>
          <a
            href={`https://www.dropbox.com/home${encodeURI(folder)}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-recessive transition-colors hover:text-standard"
          >
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} /> Folder
          </a>
          <button type="button" onClick={onMove} className="text-xs text-recessive transition-colors hover:text-standard">
            Move
          </button>
        </div>
      )}
    </div>
  );
}

function MoveDialog({ row, onClose, onMoved }: { row: InboxRow | null; onClose: () => void; onMoved: (row: InboxRow) => void }) {
  const { toast } = useToast();
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!row) return;
    const p = splitPath(row.dropbox_path);
    setFolder(p.folder);
    setName(p.name);
  }, [row]);

  // Folder suggestions — fetched once, the first time the dialog opens.
  const open = !!row;
  useEffect(() => {
    if (!open || folders.length > 0) return;
    (async () => {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ op: "tree" }),
      });
      const body = await res.json().catch(() => ({}));
      if (Array.isArray(body.folders)) setFolders(body.folders);
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const target = useMemo(() => `${folder.replace(/\/+$/, "")}/${name.trim()}`, [folder, name]);

  async function save() {
    if (!row) return;
    setSaving(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ op: "move", id: row.id, path: target }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error ?? `Move failed (${res.status})`);
      onMoved(body.row as InboxRow);
      onClose();
    } catch (err) {
      toast({ title: "Couldn't move the document", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent hideClose className="max-w-xl rounded-sm border-divider bg-background">
        <DialogHeader>
          <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Dropzone · re-file</p>
          <DialogTitle className="font-serif font-normal text-2xl">Move document</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Folder</Label>
            <Input value={folder} onChange={(e) => setFolder(e.target.value)} list="document-inbox-folders" className="rounded-sm" />
            <datalist id="document-inbox-folders">
              {folders.map((f) => <option key={f} value={f} />)}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label>File name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-sm" />
          </div>
          {row?.dropbox_path && target !== row.dropbox_path && (
            <p className="break-all text-xs text-white/40">{shortFolder(splitPath(target).folder)}/{splitPath(target).name}</p>
          )}
        </div>
        <DialogFooter>
          <div className="flex items-center gap-4">
            <button type="button" onClick={onClose} className="text-sm text-recessive transition-colors hover:text-standard">
              Cancel
            </button>
            <Button onClick={save} disabled={saving || !name.trim() || !folder.trim() || target === row?.dropbox_path} className="rounded-sm bg-gold/20 text-[#ecd39c] hover:bg-gold/30">
              {saving ? "Moving…" : "Move"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
