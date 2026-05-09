import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Download, Eye, FileText, Loader2, Receipt } from "lucide-react";
import { ClientLayout } from "@/components/ClientLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AgreementViewer, type AgreementViewerData } from "@/components/agreements/AgreementViewer";

interface Agreement {
  id: string;
  company_name: string;
  signatory_name: string | null;
  signatory_position: string | null;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  signed_at: string;
}

interface OrderSummary {
  id: string;
  order_number: string | null;
  title: string;
  status: string;
  total: number;
  currency: string;
  accepted_at: string | null;
  created_at: string;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const formatDateShort = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const formatSize = (bytes: number | null) => {
  if (!bytes) return "";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

function formatCurrency(amount: number, currency = "GBP") {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

const STATUS_LABELS: Record<string, string> = {
  pending_acceptance: "Awaiting confirmation",
  accepted: "Confirmed",
  in_production: "In production",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function Documents() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<AgreementViewerData | null>(null);

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    try {
      const [{ data: agrs }, { data: ords }] = await Promise.all([
        supabase
          .from("agreements")
          .select("id, company_name, signatory_name, signatory_position, storage_path, file_name, file_size, signed_at")
          .order("signed_at", { ascending: false }),
        supabase
          .from("orders")
          .select("id, order_number, title, status, total, currency, accepted_at, created_at")
          .order("created_at", { ascending: false }),
      ]);
      setAgreements(agrs || []);
      setOrders(ords || []);
    } catch (err) {
      toast({ title: "Could not load documents", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const handleDownload = async (a: Agreement) => {
    setDownloadingId(a.id);
    try {
      const { data, error } = await supabase.storage
        .from("agreements")
        .createSignedUrl(a.storage_path, 60, { download: a.file_name });
      if (error || !data?.signedUrl) throw error || new Error("No signed URL");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast({ title: "Could not download agreement", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <ClientLayout>
      {/* Header */}
      <div className="mb-16 animate-fade-in">
        <h1
          className="font-serif font-normal text-foreground"
          style={{ fontSize: "2.6rem", letterSpacing: "-0.005em" }}
        >
          Documents
        </h1>
        <p className="mt-3 font-sans uppercase text-foreground/45" style={{ fontSize: 10, letterSpacing: "0.22em" }}>
          Your agreements, orders, and invoices
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-5 w-5 animate-spin text-foreground/30" />
        </div>
      ) : (
        <div className="space-y-16 animate-fade-in" style={{ animationDelay: "0.1s" }}>

          {/* ── Client Agreement ─────────────────────────────────────────── */}
          <section>
            <p className="font-sans uppercase mb-6" style={{ fontSize: 9, letterSpacing: "0.3em", color: "hsl(var(--foreground) / 0.35)" }}>
              Client Agreement
            </p>
            {agreements.length === 0 ? (
              <p className="font-serif text-foreground/35 text-sm py-4 border-t border-border/30">
                Your signed agreement will appear here once your account is activated.
              </p>
            ) : (
              <div className="space-y-1">
                {agreements.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-5 py-4 border-t border-border/30"
                  >
                    <FileText className="shrink-0 text-gold" style={{ width: 14, height: 14 }} strokeWidth={1.5} />
                    <div className="flex-1 min-w-0">
                      <p className="font-serif text-foreground" style={{ fontSize: 14 }}>
                        Silvershadow Studio Client Agreement — {a.company_name}
                      </p>
                      <p className="font-sans uppercase text-foreground/40 mt-1" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
                        Signed {formatDate(a.signed_at)}
                        {a.signatory_name ? ` · ${a.signatory_name}` : ""}
                        {a.file_size ? ` · ${formatSize(a.file_size)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-5 shrink-0">
                      <button
                        onClick={() => setPreviewing({ id: a.id, storage_path: a.storage_path, file_name: a.file_name, company_name: a.company_name })}
                        className="flex items-center gap-1.5 text-foreground/40 hover:text-gold transition-colors"
                        style={{ fontSize: 10, letterSpacing: "0.16em" }}
                      >
                        <Eye style={{ width: 12, height: 12 }} strokeWidth={1.5} />
                        View
                      </button>
                      <button
                        onClick={() => handleDownload(a)}
                        disabled={downloadingId === a.id}
                        className="flex items-center gap-1.5 text-foreground/40 hover:text-gold transition-colors disabled:opacity-40"
                        style={{ fontSize: 10, letterSpacing: "0.16em" }}
                      >
                        {downloadingId === a.id ? (
                          <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
                        ) : (
                          <Download style={{ width: 12, height: 12 }} strokeWidth={1.5} />
                        )}
                        Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Orders ───────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <p className="font-sans uppercase" style={{ fontSize: 9, letterSpacing: "0.3em", color: "hsl(var(--foreground) / 0.35)" }}>
                Orders
              </p>
              <button
                onClick={() => navigate("/orders")}
                className="flex items-center gap-1.5 text-foreground/40 hover:text-foreground transition-colors"
                style={{ fontSize: 10, letterSpacing: "0.16em" }}
              >
                View all
                <ArrowRight style={{ width: 11, height: 11 }} strokeWidth={1.5} />
              </button>
            </div>
            {orders.length === 0 ? (
              <p className="font-serif text-foreground/35 text-sm py-4 border-t border-border/30">
                No orders yet.
              </p>
            ) : (
              <div className="space-y-1">
                {orders.slice(0, 5).map((order) => {
                  const isPending = order.status === "pending_acceptance";
                  return (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => navigate("/orders")}
                      className="group w-full flex items-center gap-5 py-4 border-t border-border/30 text-left hover:border-border/60 transition-all"
                    >
                      <span
                        className="shrink-0 rounded-full"
                        style={{
                          width: 7, height: 7, display: "inline-block",
                          background: isPending ? "hsl(var(--gold))" : "hsl(var(--foreground) / 0.3)",
                          boxShadow: isPending ? "0 0 6px hsl(var(--gold) / 0.5)" : undefined,
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-serif text-foreground truncate group-hover:text-gold transition-colors" style={{ fontSize: 13 }}>
                          {order.title}
                        </p>
                        <p className="font-sans uppercase text-foreground/40 mt-0.5" style={{ fontSize: 9, letterSpacing: "0.16em" }}>
                          {STATUS_LABELS[order.status] || order.status}
                          <span className="mx-2 opacity-40">·</span>
                          {formatDateShort(order.accepted_at || order.created_at)}
                        </p>
                      </div>
                      <p className="shrink-0 font-sans tabular-nums text-foreground/70" style={{ fontSize: 12 }}>
                        {formatCurrency(order.total, order.currency)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Invoices ─────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <p className="font-sans uppercase" style={{ fontSize: 9, letterSpacing: "0.3em", color: "hsl(var(--foreground) / 0.35)" }}>
                Invoices
              </p>
            </div>
            <button
              onClick={() => navigate("/invoices")}
              className="group w-full flex items-center gap-5 py-5 border-t border-border/30 text-left hover:border-border/60 transition-all"
            >
              <Receipt className="shrink-0 text-foreground/30 group-hover:text-foreground/60 transition-colors" style={{ width: 14, height: 14 }} strokeWidth={1.5} />
              <div className="flex-1">
                <p className="font-serif text-foreground group-hover:text-gold transition-colors" style={{ fontSize: 14 }}>
                  Invoice history
                </p>
                <p className="font-sans uppercase text-foreground/35 mt-0.5" style={{ fontSize: 9, letterSpacing: "0.16em" }}>
                  View, download, and settle invoices
                </p>
              </div>
              <ArrowRight className="shrink-0 text-foreground/20 group-hover:text-foreground/50 transition-colors" style={{ width: 13, height: 13 }} strokeWidth={1.5} />
            </button>
          </section>

        </div>
      )}

      <AgreementViewer
        agreement={previewing}
        open={!!previewing}
        onOpenChange={(o) => { if (!o) setPreviewing(null); }}
      />
    </ClientLayout>
  );
}
