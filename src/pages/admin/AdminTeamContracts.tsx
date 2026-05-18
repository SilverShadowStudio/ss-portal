import { useEffect, useMemo, useState } from "react";
import { Download, FileText, MoreHorizontal, Trash2 } from "lucide-react";
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

  // Accordion — single section open at a time. Default-picked once after
  // the first data load: member with the most recent signed agreement.
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [defaultPicked, setDefaultPicked] = useState(false);

  const toggleSection = (key: string) =>
    setOpenSection((cur) => (cur === key ? null : key));

  useEffect(() => { fetchDocs(); }, []);

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
          Signed freelancer agreements
        </p>
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
    </AdminLayout>
  );
}
