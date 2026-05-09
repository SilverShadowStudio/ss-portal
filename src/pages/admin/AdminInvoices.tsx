import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Download, MoreHorizontal, Eye, Loader2 } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InvoiceGenerator } from "@/components/admin/invoice-generator/InvoiceGenerator";
import { QuotationsTab } from "@/components/admin/QuotationsTab";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { InvoiceFormDialog } from "@/components/admin/InvoiceFormDialog";
import { InvoiceViewer, type InvoiceViewerData } from "@/components/invoices/InvoiceViewer";
import {
  formatCurrency, formatDate, statusBadgeClasses, statusLabel,
  downloadInvoicePdfFromBackend, type InvoiceLineItem,
} from "@/lib/invoiceUtils";

interface InvoiceRow {
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
  project_id: string | null;
  user_id: string;
  account_company?: string | null;
  subtotal?: number | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
}

const STATUSES = ["draft", "sent", "paid", "overdue", "cancelled"] as const;

export default function AdminInvoices() {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<InvoiceViewerData | null>(null);
  const { toast } = useToast();

  async function fetchInvoices() {
    setLoading(true);
    const { data: invs, error } = await supabase
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load invoices", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const accountIds = Array.from(new Set((invs || []).map((i: any) => i.account_id).filter(Boolean)));
    let accountsMap: Record<string, string> = {};
    if (accountIds.length) {
      const { data: accs } = await supabase
        .from("accounts")
        .select("id, company_name")
        .in("id", accountIds);
      accountsMap = Object.fromEntries((accs || []).map((a: any) => [a.id, a.company_name]));
    }
    setRows((invs || []).map((i: any) => ({ ...i, account_company: i.account_id ? accountsMap[i.account_id] : null })));
    setLoading(false);
  }

  useEffect(() => { fetchInvoices(); }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchNum = (r.invoice_number || r.reference_number || "").toLowerCase().includes(q);
        const matchCo = (r.account_company || "").toLowerCase().includes(q);
        if (!matchNum && !matchCo) return false;
      }
      return true;
    });
  }, [rows, statusFilter, search]);

  const totals = useMemo(() => {
    const sum = (st: string) =>
      rows.filter((r) => r.status === st).reduce((s, r) => s + Number(r.amount || 0), 0);
    return {
      paid: sum("paid"),
      sent: sum("sent"),
      overdue: sum("overdue"),
      draft: sum("draft"),
    };
  }, [rows]);

  async function updateStatus(id: string, status: string) {
    const patch: any = { status };
    if (status === "paid") patch.paid_at = new Date().toISOString();
    if (status === "sent") patch.sent_at = new Date().toISOString();
    const { error } = await supabase.from("invoices").update(patch).eq("id", id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
    else fetchInvoices();
  }

  async function downloadPdf(r: InvoiceRow) {
    setDownloadingId(r.id);
    try {
      const { fileName } = await downloadInvoicePdfFromBackend(r.id);
      toast({
        title: "Invoice PDF opened",
        description: fileName || "The download opened in a new tab.",
      });
    } catch (e: any) {
      toast({
        title: "Could not generate PDF",
        description: e?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  }

  function viewInvoice(r: InvoiceRow) {
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

  return (
    <AdminLayout>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage invoices and payment status.</p>
        </div>
      </div>

      <Tabs defaultValue="invoices" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="quotations">Quotations</TabsTrigger>
          <TabsTrigger value="generator">Generator</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <div className="mb-6 flex justify-end">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New invoice
            </Button>
          </div>

      {/* Stat strip */}
      <div className="mb-8 grid grid-cols-2 gap-6 md:grid-cols-4">
        {[
          { label: "Paid", value: totals.paid, tone: "text-emerald-500" },
          { label: "Sent", value: totals.sent, tone: "text-blue-500" },
          { label: "Overdue", value: totals.overdue, tone: "text-rose-500" },
          { label: "Draft", value: totals.draft, tone: "text-muted-foreground" },
        ].map((s) => (
          <div key={s.label}>
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{s.label}</p>
            <p className={`mt-2 text-2xl font-semibold ${s.tone}`}>{formatCurrency(s.value, "GBP")}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by number or client"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No invoices yet.</TableCell></TableRow>
            ) : (
              filtered.map((r) => {
                const downloading = downloadingId === r.id;
                return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => viewInvoice(r)}>
                  <TableCell className="font-medium">{r.invoice_number || r.reference_number || "—"}</TableCell>
                  <TableCell>{r.account_company || "—"}</TableCell>
                  <TableCell>{formatDate(r.issued_at || r.created_at)}</TableCell>
                  <TableCell>{formatDate(r.due_date)}</TableCell>
                  <TableCell>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Select value={r.status} onValueChange={(v) => updateStatus(r.id, v)}>
                        <SelectTrigger
                          className={`h-7 w-auto min-w-[110px] gap-1 rounded-full border-0 px-2.5 py-0.5 text-xs font-medium focus:ring-0 focus:ring-offset-0 ${statusBadgeClasses(r.status)}`}
                        >
                          <SelectValue>{statusLabel(r.status)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(Number(r.amount), r.currency || "EUR")}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => viewInvoice(r)}>
                          <Eye className="mr-2 h-4 w-4" /> View invoice
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => !downloading && downloadPdf(r)} disabled={downloading}>
                          {downloading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="mr-2 h-4 w-4" />
                          )}
                          {downloading ? "Preparing PDF…" : "Download PDF"}
                        </DropdownMenuItem>
                        {r.status !== "sent" && (
                          <DropdownMenuItem onClick={() => updateStatus(r.id, "sent")}>Mark as sent</DropdownMenuItem>
                        )}
                        {r.status !== "paid" && (
                          <DropdownMenuItem onClick={() => updateStatus(r.id, "paid")}>Mark as paid</DropdownMenuItem>
                        )}
                        {r.status !== "overdue" && (
                          <DropdownMenuItem onClick={() => updateStatus(r.id, "overdue")}>Mark as overdue</DropdownMenuItem>
                        )}
                        {r.status !== "cancelled" && (
                          <DropdownMenuItem onClick={() => updateStatus(r.id, "cancelled")}>Cancel</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )})
            )}
          </TableBody>
        </Table>
      </div>

      <InvoiceFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={fetchInvoices} />
      <InvoiceViewer
        invoice={viewing}
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
      />
        </TabsContent>

        <TabsContent value="generator">
          <InvoiceGenerator />
        </TabsContent>

        <TabsContent value="quotations">
          <QuotationsTab />
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
