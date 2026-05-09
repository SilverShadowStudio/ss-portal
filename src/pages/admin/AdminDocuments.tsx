import { useEffect, useMemo, useState } from "react";
import { Download, Eye, FileText, Loader2, Search } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AgreementViewer, type AgreementViewerData } from "@/components/agreements/AgreementViewer";

interface AgreementRow {
  id: string;
  user_id: string;
  company_name: string;
  signatory_name: string | null;
  signatory_position: string | null;
  accepted_by_name: string | null;
  accepted_by_email: string | null;
  agreement_version: string;
  agreement_uid: string | null;
  accepted_at: string | null;
  signed_at: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  ip_address: string | null;
}

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function AdminDocuments() {
  const { toast } = useToast();
  const [agreements, setAgreements] = useState<AgreementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [previewing, setPreviewing] = useState<AgreementViewerData | null>(null);

  useEffect(() => {
    void fetchAgreements();
  }, []);

  async function fetchAgreements() {
    try {
      const { data, error } = await supabase
        .from("agreements")
        .select(
          "id, user_id, company_name, signatory_name, signatory_position, accepted_by_name, accepted_by_email, agreement_version, agreement_uid, accepted_at, signed_at, storage_path, file_name, file_size, ip_address"
        )
        .order("accepted_at", { ascending: false, nullsFirst: false });

      if (error) throw error;
      setAgreements((data as AgreementRow[]) || []);
    } catch (err) {
      console.error(err);
      toast({
        title: "Could not load agreements",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const handleDownload = async (a: AgreementRow) => {
    setDownloadingId(a.id);
    try {
      const { data, error } = await supabase.storage
        .from("agreements")
        .download(a.storage_path);
      if (error || !data) throw error || new Error("No file");
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.file_name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast({ title: "Could not download agreement", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agreements;
    return agreements.filter((a) =>
      [
        a.company_name,
        a.signatory_name,
        a.accepted_by_name,
        a.accepted_by_email,
        a.agreement_version,
      ]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
    );
  }, [agreements, search]);

  return (
    <AdminLayout>
      {/* Header */}
      <div className="mb-10 animate-fade-in">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px w-12 bg-gold" />
          <span className="text-label-gold">Document Management</span>
        </div>
        <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4">
          AGREEMENTS
        </h1>
        <p className="text-sm text-muted-foreground">
          Signed Terms of Use and Services Agreements accepted by clients.
        </p>
      </div>

      {/* Search */}
      <div className="mb-6 animate-fade-in" style={{ animationDelay: "0.05s" }}>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by company, contact, version…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div
        className="rounded-xl border border-border bg-card shadow-sm animate-fade-in overflow-hidden"
        style={{ animationDelay: "0.1s" }}
      >
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            {search ? "No agreements match your search." : "No agreements have been accepted yet."}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            <div className="hidden md:grid grid-cols-[1.4fr_1.2fr_0.8fr_1fr_120px] gap-4 px-6 py-3 bg-muted/30 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>Client / Company</span>
              <span>Contact</span>
              <span>Version</span>
              <span>Accepted</span>
              <span className="text-right">Action</span>
            </div>
            {filtered.map((a) => (
              <div
                key={a.id}
                className="grid grid-cols-1 md:grid-cols-[1.4fr_1.2fr_0.8fr_1fr_120px] gap-3 md:gap-4 px-6 py-4 items-center hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border border-gold/40 text-gold shrink-0">
                    <FileText className="h-4 w-4" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-serif text-sm text-foreground truncate">
                      {a.company_name}
                    </p>
                    <span className="mt-0.5 inline-block rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
                      ACCEPTED
                    </span>
                  </div>
                </div>
                <div className="text-xs">
                  <p className="text-foreground truncate">
                    {a.accepted_by_name || a.signatory_name || "—"}
                  </p>
                  <p className="text-muted-foreground truncate">
                    {a.accepted_by_email || "—"}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground tracking-wide">
                  {a.agreement_version}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(a.accepted_at || a.signed_at)}
                  {a.ip_address && (
                    <span className="block text-[10px] text-muted-foreground/60 mt-0.5">
                      IP {a.ip_address}
                    </span>
                  )}
                </div>
                <div className="md:text-right">
                  <div className="inline-flex items-center gap-4">
                    <button
                      onClick={() => setPreviewing({
                        id: a.id,
                        storage_path: a.storage_path,
                        file_name: a.file_name,
                        company_name: a.company_name,
                        agreement_version: a.agreement_version,
                      })}
                      className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground transition-smooth hover:text-gold"
                    >
                      <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
                      Preview
                    </button>
                    <button
                      onClick={() => handleDownload(a)}
                      disabled={downloadingId === a.id}
                      className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground transition-smooth hover:text-gold disabled:opacity-50"
                    >
                      {downloadingId === a.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
                      )}
                      PDF
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AgreementViewer
        agreement={previewing}
        open={!!previewing}
        onOpenChange={(o) => { if (!o) setPreviewing(null); }}
      />
    </AdminLayout>
  );
}