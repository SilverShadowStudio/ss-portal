import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
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

const formatSize = (bytes: number | null) => {
  if (!bytes) return "";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

export default function AdminTeamContracts() {
  const { toast } = useToast();
  const [docs, setDocs]                   = useState<FreelancerDoc[]>([]);
  const [loading, setLoading]             = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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
      toast({ title: "Could not load contracts", variant: "destructive" });
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

  // Group by signed_by_name, preserving insertion order
  const grouped: Record<string, FreelancerDoc[]> = {};
  for (const doc of docs) {
    const key = doc.signed_by_name || "Unknown";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(doc);
  }
  // Sort within each group: NDA first
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => (DOC_ORDER[a.document_type] ?? 9) - (DOC_ORDER[b.document_type] ?? 9));
  }

  return (
    <AdminLayout>
      <div className="mb-12">
        <h1 className="font-serif font-normal text-foreground" style={{ fontSize: "2.4rem", letterSpacing: "-0.005em" }}>
          Contracts
        </h1>
        <p className="mt-2 font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.24em" }}>
          Signed freelancer agreements
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gold border-t-transparent" />
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <p className="font-serif text-foreground/35 text-sm py-8 border-t border-border/30">
          No signed agreements yet.
        </p>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([name, memberDocs]) => (
            <div key={name}>
              <p className="font-sans uppercase text-foreground/40 mb-1" style={{ fontSize: 9, letterSpacing: "0.22em" }}>
                {name}
              </p>
              <div>
                {memberDocs.map((doc) => (
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
                          <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
                        ) : (
                          <Download style={{ width: 12, height: 12 }} strokeWidth={1.5} />
                        )}
                        <span className="font-sans uppercase">Download</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
