import { useEffect, useRef, useState } from "react";
import { Eye, Pencil, Upload, Trash2 } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// A team member's filed documents, inline on their card: uploaded engagement
// contracts (team_contracts, manageable — rename/replace/delete, Dropbox-synced)
// and portal-signed agreements (freelancer_documents, view/delete). Replaces the
// standalone Team Agreements page.

interface UploadedDoc {
  kind: "uploaded";
  id: string;
  title: string;
  status: string | null;
  storage_path: string | null;
  date: string | null;
}
interface SignedDoc {
  kind: "signed";
  id: string;
  title: string;
  storage_path: string | null; // pdf_url
  date: string | null;
}
type Doc = UploadedDoc | SignedDoc;

const DOC_LABEL: Record<string, string> = { nda: "Mutual NDA", service_agreement: "Service Agreement" };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export function TeamDocsPanel({ accountId, userId, memberName }: { accountId: string; userId: string | null; memberName: string }) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const [contractsRes, signedRes] = await Promise.all([
      supabase.from("team_contracts").select("id, subject_line, status, storage_path, dropbox_path, signed_at, created_at").eq("account_id", accountId).not("storage_path", "is", null),
      userId ? supabase.from("freelancer_documents").select("id, document_type, signed_at, pdf_url").eq("user_id", userId) : Promise.resolve({ data: [] as any[] }),
    ]);
    const uploaded: Doc[] = ((contractsRes.data ?? []) as any[]).map((c) => ({
      kind: "uploaded", id: c.id, title: c.subject_line || "Document", status: c.status, storage_path: c.storage_path, date: c.signed_at || c.created_at,
    }));
    const signed: Doc[] = ((signedRes.data ?? []) as any[]).map((d) => ({
      kind: "signed", id: d.id, title: DOC_LABEL[d.document_type] || d.document_type, storage_path: d.pdf_url, date: d.signed_at,
    }));
    setDocs([...uploaded, ...signed].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")));
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [accountId, userId]);

  async function view(d: Doc) {
    if (!d.storage_path) return;
    const { data } = await supabase.storage.from("freelancer-documents").createSignedUrl(d.storage_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }
  async function manage(id: string, action: "rename" | "delete" | "replace", extra: Record<string, unknown> = {}) {
    setBusy(id);
    try {
      const { data, error } = await supabase.functions.invoke("team-document-manage", { body: { contract_id: id, action, ...extra } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return true;
    } catch (e: any) {
      toast({ title: `Couldn't ${action} the document`, description: e?.message, variant: "destructive" });
      return false;
    } finally { setBusy(null); }
  }
  async function renameDoc(d: UploadedDoc) {
    const title = window.prompt("Rename document (also renames the file on Dropbox)", d.title);
    if (title == null || !title.trim() || title.trim() === d.title) return;
    if (await manage(d.id, "rename", { new_title: title.trim() })) { toast({ title: "Renamed" }); load(); }
  }
  async function deleteUploaded(d: UploadedDoc) {
    if (!window.confirm(`Delete "${d.title}" for ${memberName}? This removes it from the portal AND Dropbox.`)) return;
    if (await manage(d.id, "delete")) { toast({ title: "Document deleted" }); load(); }
  }
  async function deleteSigned(d: SignedDoc) {
    if (!window.confirm(`Delete "${d.title}" for ${memberName}? This cannot be undone.`)) return;
    setBusy(d.id);
    if (d.storage_path) await supabase.storage.from("freelancer-documents").remove([d.storage_path]).catch(() => {});
    const { error } = await supabase.from("freelancer_documents").delete().eq("id", d.id);
    setBusy(null);
    if (error) { toast({ title: "Couldn't delete", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Agreement deleted" }); load();
  }
  function triggerReplace(id: string) { setReplaceTarget(id); replaceRef.current?.click(); }
  async function onReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    const target = replaceTarget; setReplaceTarget(null);
    if (!file || !target) return;
    const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => { const s = r.result as string; const c = s.indexOf(","); res(c >= 0 ? s.slice(c + 1) : s); }; r.onerror = () => rej(r.error); r.readAsDataURL(file); });
    if (await manage(target, "replace", { file_base64: b64, file_mime: file.type })) toast({ title: "Document replaced" });
  }

  return (
    <div className="px-5 pb-4 pt-1 bg-muted/10 border-t border-border/20">
      <p className="font-sans uppercase text-foreground/35 mb-2" style={{ fontSize: 9, letterSpacing: "0.2em" }}>Documents</p>
      <input ref={replaceRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={onReplaceFile} />
      {loading ? (
        <p className="text-xs text-foreground/35 animate-pulse">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-foreground/35">No documents yet. Upload one with the ⬆ button.</p>
      ) : (
        <div className="flex flex-col gap-y-1">
          {docs.map((d) => (
            <div key={`${d.kind}-${d.id}`} className="flex items-center justify-between gap-3 py-1 -mx-1 px-1 rounded-sm hover:bg-muted/20">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-sans tabular-nums text-foreground/40 shrink-0" style={{ fontSize: 10, minWidth: 92 }}>{fmt(d.date)}</span>
                <span className="font-serif text-foreground/80 truncate" style={{ fontSize: 12 }}>{d.title}</span>
                {d.kind === "signed" && <span className="font-sans uppercase text-emerald-500/70 shrink-0" style={{ fontSize: 8, letterSpacing: "0.16em" }}>Signed</span>}
                {d.kind === "uploaded" && d.status && d.status !== "signed" && <span className="font-sans uppercase text-foreground/35 shrink-0" style={{ fontSize: 8, letterSpacing: "0.16em" }}>{d.status}</span>}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {busy === d.id ? <BrandLoader size="sm" className="h-3 w-3" /> : (
                  <>
                    <button onClick={() => view(d)} className="text-foreground/35 hover:text-gold transition-colors" title="View / download"><Eye style={{ width: 12, height: 12 }} strokeWidth={1.5} /></button>
                    {d.kind === "uploaded" && (
                      <>
                        <button onClick={() => renameDoc(d)} className="text-foreground/35 hover:text-gold transition-colors" title="Rename (syncs Dropbox)"><Pencil style={{ width: 12, height: 12 }} strokeWidth={1.5} /></button>
                        <button onClick={() => triggerReplace(d.id)} className="text-foreground/35 hover:text-gold transition-colors" title="Replace (syncs Dropbox)"><Upload style={{ width: 12, height: 12 }} strokeWidth={1.5} /></button>
                        <button onClick={() => deleteUploaded(d)} className="text-foreground/30 hover:text-rose-400 transition-colors" title="Delete (removes from Dropbox too)"><Trash2 style={{ width: 12, height: 12 }} strokeWidth={1.5} /></button>
                      </>
                    )}
                    {d.kind === "signed" && (
                      <button onClick={() => deleteSigned(d)} className="text-foreground/30 hover:text-rose-400 transition-colors" title="Delete"><Trash2 style={{ width: 12, height: 12 }} strokeWidth={1.5} /></button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
