import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, MoreHorizontal, Trash2, Pencil, Upload } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { AdminLayout } from "@/components/AdminLayout";
import { AccordionHeader, AccordionPanel } from "@/components/ui/SectionAccordion";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { TeamContractFormDialog, type TeamContractRow } from "@/components/admin/TeamContractFormDialog";

interface FreelancerDoc {
  id: string;
  document_type: "nda" | "service_agreement";
  signed_at: string | null;
  signed_by_name: string | null;
  pdf_url: string | null;
}

const DOC_LABELS: Record<string, string> = {
  nda:               "Mutual NDA",
  service_agreement: "Freelance Service Agreement",
};

const DOC_ORDER: Record<string, number> = { nda: 0, service_agreement: 1 };

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

// Per-project engagement contracts (team_contracts). Distinct from the fixed
// onboarding NDA + service agreement above.
interface EngagementContract {
  id: string;
  entity_type: "individual" | "company";
  individual_full_name: string | null;
  company_name: string | null;
  subject_line: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  signed_at: string | null;
  storage_path: string | null;
  dropbox_path: string | null;
}

const CONTRACT_STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: "Draft",     cls: "text-foreground/45" },
  sent:      { label: "Sent",      cls: "text-gold" },
  signed:    { label: "Signed",    cls: "text-emerald-500" },
  declined:  { label: "Declined",  cls: "text-rose-400" },
  cancelled: { label: "Cancelled", cls: "text-foreground/35" },
};

interface MemberGroup {
  name: string;
  docs: FreelancerDoc[];
  /** Most recent signed_at across this member's docs — drives default-open priority. */
  mostRecentSignedAt: string | null;
}

export default function AdminTeamContracts() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<FreelancerDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [contracts, setContracts] = useState<EngagementContract[]>([]);
  const [deletingContractId, setDeletingContractId] = useState<string | null>(null);
  const [editingContract, setEditingContract] = useState<TeamContractRow | null>(null);
  const [contractDialogOpen, setContractDialogOpen] = useState(false);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Accordion — single section open at a time. Default-picked once after
  // the first data load: member with the most recent signed agreement.
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [defaultPicked, setDefaultPicked] = useState(false);

  const toggleSection = (key: string) =>
    setOpenSection((cur) => (cur === key ? null : key));

  useEffect(() => { fetchDocs(); fetchContracts(); }, []);

  async function fetchDocs() {
    try {
      const { data, error } = await supabase
        .from("freelancer_documents")
        .select("id, document_type, signed_at, signed_by_name, pdf_url")
        .order("signed_by_name", { ascending: true })
        .order("document_type",  { ascending: true });
      if (error) throw error;
      setDocs((data || []) as FreelancerDoc[]);
    } catch {
      toast({ title: "Could not load agreements", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function fetchContracts() {
    const { data, error } = await supabase
      .from("team_contracts")
      .select("id, entity_type, individual_full_name, company_name, subject_line, status, created_at, sent_at, signed_at, storage_path, dropbox_path")
      .order("created_at", { ascending: false });
    if (!error) setContracts((data || []) as EngagementContract[]);
  }

  // Fetch the full row and open the form pre-filled to edit a draft.
  async function openForEdit(id: string) {
    const { data, error } = await supabase
      .from("team_contracts")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) {
      toast({ title: "Could not open contract", description: error?.message || "Not found", variant: "destructive" });
      return;
    }
    setEditingContract(data as unknown as TeamContractRow);
    setContractDialogOpen(true);
  }

  async function handleDeleteContract(c: EngagementContract) {
    const who = c.entity_type === "company" ? (c.company_name || "this company") : (c.individual_full_name || "this contractor");
    if (!window.confirm(`Delete the draft engagement contract for ${who}? This cannot be undone.`)) return;
    setDeletingContractId(c.id);
    try {
      const { error } = await supabase.from("team_contracts").delete().eq("id", c.id);
      if (error) throw error;
      toast({ title: "Draft contract deleted" });
      fetchContracts();
    } catch (err: any) {
      toast({ title: "Could not delete contract", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setDeletingContractId(null);
    }
  }

  // ── Uploaded-document management (rename / replace / delete) with Dropbox sync ──
  async function manageDoc(contractId: string, action: "rename" | "delete" | "replace", extra: Record<string, unknown> = {}): Promise<boolean> {
    setBusyDocId(contractId);
    try {
      const { data, error } = await supabase.functions.invoke("team-document-manage", { body: { contract_id: contractId, action, ...extra } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return true;
    } catch (e: any) {
      toast({ title: `Couldn't ${action} the document`, description: e?.message, variant: "destructive" });
      return false;
    } finally {
      setBusyDocId(null);
    }
  }
  async function handleRenameDoc(c: EngagementContract) {
    const title = window.prompt("Rename document (also renames the file on Dropbox)", c.subject_line || "");
    if (title == null || !title.trim() || title.trim() === c.subject_line) return;
    if (await manageDoc(c.id, "rename", { new_title: title.trim() })) { toast({ title: "Renamed" }); fetchContracts(); }
  }
  async function handleDeleteDoc(c: EngagementContract) {
    const who = c.entity_type === "company" ? (c.company_name || "this company") : (c.individual_full_name || "this member");
    if (!window.confirm(`Delete "${c.subject_line}" for ${who}? This removes it from the portal AND Dropbox. This cannot be undone.`)) return;
    if (await manageDoc(c.id, "delete")) { toast({ title: "Document deleted" }); fetchContracts(); }
  }
  function triggerReplace(id: string) { setReplaceTarget(id); replaceInputRef.current?.click(); }
  async function onReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    const target = replaceTarget; setReplaceTarget(null);
    if (!file || !target) return;
    const b64 = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => { const s = r.result as string; const c = s.indexOf(","); res(c >= 0 ? s.slice(c + 1) : s); };
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    if (await manageDoc(target, "replace", { file_base64: b64, file_mime: file.type })) toast({ title: "Document replaced" });
  }

  async function handleDownload(doc: FreelancerDoc) {
    if (!doc.pdf_url) return;
    setDownloadingId(doc.id);
    try {
      const fileName = doc.document_type === "nda" ? "mutual-nda.pdf" : "freelancer-service-agreement.pdf";
      const { data, error } = await supabase.storage
        .from("freelancer-documents")
        .createSignedUrl(doc.pdf_url, 60, { download: fileName });
      if (error || !data?.signedUrl) throw error || new Error("No signed URL");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast({ title: "Could not download document", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDelete(doc: FreelancerDoc) {
    const label = DOC_LABELS[doc.document_type] ?? doc.document_type;
    const who = doc.signed_by_name || "this team member";
    if (!window.confirm(`Delete "${label}" for ${who}? This cannot be undone.`)) return;
    setDeletingId(doc.id);
    try {
      if (doc.pdf_url) {
        const { error: storageError } = await supabase.storage
          .from("freelancer-documents")
          .remove([doc.pdf_url]);
        if (storageError) {
          console.warn("[AdminTeamContracts] storage remove failed:", storageError);
        }
      }
      const { error } = await supabase.from("freelancer_documents").delete().eq("id", doc.id);
      if (error) throw error;
      toast({ title: "Agreement deleted" });
      fetchDocs();
    } catch (err: any) {
      toast({
        title: "Could not delete agreement",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  }

  // Group by signed_by_name; record most recent signed_at per group for default-open.
  const memberGroups = useMemo<MemberGroup[]>(() => {
    const byName = new Map<string, MemberGroup>();
    for (const doc of docs) {
      const name = doc.signed_by_name || "Unknown";
      let g = byName.get(name);
      if (!g) {
        g = { name, docs: [], mostRecentSignedAt: null };
        byName.set(name, g);
      }
      g.docs.push(doc);
      if (doc.signed_at && (!g.mostRecentSignedAt || doc.signed_at > g.mostRecentSignedAt)) {
        g.mostRecentSignedAt = doc.signed_at;
      }
    }
    for (const g of byName.values()) {
      g.docs.sort((a, b) => (DOC_ORDER[a.document_type] ?? 9) - (DOC_ORDER[b.document_type] ?? 9));
    }
    // Stable sort by name for visual consistency.
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [docs]);

  // First-load default: member with the most recent signed agreement.
  useEffect(() => {
    if (defaultPicked || loading) return;
    if (memberGroups.length === 0) { setDefaultPicked(true); return; }
    const mostRecent = [...memberGroups].sort((a, b) => {
      const av = a.mostRecentSignedAt ?? "";
      const bv = b.mostRecentSignedAt ?? "";
      return bv.localeCompare(av);
    })[0];
    setOpenSection(mostRecent.name);
    setDefaultPicked(true);
  }, [defaultPicked, loading, memberGroups]);

  return (
    <AdminLayout>
      <div className="mb-12 animate-fade-in">
        <h1 className="font-serif font-normal text-foreground" style={{ fontSize: "2.4rem", letterSpacing: "-0.005em" }}>
          Team Agreements
        </h1>
        <p className="mt-2 font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.24em" }}>
          Engagement contracts and signed freelancer agreements
        </p>
      </div>

      {/* Engagement contracts (per-project; individual or company) */}
      <section className="mb-14 animate-fade-in">
        <div className="mb-5 flex items-center gap-3">
          <span className="h-px w-6 bg-gold-muted" />
          <span className="text-label-gold">Engagement Contracts</span>
        </div>
        {contracts.length === 0 ? (
          <p className="font-serif text-foreground/35 text-sm py-4 border-t border-border/30">
            No engagement contracts yet. Use "Register them" on the Team page to create one.
          </p>
        ) : (
          <div className="border-t border-border/30">
            {contracts.map((c) => {
              const party = c.entity_type === "company" ? (c.company_name || "—") : (c.individual_full_name || "—");
              const st = CONTRACT_STATUS[c.status] ?? { label: c.status, cls: "text-foreground/45" };
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-4 py-3.5 border-b border-border/30 ${c.status === "draft" ? "cursor-pointer hover:bg-muted/20 -mx-2 px-2 rounded-sm transition-colors" : ""}`}
                  onClick={c.status === "draft" ? () => openForEdit(c.id) : undefined}
                  role={c.status === "draft" ? "button" : undefined}
                  title={c.status === "draft" ? "Edit draft" : undefined}
                >
                  <FileText className="shrink-0 text-gold" style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                  <div className="flex-1 min-w-0">
                    <p className="font-serif text-foreground text-sm truncate">{party}</p>
                    <p className="font-sans uppercase text-foreground/40 mt-0.5 truncate" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
                      {c.entity_type} · {c.subject_line}
                    </p>
                  </div>
                  <span className="hidden sm:block shrink-0 font-sans uppercase text-foreground/35" style={{ fontSize: 9, letterSpacing: "0.16em" }}>
                    {c.signed_at ? `Signed ${formatDate(c.signed_at)}` : c.sent_at ? `Sent ${formatDate(c.sent_at)}` : `Created ${formatDate(c.created_at)}`}
                  </span>
                  <span className={`shrink-0 font-sans uppercase ${st.cls}`} style={{ fontSize: 10, letterSpacing: "0.16em" }}>
                    {st.label}
                  </span>
                  {c.storage_path ? (
                    busyDocId === c.id ? (
                      <BrandLoader size="sm" className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <div className="shrink-0 flex items-center gap-3">
                        <button onClick={(e) => { e.stopPropagation(); handleRenameDoc(c); }} className="text-foreground/30 hover:text-gold transition-colors" title="Rename (syncs to Dropbox)">
                          <Pencil style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); triggerReplace(c.id); }} className="text-foreground/30 hover:text-gold transition-colors" title="Replace file (syncs to Dropbox)">
                          <Upload style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteDoc(c); }} className="text-foreground/30 hover:text-rose-400 transition-colors" title="Delete (removes from Dropbox too)">
                          <Trash2 style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                        </button>
                      </div>
                    )
                  ) : c.status === "draft" ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteContract(c); }}
                      disabled={deletingContractId === c.id}
                      className="shrink-0 text-foreground/30 hover:text-rose-400 transition-colors disabled:opacity-40"
                      title="Delete draft"
                    >
                      <Trash2 style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <input ref={replaceInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={onReplaceFile} />

      <div className="mb-5 flex items-center gap-3">
        <span className="h-px w-6 bg-gold-muted" />
        <span className="text-label-gold">Signed Agreements</span>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <BrandLoader size="md" className="h-5 w-5" />
        </div>
      ) : memberGroups.length === 0 ? (
        <p className="font-serif text-foreground/35 text-sm py-8 border-t border-border/30">
          No signed agreements yet.
        </p>
      ) : (
        <div className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
          {memberGroups.map((group, idx) => {
            const isOpen = openSection === group.name;
            const isLast = idx === memberGroups.length - 1;
            return (
              <section
                key={group.name}
                className={cn(isOpen ? "mb-12" : "mb-6", isLast && "last:mb-0")}
              >
                <AccordionHeader
                  label={group.name}
                  count={group.docs.length}
                  isOpen={isOpen}
                  onToggle={() => toggleSection(group.name)}
                />
                <AccordionPanel isOpen={isOpen}>
                  <div>
                    {group.docs.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-5 py-3.5 border-t border-border/30">
                        <FileText className="shrink-0 text-gold" style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                        <div className="flex-1 min-w-0">
                          <p className="font-serif text-foreground text-sm">
                            {DOC_LABELS[doc.document_type] ?? doc.document_type}
                          </p>
                          <p className="font-sans uppercase text-foreground/40 mt-0.5" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
                            {doc.signed_at ? `Signed ${formatDate(doc.signed_at)}` : "Pending"}
                          </p>
                        </div>
                        {doc.pdf_url && (
                          <button
                            onClick={() => handleDownload(doc)}
                            disabled={downloadingId === doc.id}
                            className="shrink-0 flex items-center gap-1.5 text-foreground/40 hover:text-gold transition-colors disabled:opacity-40"
                            style={{ fontSize: 10, letterSpacing: "0.16em" }}
                          >
                            {downloadingId === doc.id ? (
                              <BrandLoader size="sm" className="h-3 w-3" />
                            ) : (
                              <Download style={{ width: 12, height: 12 }} strokeWidth={1.5} />
                            )}
                            <span className="font-sans uppercase">Download</span>
                          </button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {doc.pdf_url && (
                              <DropdownMenuItem onClick={() => handleDownload(doc)} disabled={downloadingId === doc.id}>
                                <Download className="mr-2 h-4 w-4" /> Download
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              disabled={deletingId === doc.id}
                              onClick={() => handleDelete(doc)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Delete agreement
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                </AccordionPanel>
              </section>
            );
          })}
        </div>
      )}

      <TeamContractFormDialog
        open={contractDialogOpen}
        onOpenChange={(o) => { setContractDialogOpen(o); if (!o) setEditingContract(null); }}
        existingContract={editingContract}
        onSaved={fetchContracts}
      />
    </AdminLayout>
  );
}
