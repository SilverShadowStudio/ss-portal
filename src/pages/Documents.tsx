import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Eye, FileText, X } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { AccordionHeader, AccordionPanel } from "@/components/ui/SectionAccordion";
import { cn } from "@/lib/utils";
import { ClientLayout } from "@/components/ClientLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { AgreementViewer, type AgreementViewerData } from "@/components/agreements/AgreementViewer";
import { QuotationViewer, type QuotationViewerData } from "@/components/quotations/QuotationViewer";
import { InvoiceViewer, type InvoiceViewerData } from "@/components/invoices/InvoiceViewer";

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
  account_id: string | null;
  project_id: string | null;
  subtotal: number | null;
  vat_rate: number | null;
  vat_amount: number | null;
  notes: string | null;
  bank_account: string | null;
  line_items: Array<{ description?: string; quantity?: number; unit_price?: number }>;
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

// Documents page status vocabulary (per the status-treatment brief).
//
// The client-facing list uses exactly two words per section: an action
// word in gold (the client still has something to do) and a rest word
// in warm grey (resolved). No other colours, ever.
//
//   Quotations: PENDING (gold)     · SIGNED (warm grey)
//   Invoices:   OUTSTANDING (gold) · PAID   (warm grey)
//
// Any DB status outside that small set is filtered out of the list
// (drafts, expired, withdrawn quotations; drafts, voided, credited
// invoices). Those documents remain in the DB and accessible by direct
// URL — they just don't appear in the at-a-glance list.

function quotationStatusDisplay(status: string): { label: string; tone: "action" | "rest" } | null {
  if (status === "sent") return { label: "Pending", tone: "action" };
  if (status === "signed" || status === "accepted") return { label: "Signed", tone: "rest" };
  return null;
}

function invoiceStatusDisplay(status: string): { label: string; tone: "action" | "rest" } | null {
  if (status === "sent" || status === "partially_paid") {
    return { label: "Outstanding", tone: "action" };
  }
  if (status === "paid") return { label: "Paid", tone: "rest" };
  return null;
}

// Days overdue rounding: if today is past the due date, return the
// integer days. Same-day or earlier returns 0.
function daysOverdue(dueDate: string | null | undefined): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const diffMs = today.getTime() - due.getTime();
  return diffMs > 0 ? Math.floor(diffMs / 86_400_000) : 0;
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

function toInvoiceViewerData(inv: Invoice): InvoiceViewerData {
  // The viewer enriches client company/address/contact from account_id; the
  // structured fields here drive the rendered A4 document.
  return { ...inv } as InvoiceViewerData;
}

interface FreelancerDocument {
  id: string;
  document_type: "nda" | "service_agreement";
  signed_at: string | null;
  signed_by_name: string | null;
  pdf_url: string | null;
  /** Per-document title (from team_contracts.subject_line); overrides the label. */
  title?: string | null;
  /** Official filename as filed to Dropbox — used for download + preview title. */
  official_name?: string | null;
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
  const [previewPdf, setPreviewPdf] = useState<{ name: string; url: string } | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<AgreementViewerData | null>(null);
  const [selectedQuotation, setSelectedQuotation] = useState<QuotationViewerData | null>(null);
  const [quotationOpen, setQuotationOpen] = useState(false);
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceViewerData | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

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
      // Portal-signed docs (FSA/NDA) live in freelancer_documents; a member who
      // joined with an ALREADY-signed contract has it in team_contracts instead.
      const [{ data: fdocs }, { data: contracts }] = await Promise.all([
        supabase
          .from("freelancer_documents")
          .select("id, document_type, signed_at, signed_by_name, pdf_url")
          .order("document_type", { ascending: true }),
        supabase
          .from("team_contracts")
          .select("id, subject_line, signed_at, signed_by_name, storage_path, dropbox_path")
          .eq("status", "signed")
          .not("storage_path", "is", null),
      ]);
      const contractDocs: FreelancerDocument[] = ((contracts || []) as Array<Record<string, unknown>>).map((c) => ({
        id: c.id as string,
        document_type: "service_agreement",
        signed_at: (c.signed_at as string) ?? null,
        signed_by_name: (c.signed_by_name as string) ?? null,
        pdf_url: c.storage_path as string,
        title: (c.subject_line as string) ?? null,
        // The official filename is the Dropbox file's basename.
        official_name: (c.dropbox_path as string | null)?.split("/").pop() ?? null,
      }));
      setFreelancerDocuments([...((fdocs || []) as FreelancerDocument[]), ...contractDocs]);
    } catch {
      toast({ title: "Could not load documents", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // The official filename — the Dropbox basename when filed, else a sensible
  // constructed name so downloads never come out as "freelancer-service-agreement".
  function officialFilename(doc: FreelancerDocument): string {
    if (doc.official_name) return doc.official_name;
    const slug = (s: string) => (s || "").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-");
    const name = slug(doc.signed_by_name || "");
    const title = slug(doc.title || (doc.document_type === "nda" ? "Mutual NDA" : "Agreement"));
    const date = doc.signed_at ? doc.signed_at.slice(0, 10) : "";
    return [name, title, date, "SIGNED"].filter(Boolean).join("_") + ".pdf";
  }

  async function handleFreelancerPreview(doc: FreelancerDocument) {
    if (!doc.pdf_url) return;
    setPreviewLoadingId(doc.id);
    try {
      const { data, error } = await supabase.storage
        .from("freelancer-documents")
        .createSignedUrl(doc.pdf_url, 300);
      if (error || !data?.signedUrl) throw error || new Error("No signed URL");
      setPreviewPdf({ name: officialFilename(doc), url: data.signedUrl });
    } catch {
      toast({ title: "Could not open document", variant: "destructive" });
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function handleFreelancerDownload(doc: FreelancerDocument) {
    if (!doc.pdf_url) return;
    setDownloadingId(doc.id);
    try {
      const { data, error } = await supabase.storage
        .from("freelancer-documents")
        .createSignedUrl(doc.pdf_url, 60, { download: officialFilename(doc) });
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
        // Client-facing invoice list excludes drafts, voided, and credited
        // rows — those stay in the DB for audit but are reachable only by
        // direct URL. The visible vocabulary is "Outstanding" / "Paid".
        supabase
          .from("invoices")
          .select("id, invoice_number, reference_number, amount, currency, status, due_date, issued_at, created_at, type, stripe_checkout_url, account_id, project_id, subtotal, vat_rate, vat_amount, notes, bank_account, line_items")
          .in("status", ["sent", "partially_paid", "paid"])
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

      // Resolve project names for quotation + invoice rows (project_id → name).
      const projectIds = Array.from(new Set([
        ...((quots || []) as Quotation[]).map((q) => q.project_id),
        ...((invs || []) as Invoice[]).map((i) => i.project_id),
      ].filter(Boolean) as string[]));
      if (projectIds.length > 0) {
        const { data: projs } = await supabase
          .from("projects")
          .select("id, name")
          .in("id", projectIds);
        const map: Record<string, string> = {};
        for (const p of (projs || []) as { id: string; name: string }[]) map[p.id] = p.name;
        setProjectNames(map);
      }
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
      service_agreement: "Freelance Services & Confidentiality Agreement",
    };

    return (
      <ClientLayout panel>
        {/* Page header — gold eyebrow */}
        <div className="mb-10 animate-fade-in">
          <div className="mb-4 flex items-center gap-3">
            <div className="h-px w-12 bg-gold-muted" />
            <span className="text-label-gold">Documents</span>
          </div>
          <p className="mt-3 text-sm text-recessive">Your signed agreements</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <BrandLoader size="md" />
          </div>
        ) : freelancerDocuments.length === 0 ? (
          <div className="ssr-zone animate-fade-in">
            <div className="ssr-tile p-10 text-center text-recessive text-sm">
              Your signed agreements will appear here once onboarding is complete.
            </div>
          </div>
        ) : (
          <div className="ssr-zone animate-fade-in" style={{ animationDelay: "0.1s" }}>
            <div className="mb-6 flex items-center gap-3 border-b border-white/[0.07] pb-3">
              <div className="h-px w-6 bg-gold-muted" />
              <h2 className="text-label">Signed agreements</h2>
            </div>
            <div className="ssr-tile overflow-hidden">
              {freelancerDocuments.map((doc) => (
                <div key={doc.id} className="group flex items-center gap-5 px-6 py-4 border-b border-white/[0.05] last:border-0">
                  <button
                    onClick={() => handleFreelancerPreview(doc)}
                    disabled={!doc.pdf_url}
                    className="flex flex-1 min-w-0 items-center gap-5 text-left"
                  >
                    <FileText className="shrink-0 text-gold" style={{ width: 14, height: 14 }} strokeWidth={1.5} />
                    <div className="flex-1 min-w-0">
                      <p className="text-standard truncate transition-colors group-hover:text-gold" style={{ fontSize: 14 }}>
                        {doc.title || DOC_LABELS[doc.document_type] || doc.document_type}
                      </p>
                      <p className="font-sans uppercase text-white/40 mt-1" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
                        {doc.signed_at ? `Signed ${formatDate(doc.signed_at)}` : ""}
                      </p>
                    </div>
                  </button>
                  {doc.pdf_url && (
                    <div className="flex shrink-0 items-center gap-4" style={{ fontSize: 10, letterSpacing: "0.16em" }}>
                      <button
                        onClick={() => handleFreelancerPreview(doc)}
                        disabled={previewLoadingId === doc.id}
                        className="flex items-center gap-1.5 text-white/40 hover:text-gold transition-colors disabled:opacity-40"
                      >
                        {previewLoadingId === doc.id
                          ? <BrandLoader size="sm" className="h-3 w-3" />
                          : <Eye style={{ width: 12, height: 12 }} strokeWidth={1.5} />}
                        <span className="font-sans uppercase">Preview</span>
                      </button>
                      <button
                        onClick={() => handleFreelancerDownload(doc)}
                        disabled={downloadingId === doc.id}
                        className="flex items-center gap-1.5 text-white/40 hover:text-gold transition-colors disabled:opacity-40"
                      >
                        {downloadingId === doc.id
                          ? <BrandLoader size="sm" className="h-3 w-3" />
                          : <Download style={{ width: 12, height: 12 }} strokeWidth={1.5} />}
                        <span className="font-sans uppercase">Download</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {previewPdf && (
          <div
            className="fixed inset-0 z-[120] flex flex-col bg-black/85 backdrop-blur-sm animate-fade-in"
            onClick={() => setPreviewPdf(null)}
          >
            <div className="flex items-center justify-between gap-4 px-6 py-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-px w-6 bg-gold-muted" />
                <span className="truncate font-sans uppercase text-[#ecd39c]" style={{ fontSize: 11, letterSpacing: "0.16em" }}>{previewPdf.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-6">
                <a href={previewPdf.url} target="_blank" rel="noopener noreferrer" className="font-sans uppercase text-white/50 hover:text-gold transition-colors" style={{ fontSize: 10, letterSpacing: "0.16em" }}>Open in tab</a>
                <button onClick={() => setPreviewPdf(null)} className="text-white/50 hover:text-white transition-colors"><X className="h-5 w-5" strokeWidth={1.5} /></button>
              </div>
            </div>
            <div className="flex-1 px-4 pb-4 sm:px-10 sm:pb-10" onClick={(e) => e.stopPropagation()}>
              <iframe src={previewPdf.url} title={previewPdf.name} className="h-full w-full rounded-sm border border-white/10 bg-white shadow-2xl" />
            </div>
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
          Your agreement, quotations, and invoices
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
                        Silver Shadow Studio Client Agreement — {a.company_name}
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
                  // Drafts, expired, and withdrawn quotations are hidden
                  // from the client-facing list per the documents brief.
                  // They remain accessible by direct URL.
                  const display = quotationStatusDisplay(q.status);
                  if (!display) return null;
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
                        <p
                          className="font-serif text-foreground group-hover:text-gold transition-colors"
                          style={{ fontSize: 13, margin: 0, paddingLeft: 0 }}
                        >
                          {num}
                        </p>
                        <p
                          className="font-sans uppercase text-foreground/40 mt-1"
                          style={{ fontSize: 9, letterSpacing: "0.24em", margin: "4px 0 0 0", paddingLeft: 0 }}
                        >
                          {q.project_id && projectNames[q.project_id]
                            ? `${projectNames[q.project_id]} · ${formatDateShort(q.issued_at || q.created_at)}`
                            : formatDateShort(q.issued_at || q.created_at)}
                        </p>
                      </div>
                      {total != null && (
                        <p className="shrink-0 font-sans tabular-nums text-foreground/70" style={{ fontSize: 12 }}>
                          {formatCurrency(total, q.currency || "GBP")}
                        </p>
                      )}
                      <p
                        className={`shrink-0 font-sans uppercase ${display.tone === "action" ? "text-gold" : "text-foreground/40"}`}
                        style={{ fontSize: 9, letterSpacing: "0.24em" }}
                      >
                        {display.label}
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
                  const display = invoiceStatusDisplay(inv.status);
                  if (!display) return null;
                  const num = inv.invoice_number || inv.reference_number || "—";
                  const canPay = inv.status !== "paid";
                  const isPaying = payingInvoiceId === inv.id;
                  // Overdue is signalled by italic reference + italic date
                  // and a second eyebrow line "[N] DAYS OVERDUE" beside the
                  // status word. No new colour is introduced.
                  const overdueDays = inv.status === "sent" ? daysOverdue(inv.due_date) : 0;
                  const isOverdue = overdueDays > 0;
                  return (
                    <div key={inv.id} className="flex items-center gap-5 py-4 border-t border-border/30">
                      <button
                        type="button"
                        onClick={() => { setSelectedInvoice(toInvoiceViewerData(inv)); setInvoiceOpen(true); }}
                        className="group flex flex-1 items-center gap-5 min-w-0 text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2" style={{ paddingLeft: 0 }}>
                            <p
                              className="font-serif text-foreground group-hover:text-gold transition-colors"
                              style={{ fontSize: 13, margin: 0, paddingLeft: 0, fontStyle: isOverdue ? "italic" : "normal" }}
                            >
                              {num}
                            </p>
                            {inv.type !== "standalone" && (
                              <span className="font-sans uppercase text-foreground/35" style={{ fontSize: 8, letterSpacing: "0.16em" }}>
                                {inv.type === "deposit" ? "Deposit" : "Balance"}
                              </span>
                            )}
                          </div>
                          <p
                            className="font-sans uppercase text-foreground/40 mt-1"
                            style={{ fontSize: 9, letterSpacing: "0.24em", margin: "4px 0 0 0", paddingLeft: 0, fontStyle: isOverdue ? "italic" : "normal" }}
                          >
                            {(() => {
                              const dateStr = inv.due_date
                                ? `Due ${formatDateShort(inv.due_date)}`
                                : formatDateShort(inv.issued_at || inv.created_at);
                              const proj = inv.project_id ? projectNames[inv.project_id] : undefined;
                              return proj ? `${proj} · ${dateStr}` : dateStr;
                            })()}
                          </p>
                        </div>
                        <p className="shrink-0 font-sans tabular-nums text-foreground/70" style={{ fontSize: 12 }}>
                          {formatCurrency(inv.amount, inv.currency || "GBP")}
                        </p>
                        <div className="shrink-0 flex flex-col items-end" style={{ minWidth: 96 }}>
                          <p
                            className={`font-sans uppercase ${display.tone === "action" ? "text-gold" : "text-foreground/40"}`}
                            style={{ fontSize: 9, letterSpacing: "0.24em" }}
                          >
                            {display.label}
                          </p>
                          {isOverdue && (
                            <p
                              className="font-sans uppercase text-foreground/40"
                              style={{ fontSize: 9, letterSpacing: "0.24em", marginTop: 4 }}
                            >
                              {overdueDays} {overdueDays === 1 ? "Day" : "Days"} Overdue
                            </p>
                          )}
                        </div>
                      </button>
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

      <InvoiceViewer
        invoice={selectedInvoice}
        open={invoiceOpen}
        onOpenChange={(o) => {
          setInvoiceOpen(o);
          if (!o) setSelectedInvoice(null);
        }}
      />
    </ClientLayout>
  );
}
