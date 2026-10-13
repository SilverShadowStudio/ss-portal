import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UploadCloud, Loader2, FolderOpen } from "lucide-react";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// Document Inbox — drop any document; the portal reads it, works out what it
// is, renames it to the studio convention and files it in Dropbox. The filing
// strategy lives in supabase/functions/parse-document/inbox.ts.

const sb = supabase as any;
const ENDPOINT = `${SUPABASE_URL}/functions/v1/parse-document?action=inbox`;
const ADMIN_ROOT = "/03_Portal_Admin_Docs";
const CONCURRENCY = 2;
const RECENT_LIMIT = 12;

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

interface Pending { key: string; name: string }

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

  const loadRecent = useCallback(async () => {
    const { data } = await sb
      .from("document_inbox")
      .select("id, created_at, original_filename, status, doc_type, summary, reasoning, dropbox_path, error_text")
      .neq("status", "processing")
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT);
    setRows((data ?? []) as InboxRow[]);
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  const fileOne = useCallback(async (file: File): Promise<InboxRow | null> => {
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await fetch(ENDPOINT, { method: "POST", headers: await authHeaders(), body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.row) throw new Error(body.error ?? `Upload failed (${res.status})`);
    return body.row as InboxRow;
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
          const row = await fileOne(q.file);
          if (row) setRows((r) => [row, ...r.filter((x) => x.id !== row.id)].slice(0, RECENT_LIMIT));
        } catch (err) {
          toast({ title: `${q.file.name} couldn't be filed`, description: err instanceof Error ? err.message : String(err), variant: "destructive" });
        }
        setPending((p) => p.filter((x) => x.key !== q.key));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    loadRecent();
  }, [fileOne, loadRecent, toast]);

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
          <h2 className="text-label">Document Inbox</h2>
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
            Read, classified, renamed and filed to Dropbox
          </span>
          {busy && (
            <div className="mt-5 flex w-full max-w-md flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
              {pending.map((p) => (
                <div key={p.key} className="flex items-center gap-2 text-left text-xs text-white/50">
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                  <span className="truncate">{p.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-label mt-3 mb-1">Recently filed</p>
            {rows.map((row) => <InboxRowTile key={row.id} row={row} onMove={() => setMoveRow(row)} />)}
          </div>
        )}
      </div>

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
    <div className="ssr-tile flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
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
        <div className="flex shrink-0 items-center gap-4 sm:pt-0.5">
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
          <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Document inbox · re-file</p>
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
