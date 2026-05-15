import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Contract {
  id: string;
  user_id: string;
  signatory_name: string | null;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  signed_at: string;
}

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
  const [contracts, setContracts]         = useState<Contract[]>([]);
  const [loading, setLoading]             = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    fetchContracts();
  }, []);

  async function fetchContracts() {
    try {
      const { data, error } = await supabase
        .from("freelancer_agreements")
        .select("id, user_id, signatory_name, storage_path, file_name, file_size, signed_at")
        .order("signed_at", { ascending: false });
      if (error) throw error;
      setContracts(data || []);
    } catch {
      toast({ title: "Could not load contracts", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload(c: Contract) {
    setDownloadingId(c.id);
    try {
      const { data, error } = await supabase.storage
        .from("freelancer-agreements")
        .createSignedUrl(c.storage_path, 60, { download: c.file_name });
      if (error || !data?.signedUrl) throw error || new Error("No signed URL");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast({ title: "Could not download agreement", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <AdminLayout>
      <div className="mb-12">
        <h1 className="font-serif font-normal text-foreground" style={{ fontSize: "2.4rem", letterSpacing: "-0.005em" }}>
          Contracts
        </h1>
        <p className="mt-2 font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.24em" }}>
          Signed freelancer service agreements
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gold border-t-transparent" />
        </div>
      ) : contracts.length === 0 ? (
        <p className="font-serif text-foreground/35 text-sm py-8 border-t border-border/30">
          No signed agreements yet.
        </p>
      ) : (
        <div className="space-y-px">
          {contracts.map((c) => (
            <div key={c.id} className="flex items-center gap-5 py-4 border-t border-border/30">
              <FileText className="shrink-0 text-gold" style={{ width: 13, height: 13 }} strokeWidth={1.5} />
              <div className="flex-1 min-w-0">
                <p className="font-serif text-foreground text-sm">
                  {c.signatory_name || "Freelancer Agreement"}
                </p>
                <p className="font-sans uppercase text-foreground/40 mt-0.5" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
                  Signed {formatDate(c.signed_at)}
                  {c.file_size ? ` · ${formatSize(c.file_size)}` : ""}
                </p>
              </div>
              <button
                onClick={() => handleDownload(c)}
                disabled={downloadingId === c.id}
                className="shrink-0 flex items-center gap-1.5 text-foreground/40 hover:text-gold transition-colors disabled:opacity-40"
                style={{ fontSize: 10, letterSpacing: "0.16em" }}
              >
                {downloadingId === c.id ? (
                  <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
                ) : (
                  <Download style={{ width: 12, height: 12 }} strokeWidth={1.5} />
                )}
                <span className="font-sans uppercase">Download</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
