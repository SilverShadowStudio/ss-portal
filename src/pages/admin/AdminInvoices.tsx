import { useEffect, useMemo, useState } from "react";

interface AccountForGenerator {
  id: string;
  company_name: string | null;
  building_number: string | null;
  street_name: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
  registration_number: string | null;
  contact_name: string | null;
}

interface BankAccount {
  id: string;
  label: string;
  bankName: string;
  sortCode: string;
  accountNumber: string;
  swift: string;
  iban: string;
}

const BANK_ACCOUNTS: BankAccount[] = [
  {
    id: "revolut",
    label: "Revolut",
    bankName: "REVOLUT",
    sortCode: "04 - 00 - 75",
    accountNumber: "75 91 35 42",
    swift: "REVO GB21",
    iban: "GB91 REVO 0099 6974 0692 71",
  },
];
import { Plus, Search, Download, MoreHorizontal, Eye, CreditCard, Copy, Trash2, FolderUp } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { InvoiceFormDialog } from "@/components/admin/InvoiceFormDialog";
import { InvoiceViewer, type InvoiceViewerData } from "@/components/invoices/InvoiceViewer";
import {
  formatCurrency, formatDate, statusBadgeClasses, statusLabel,
  downloadInvoicePdfFromBackend, fileInvoiceToDropbox, type InvoiceLineItem,
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
  stripe_checkout_url?: string | null;
}

const STATUSES = ["draft", "sent", "paid", "overdue", "cancelled"] as const;

export default function AdminInvoices() {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [filingId, setFilingId] = useState<string | null>(null);
  const [creatingLinkId, setCreatingLinkId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<InvoiceViewerData | null>(null);
  const [genAccounts, setGenAccounts] = useState<AccountForGenerator[]>([]);
  const [genAccountId, setGenAccountId] = useState<string>("");
  const [genBankId, setGenBankId] = useState<string>(BANK_ACCOUNTS[0].id);
  const [genDesign, setGenDesign] = useState<"2027" | "classic">("2027");
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

  useEffect(() => {
    async function fetchGenAccounts() {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, company_name, building_number, street_name, postcode, city, country, registration_number, profiles(first_name, last_name)")
        .in("account_type", ["partnership", "project"])
        .order("company_name");
      if (error || !data) {
        console.error("[AdminInvoices] fetchGenAccounts failed:", error);
        return;
      }
      setGenAccounts(
        (data as any[]).map((a) => {
          const profile = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
          const contact_name = profile
            ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || null
            : null;
          return {
            id: a.id,
            company_name: a.company_name,
            building_number: a.building_number,
            street_name: a.street_name,
            postcode: a.postcode,
            city: a.city,
            country: a.country,
            registration_number: a.registration_number,
            contact_name,
          };
        })
      );
    }
    fetchGenAccounts();
  }, []);

  const generatorSrc = useMemo(() => {
    const params = new URLSearchParams();
    params.set("design", genDesign);
    const acc = genAccounts.find((a) => a.id === genAccountId);
    if (acc) {
      if (acc.company_name) params.set("client", acc.company_name);
      const addressParts = [acc.building_number, acc.street_name, acc.postcode, acc.city, acc.country].filter(Boolean);
      if (addressParts.length) params.set("address", addressParts.join(", "));
      if (acc.contact_name) params.set("contact", acc.contact_name);
      if (acc.registration_number) params.set("registration", acc.registration_number);
    }
    const bank = BANK_ACCOUNTS.find((b) => b.id === genBankId) ?? BANK_ACCOUNTS[0];
    params.set("bank", bank.bankName);
    params.set("sortCode", bank.sortCode);
    params.set("accountNumber", bank.accountNumber);
    params.set("swift", bank.swift);
    params.set("iban", bank.iban);
    return `/generator/index.html?${params.toString()}`;
  }, [genAccountId, genAccounts, genBankId, genDesign]);

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

  async function fileToDropbox(r: InvoiceRow) {
    setFilingId(r.id);
    try {
      const path = await fileInvoiceToDropbox(r.id);
      toast({ title: "Filed to Dropbox", description: path });
    } catch (e: any) {
      toast({ title: "Could not file to Dropbox", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setFilingId(null);
    }
  }

  async function createPaymentLink(id: string) {
    setCreatingLinkId(id);
    try {
      const { data, error } = await supabase.functions.invoke("create-invoice-checkout", {
        body: { invoice_id: id },
      });
      if (error) throw error;
      if (data?.pending) {
        toast({ title: "Stripe not configured", description: data.message, variant: "destructive" });
        return;
      }
      if (!data?.url) throw new Error("No URL returned from checkout function");
      const { error: updateError } = await supabase
        .from("invoices")
        .update({ stripe_checkout_url: data.url })
        .eq("id", id);
      if (updateError) throw updateError;
      await navigator.clipboard.writeText(data.url).catch(() => {});
      toast({ title: "Payment link created", description: "Link copied to clipboard" });
      fetchInvoices();
    } catch (e: any) {
      toast({ title: "Failed to create payment link", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setCreatingLinkId(null);
    }
  }

  async function deleteInvoice(id: string) {
    if (!window.confirm("Delete this invoice? This cannot be undone.")) return;
    const { error } = await supabase.from("invoices").delete().eq("id", id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Invoice deleted" }); fetchInvoices(); }
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
          <h1 className="text-2xl font-semibold tracking-tight">Invoices to Clients</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage invoices and payment status.</p>
        </div>
      </div>

      <Tabs defaultValue="invoices" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
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
              <TableHead className="w-[180px]" />
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
                const filing = filingId === r.id;
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
                    <div className="flex items-center justify-end gap-1">
                      {r.stripe_checkout_url ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          title="Copy payment link"
                          onClick={() => {
                            navigator.clipboard.writeText(r.stripe_checkout_url!);
                            toast({ title: "Payment link copied" });
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-muted-foreground hover:text-foreground"
                          disabled={creatingLinkId === r.id}
                          onClick={() => createPaymentLink(r.id)}
                        >
                          {creatingLinkId === r.id ? (
                            <BrandLoader size="sm" className="mr-1.5 h-3.5 w-3.5" />
                          ) : (
                            <CreditCard className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          {creatingLinkId === r.id ? "Creating…" : "Payment link"}
                        </Button>
                      )}
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
                              <BrandLoader size="sm" className="mr-2 h-4 w-4" />
                            ) : (
                              <Download className="mr-2 h-4 w-4" />
                            )}
                            {downloading ? "Preparing PDF…" : "Download PDF"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => !filing && fileToDropbox(r)} disabled={filing}>
                            {filing ? (
                              <BrandLoader size="sm" className="mr-2 h-4 w-4" />
                            ) : (
                              <FolderUp className="mr-2 h-4 w-4" />
                            )}
                            {filing ? "Filing…" : "File to Dropbox"}
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
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => deleteInvoice(r.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
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
          <div className="mb-4 flex items-center gap-4">
            <Select value={genAccountId} onValueChange={setGenAccountId}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Select a client…" />
              </SelectTrigger>
              <SelectContent>
                {genAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.company_name || a.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={genBankId} onValueChange={setGenBankId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select a bank…" />
              </SelectTrigger>
              <SelectContent>
                {BANK_ACCOUNTS.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center">
              <Button
                type="button"
                variant={genDesign === "2027" ? "default" : "outline"}
                size="sm"
                className="rounded-none"
                onClick={() => setGenDesign("2027")}
              >
                2027
              </Button>
              <Button
                type="button"
                variant={genDesign === "classic" ? "default" : "outline"}
                size="sm"
                className="rounded-none border-l-0"
                onClick={() => setGenDesign("classic")}
              >
                Classic
              </Button>
            </div>
          </div>
          <iframe key={generatorSrc} src={generatorSrc} width="100%" style={{ height: "calc(100vh - 180px)", border: "none" }} />
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
