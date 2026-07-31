import { useEffect, useMemo, useState } from "react";
import { Download, CreditCard, ChevronRight } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { ClientLayout } from "@/components/ClientLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  formatCurrency, formatDate, downloadInvoicePdfFromBackend, type InvoiceLineItem,
} from "@/lib/invoiceUtils";
import { InvoiceViewer, type InvoiceViewerData } from "@/components/invoices/InvoiceViewer";

interface ClientInvoiceRow {
  id: string;
  invoice_number: string | null;
  reference_number: string | null;
  amount: number;
  currency: string | null;
  status: string;
  due_date: string | null;
  issued_at: string | null;
  created_at: string;
  notes: string | null;
  line_items: any;
  account_id: string | null;
  account_company?: string | null;
  subtotal?: number | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
}

function statusConfig(status: string) {
  switch (status) {
    case "paid":
      return { label: "Paid", color: "hsl(142 71% 45%)" };
    case "sent":
      return { label: "Due", color: "hsl(var(--gold))" };
    case "overdue":
      return { label: "Overdue", color: "hsl(0 84% 60%)" };
    case "cancelled":
      return { label: "Cancelled", color: "hsl(var(--foreground) / 0.25)" };
    default:
      return { label: status, color: "hsl(var(--foreground) / 0.35)" };
  }
}

export default function Invoices() {
  const [rows, setRows] = useState<ClientInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [paying, setPaying] = useState<string | null>(null);
  const [viewing, setViewing] = useState<InvoiceViewerData | null>(null);
  const { toast } = useToast();

  async function fetchInvoices() {
    setLoading(true);
    const { data: invs, error } = await supabase
      .from("invoices")
      .select("*")
      .neq("status", "draft")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load invoices", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const accountIds = Array.from(new Set((invs || []).map((i: any) => i.account_id).filter(Boolean)));
    let accountsMap: Record<string, string> = {};
    if (accountIds.length) {
      const { data: accs } = await supabase.from("accounts").select("id, company_name").in("id", accountIds);
      accountsMap = Object.fromEntries((accs || []).map((a: any) => [a.id, a.company_name]));
    }
    setRows((invs || []).map((i: any) => ({ ...i, account_company: i.account_id ? accountsMap[i.account_id] : null })));
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      await fetchInvoices();
      const params = new URLSearchParams(window.location.search);
      const id = params.get("invoice");
      if (!id) return;
      const { data } = await supabase.from("invoices").select("*").eq("id", id).maybeSingle();
      if (data) viewInvoice(data as any);
    })();
  }, []);

  const filtered = useMemo(() => rows.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    return true;
  }), [rows, statusFilter]);

  function viewInvoice(r: ClientInvoiceRow) {
    const items: InvoiceLineItem[] = Array.isArray(r.line_items) ? r.line_items as any : [];
    setViewing({
      id: r.id,
      invoice_number: r.invoice_number,
      reference_number: r.reference_number,
      amount: Number(r.amount),
      currency: r.currency || "GBP",
      status: r.status,
      due_date: r.due_date,
      issued_at: r.issued_at,
      created_at: r.created_at,
      notes: r.notes,
      line_items: items,
      client_company: r.account_company,
      account_id: r.account_id,
      subtotal: r.subtotal != null ? Number(r.subtotal) : null,
      vat_rate: r.vat_rate != null ? Number(r.vat_rate) : null,
      vat_amount: r.vat_amount != null ? Number(r.vat_amount) : null,
    });
  }

  async function payNow(r: ClientInvoiceRow) {
    setPaying(r.id);
    try {
      const { data, error } = await supabase.functions.invoke("revolut-payment-link", {
        body: { invoice_id: r.id },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        toast({ title: "Online payments coming soon", description: "Please contact us to settle this invoice." });
      }
    } catch (e: any) {
      toast({ title: "Could not start payment", description: e?.message, variant: "destructive" });
    } finally {
      setPaying(null);
    }
  }

  return (
    <ClientLayout>
      {/* Header */}
      <div className="mb-16 animate-fade-in">
        <h1
          className="font-serif font-normal text-foreground"
          style={{ fontSize: "2.6rem", letterSpacing: "-0.005em" }}
        >
          Invoices
        </h1>
        <p className="mt-3 font-sans uppercase text-foreground/45" style={{ fontSize: 10, letterSpacing: "0.22em" }}>
          Financial records and payments
        </p>
      </div>

      {/* Filter */}
      <div className="mb-10 flex items-center gap-6 animate-fade-in" style={{ animationDelay: "0.05s" }}>
        {["all", "sent", "overdue", "paid", "cancelled"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className="font-sans uppercase transition-colors"
            style={{
              fontSize: 9,
              letterSpacing: "0.22em",
              color: statusFilter === s
                ? "hsl(var(--foreground))"
                : "hsl(var(--foreground) / 0.35)",
              borderBottom: statusFilter === s ? "1px solid hsl(var(--gold))" : "1px solid transparent",
              paddingBottom: 4,
            }}
          >
            {s === "all" ? "All" : s === "sent" ? "Due" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <BrandLoader size="md" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-24 text-center">
          <p className="font-serif text-base text-foreground/40">No invoices.</p>
        </div>
      ) : (
        <div className="space-y-1 animate-fade-in" style={{ animationDelay: "0.1s" }}>
          {filtered.map((r) => {
            const sc = statusConfig(r.status);
            const canPay = r.status === "sent" || r.status === "overdue";
            return (
              <div
                key={r.id}
                className="group flex items-center gap-5 py-4 border-t border-border/30 cursor-pointer hover:border-border/60 transition-all"
                onClick={() => viewInvoice(r)}
              >
                {/* Status dot */}
                <span
                  className="shrink-0 rounded-full"
                  style={{ width: 7, height: 7, display: "inline-block", background: sc.color }}
                />

                {/* Reference + date */}
                <div className="flex-1 min-w-0">
                  <p
                    className="font-serif text-foreground truncate group-hover:text-gold transition-colors"
                    style={{ fontSize: 14 }}
                  >
                    {r.invoice_number || r.reference_number || "Invoice"}
                  </p>
                  <p
                    className="font-sans uppercase text-foreground/40 mt-0.5"
                    style={{ fontSize: 9, letterSpacing: "0.16em" }}
                  >
                    <span style={{ color: sc.color }}>{sc.label}</span>
                    <span className="mx-2 opacity-40">·</span>
                    {r.due_date ? `Due ${formatDate(r.due_date)}` : formatDate(r.issued_at || r.created_at)}
                  </p>
                </div>

                {/* Amount */}
                <p
                  className="shrink-0 font-sans tabular-nums text-foreground"
                  style={{ fontSize: 14 }}
                >
                  {formatCurrency(Number(r.amount), r.currency || "GBP")}
                </p>

                {/* Actions */}
                <div
                  className="shrink-0 flex items-center gap-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  {canPay && (
                    <button
                      onClick={() => payNow(r)}
                      disabled={paying === r.id}
                      className="flex items-center gap-1.5 font-sans uppercase text-foreground bg-foreground/8 hover:bg-foreground/15 transition-colors px-3 py-1.5 disabled:opacity-40"
                      style={{ fontSize: 9, letterSpacing: "0.2em" }}
                    >
                      {paying === r.id ? (
                        <BrandLoader size="sm" className="h-2.5 w-2.5" />
                      ) : (
                        <CreditCard style={{ width: 10, height: 10 }} strokeWidth={1.5} />
                      )}
                      Pay
                    </button>
                  )}
                  <ChevronRight
                    className="text-foreground/20 group-hover:text-foreground/50 transition-colors"
                    style={{ width: 13, height: 13 }}
                    strokeWidth={1.5}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <InvoiceViewer
        invoice={viewing}
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
        showPay
        paying={paying === viewing?.id}
        onPay={(inv) => payNow({ ...(viewing as any), ...inv } as any)}
      />
    </ClientLayout>
  );
}
