import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Eye, FileText } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { AccordionHeader, AccordionPanel } from "@/components/ui/SectionAccordion";
import { cn } from "@/lib/utils";
import { ClientLayout } from "@/components/ClientLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { AgreementViewer, type AgreementViewerData } from "@/components/agreements/AgreementViewer";
import { QuotationViewer, type QuotationViewerData } from "@/components/quotations/QuotationViewer";

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

interface Quotation {
  id: string;
  quotation_number: string | null;
  reference_number: string | null;
  issued_at: string | null;
  created_at: string;
  currency: string | null;
  net_total: number | null;
  gross_total: number | null;
  vat_rate: number | null;
  vat_amount: number | null;
  notes: string | null;
  line_items: Array<{ description?: string; quantity?: number; unit_price?: number }>;
  status: string;
  account_id: string | null;
  project_id: string | null;
  deposit_percentage: number;
  deposit_amount: number | null;
}

interface Invoice {
  id: string;
  invoice_number: string | null;
  reference_number: string | null;
  amount: number;
  currency: string | null;
  status: string;
  due_date: string | null;
  issued_at: string | null;
  created_at: string;
  type: string;
  stripe_checkout_url: string | null;
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

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_acceptance: "Awaiting confirmation",
  accepted: "Confirmed",
  in_production: "In production",
  completed: "Completed",
  cancelled: "Cancelled",
};

const QUOTATION_STATUS_LABELS: Record<string, string> = {
  sent: "Sent",
  signed: "Signed",
};

const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
  pending: "Pending",
  cancelled: "Cancelled",
};

function quotationStatusClass(status: string) {
  switch (status) {
    case "signed": return "text-emerald-600 dark:text-emerald-400";
    case "sent":   return "text-blue-600 dark:text-blue-400";
    default:       return "text-foreground/40";
  }
}

function invoiceStatusClass(status: string) {
  switch (status) {
    case "paid":    return "text-emerald-600 dark:text-emerald-400";
    case "sent":    return "text-blue-600 dark:text-blue-400";
    case "overdue": return "text-rose-600 dark:text-rose-400";
    default:        return "text-foreground/40";
  }
}

// Empty-state caption — italic serif at reduced opacity, reads as state.
function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-serif italic text-foreground/45 py-4 border-t border-border/30" style={{ fontSize: 13 }}>
      {children}
    </p>
  );
}

function toViewerData(q: Quotation): QuotationViewerData {
  return {
    ...q,
    amount: q.gross_total,
    subtotal: q.net_total,
  } as QuotationViewerData;
}

interface FreelancerDocument {
  id: string;
  document_type: "nda" | "service_agreement";
  signed_at: string | null;
  signed_by_name: string | null;
  pdf_url: string | null;
}

export default function Documents() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { accountType } = useAuth();
  const [freelancerDocuments, setFreelancerDocuments] = useState<FreelancerDocument[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<AgreementViewerData | null>(null);
  const [selectedQuotation, setSelectedQuotation] = useState<QuotationViewerData | null>(null);
  const [quotationOpen, setQuotationOpen] = useState(false);
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);

  // Accordion — only one section open at a time. Null until the first data
  // load picks the best initial section based on the priorities below.
  type SectionKey = "agreement" | "orders" | "quotations" | "invoices";
  const [openSection, setOpenSection] = useState<SectionKey | null>(null);
  const [defaultPicked, setDefaultPicked] = useState(false);

  const toggleSection = (key: SectionKey) =>
    setOpenSection((cur) => (cur === key ? null : key));

  // Project clients don't have Orders — hide that section + skip it from
  // the default-open priority.
  const showOrders = accountType !== "project";

  // Pick the initial open section the first time data settles. Priority:
  // any unpaid invoice → Invoices; else no signed agreement → Agreement;
  // else first non-empty section; else everything collapsed.
  // Orders is omitted from the priority chain when `showOrders` is false.
  useEffect(() => {
    if (defaultPicked || loading) return;
    const unpaid = invoices.some((i) => i.status !== "paid" && i.status !== "draft");
    if (unpaid) { setOpenSection("invoices"); setDefaultPicked(true); return; }
    if (agreements.length === 0) { setOpenSection("agreement"); setDefaultPicked(true); return; }
    if (showOrders && orders.length > 0) { setOpenSection("orders"); setDefaultPicked(true); return; }
    if (quotations.length > 0) { setOpenSection("quotations"); setDefaultPicked(true); return; }
    if (invoices.length > 0) { setOpenSection("invoices"); setDefaultPicked(true); return; }
    setDefaultPicked(true);
  }, [defaultPicked, loading, invoices, agreements, orders, quotations, showOrders]);

  async function handlePayInvoice(inv: Invoice) {
    if (inv.stripe_checkout_url) {
      window.open(inv.stripe_checkout_url, "_blank", "noopener,noreferrer");
      return;
    }
    setPayingInvoiceId(inv.id);
    try {
      const { data, error } = await supabase.functions.invoke("create-invoice-checkout", {
        body: { invoice_id: inv.id },
      });
      if (error) throw error;
      if (data?.pending) {
        toast({
          title: "Payments not configured yet",
          description: data.message || "Stripe is being set up. Please try again shortly.",
        });
        return;
      }
      if (!data?.url) throw new Error("No checkout URL returned");
      setInvoices((list) =>
        list.map((i) => (i.id === inv.id ? { ...i, stripe_checkout_url: data.url } : i))
      );
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast({
        title: "Could not start payment",
        description: e?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPayingInvoiceId(null);
    }
  }

  useEffect(() => {
    if (accountType === 'team') {
      fetchFreelancerDocs();
    } else {
      fetchAll();
    }
  }, [accountType]);

  async function fetchFreelancerDocs() {
    try {
      const { data } = await supabase
        .from("freelancer_documents")
        .select("id, document_type, signed_at, signed_by_name, pdf_url")
        .order("document_type", { ascending: true });
      setFreelancerDocuments((data || []) as FreelancerDocument[]);
    } catch {
      toast({ title: "Could not load documents", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleFreelancerDownload(doc: FreelancerDocument) {
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

  async function fetchAll() {
    try {
      const [{ data: agrs }, { data: quots }, { data: invs }, { data: ords }] = await Promise.all([
        supabase
          .from("agreements")
          .select("id, company_name, signatory_name, signatory_position, storage_path, file_name, file_size, signed_at")
          .order("signed_at", { ascending: false }),
        supabase
          .from("quotation_documents")
          .select("id, quotation_number, reference_number, issued_at, created_at, currency, net_total, gross_total, vat_rate, vat_amount, notes, line_items, status, account_id, project_id, deposit_percentage, deposit_amount")
          .in("status", ["sent", "signed"])
          .order("created_at", { ascending: false }),
        supabase
          .from("invoices")
          .select("id, invoice_number, reference_number, amount, currency, status, due_date, issued_at, created_at, type, stripe_checkout_url")
          .order("created_at", { ascending: false }),
        supabase
          .from("orders")
          .select("id, order_number, title, status, total, currency, accepted_at, created_at")
          .order("created_at", { ascending: false }),
      ]);
      setAgreements(agrs || []);
      setQuotations((quots || []) as Quotation[]);
      setInvoices((invs || []) as Invoice[]);
      setOrders(ords || []);
    } catch {
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

  if (accountType === "team") {
    const DOC_LABELS: Record<string, string> = {
      nda:               "Mutual Non-Disclosure Agreement",
      service_agreement: "Freelance Service Agreement",
    };

    return (
      <ClientLayout>
        <div className="mb-16 animate-fade-in">
          <h1 className="font-serif font-normal text-foreground" style={{ fontSize: "2.6rem", letterSpacing: "-0.005em" }}>
            Documents
          </h1>
          <p className="mt-3 font-sans uppercase text-foreground/45" style={{ fontSize: 10, letterSpacing: "0.22em" }}>
            Your signed agreements
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <BrandLoader size="md" />
          </div>
        ) : freelancerDocuments.length === 0 ? (
          <p className="font-serif text-foreground/35 text-sm py-4 border-t border-border/30 animate-fade-in">
            Your signed agreements will appear here once onboarding is complete.
          </p>
        ) : (
          <div className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
            {freelancerDocuments.map((doc) => (
              <div key={doc.id} className="flex items-center gap-5 py-4 border-t border-border/30">
                <FileText className="shrink-0 text-gold" style={{ width: 14, height: 14 }} strokeWidth={1.5} />
                <div className="flex-1 min-w-0">
                  <p className="font-serif text-foreground" style={{ fontSize: 14 }}>
                    {DOC_LABELS[doc.document_type] ?? doc.document_type}
                  </p>
                  <p className="font-sans uppercase text-foreground/40 mt-1" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
                    {doc.signed_at ? `Signed ${formatDate(doc.signed_at)}` : ""}
                    {doc.signed_by_name ? ` · ${doc.signed_by_name}` : ""}
                  </p>
                </div>
                {doc.pdf_url && (
                  <button
                    onClick={() => handleFreelancerDownload(doc)}
                    disabled={downloadingId === doc.id}
                    className="flex items-center gap-1.5 text-foreground/40 hover:text-gold transition-colors disabled:opacity-40"
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
              </div>
            ))}
          </div>
        )}
      </ClientLayout>
    );
  }

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
          <BrandLoader size="md" />
        </div>
      ) : (
        <div className="animate-fade-in" style={{ animationDelay: "0.1s" }}>

          {/* ── Client Agreement ─────────────────────────────────────────── */}
          <section className={cn(openSection === "agreement" ? "mb-12" : "mb-6")}>
            <AccordionHeader
              label="Client Agreement"
              count={agreements.length}
              isOpen={openSection === "agreement"}
              onToggle={() => toggleSection("agreement")}
            />
            <AccordionPanel isOpen={openSection === "agreement"}>
            {agreements.length === 0 ? (
              <EmptyState>Your signed agreement will appear here once your account is activated.</EmptyState>
            ) : (
              <div className="space-y-1">
                {agreements.map((a) => (
                  <div key={a.id} className="flex items-center gap-5 py-4 border-t border-border/30">
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
                          <BrandLoader size="sm" className="h-3 w-3" />
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
            </AccordionPanel>
          </section>

          {/* ── Orders ───────────────────────────────────────────────────── */}
          {/* Hidden for project clients — they don't have orders, and Orders
              was already removed from their sidebar. Partnership clients keep
              the full accordion. */}
          {showOrders && (
          <section className={cn(openSection === "orders" ? "mb-12" : "mb-6")}>
            <AccordionHeader
              label="Orders"
              count={orders.length}
              isOpen={openSection === "orders"}
              onToggle={() => toggleSection("orders")}
              action={orders.length > 0 ? { label: "View all", onClick: () => navigate("/orders") } : undefined}
            />
            <AccordionPanel isOpen={openSection === "orders"}>
            {orders.length === 0 ? (
              <EmptyState>No orders yet.</EmptyState>
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
                          {ORDER_STATUS_LABELS[order.status] || order.status}
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
            </AccordionPanel>
          </section>
          )}

          {/* ── Quotations ───────────────────────────────────────────────── */}
          <section className={cn(openSection === "quotations" ? "mb-12" : "mb-6")}>
            <AccordionHeader
              label="Quotations"
              count={quotations.length}
              isOpen={openSection === "quotations"}
              onToggle={() => toggleSection("quotations")}
            />
            <AccordionPanel isOpen={openSection === "quotations"}>
            {quotations.length === 0 ? (
              <EmptyState>No quotations yet.</EmptyState>
            ) : (
              <div>
                {quotations.map((q) => {
                  const num = q.quotation_number || q.reference_number || "—";
                  const total = q.gross_total ?? q.net_total;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => {
                        setSelectedQuotation(toViewerData(q));
                        setQuotationOpen(true);
                      }}
                      className="group w-full flex items-center gap-5 py-4 border-t border-border/30 text-left hover:border-border/60 transition-all"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-serif text-foreground group-hover:text-gold transition-colors" style={{ fontSize: 13 }}>
                          {num}
                        </p>
                        <p className="font-sans uppercase text-foreground/40 mt-0.5" style={{ fontSize: 9, letterSpacing: "0.16em" }}>
                          {formatDateShort(q.issued_at || q.created_at)}
                        </p>
                      </div>
                      {total != null && (
                        <p className="shrink-0 font-sans tabular-nums text-foreground/70" style={{ fontSize: 12 }}>
                          {formatCurrency(total, q.currency || "GBP")}
                        </p>
                      )}
                      <p className={`shrink-0 font-sans uppercase ${quotationStatusClass(q.status)}`} style={{ fontSize: 9, letterSpacing: "0.16em" }}>
                        {QUOTATION_STATUS_LABELS[q.status] || q.status}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
            </AccordionPanel>
          </section>

          {/* ── Invoices ─────────────────────────────────────────────────── */}
          <section className={cn(openSection === "invoices" ? "mb-12" : "mb-6", "last:mb-0")}>
            <AccordionHeader
              label="Invoices"
              count={invoices.length}
              isOpen={openSection === "invoices"}
              onToggle={() => toggleSection("invoices")}
            />
            <AccordionPanel isOpen={openSection === "invoices"}>
            {invoices.length === 0 ? (
              <EmptyState>No invoices yet.</EmptyState>
            ) : (
              <div>
                {invoices.map((inv) => {
                  const num = inv.invoice_number || inv.reference_number || "—";
                  const canPay = inv.status !== "paid" && inv.status !== "draft";
                  const isPaying = payingInvoiceId === inv.id;
                  return (
                    <div key={inv.id} className="flex items-center gap-5 py-4 border-t border-border/30">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <p className="font-serif text-foreground" style={{ fontSize: 13 }}>
                            {num}
                          </p>
                          {inv.type !== "standalone" && (
                            <span className="font-sans uppercase text-foreground/35" style={{ fontSize: 8, letterSpacing: "0.16em" }}>
                              {inv.type === "deposit" ? "Deposit" : "Balance"}
                            </span>
                          )}
                        </div>
                        <p className="font-sans uppercase text-foreground/40 mt-0.5" style={{ fontSize: 9, letterSpacing: "0.16em" }}>
                          {inv.due_date
                            ? `Due ${formatDateShort(inv.due_date)}`
                            : formatDateShort(inv.issued_at || inv.created_at)}
                        </p>
                      </div>
                      <p className="shrink-0 font-sans tabular-nums text-foreground/70" style={{ fontSize: 12 }}>
                        {formatCurrency(inv.amount, inv.currency || "GBP")}
                      </p>
                      <p
                        className={`shrink-0 font-sans uppercase ${invoiceStatusClass(inv.status)}`}
                        style={{ fontSize: 9, letterSpacing: "0.16em", minWidth: 40 }}
                      >
                        {INVOICE_STATUS_LABELS[inv.status] || inv.status}
                      </p>
                      {canPay && (
                        <button
                          type="button"
                          disabled={isPaying}
                          onClick={() => handlePayInvoice(inv)}
                          className="shrink-0 inline-flex items-center px-3 py-1.5 bg-gold text-background hover:bg-gold/90 disabled:opacity-50 transition-colors font-sans uppercase"
                          style={{ fontSize: 9, letterSpacing: "0.16em" }}
                        >
                          {isPaying ? "Opening…" : "Pay now"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            </AccordionPanel>
          </section>

        </div>
      )}

      <AgreementViewer
        agreement={previewing}
        open={!!previewing}
        onOpenChange={(o) => { if (!o) setPreviewing(null); }}
      />

      <QuotationViewer
        quotation={selectedQuotation}
        open={quotationOpen}
        onOpenChange={(o) => {
          setQuotationOpen(o);
          if (!o) setSelectedQuotation(null);
        }}
      />
    </ClientLayout>
  );
}
