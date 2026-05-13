import { useEffect, useMemo, useState } from "react";
import { Plus, Search, MoreHorizontal, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { QuotationFormDialog } from "@/components/admin/QuotationFormDialog";
import { QuotationViewer, type QuotationViewerData } from "@/components/quotations/QuotationViewer";
import { formatCurrency, formatDate } from "@/lib/invoiceUtils";

const STATUSES = ["draft", "sent", "signed", "declined", "cancelled"] as const;

function statusLabel(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function statusClasses(s: string) {
  switch (s) {
    case "signed": return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "sent": return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
    case "declined": return "bg-rose-500/15 text-rose-600 dark:text-rose-400";
    case "cancelled": return "bg-muted text-muted-foreground line-through";
    default: return "bg-muted text-muted-foreground";
  }
}

interface Row {
  id: string;
  quotation_number: string;
  reference_number: string | null;
  amount: number;
  currency: string | null;
  status: string;
  issued_at: string | null;
  created_at: string;
  notes: string | null;
  line_items: any;
  account_id: string | null;
  project_id: string | null;
  user_id: string;
  project_name: string | null;
  subtotal: number | null;
  vat_rate: number | null;
  vat_amount: number | null;
  account_company?: string | null;
}

export function QuotationsTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewing, setViewing] = useState<QuotationViewerData | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const { toast } = useToast();

  async function fetchRows() {
    setLoading(true);
    const { data, error } = await supabase
      .from("quotation_documents")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load quotations", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const accountIds = Array.from(new Set((data || []).map((i: any) => i.account_id).filter(Boolean)));
    let map: Record<string, string> = {};
    if (accountIds.length) {
      const { data: accs } = await supabase
        .from("accounts")
        .select("id, company_name")
        .in("id", accountIds);
      map = Object.fromEntries((accs || []).map((a: any) => [a.id, a.company_name]));
    }
    setRows((data || []).map((i: any) => ({ ...i, account_company: i.account_id ? map[i.account_id] : null })));
    setLoading(false);
  }

  useEffect(() => { fetchRows(); }, []);

  const filtered = useMemo(() => rows.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const m = (r.quotation_number || r.reference_number || "").toLowerCase().includes(q);
      const c = (r.account_company || "").toLowerCase().includes(q);
      if (!m && !c) return false;
    }
    return true;
  }), [rows, statusFilter, search]);

  async function deleteQuotation(id: string) {
    const { error } = await supabase.from("quotation_documents").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Quotation deleted" });
      setConfirmingDeleteId(null);
      setOpenMenuId(null);
      fetchRows();
    }
  }

  async function updateStatus(id: string, status: string) {
    const patch: any = { status };
    if (status === "sent") patch.sent_at = new Date().toISOString();
    if (status === "signed") patch.signed_at = new Date().toISOString();
    const { error } = await supabase.from("quotation_documents").update(patch).eq("id", id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
    else fetchRows();
  }

  function view(r: Row) {
    setViewing({
      id: r.id,
      quotation_number: r.quotation_number,
      reference_number: r.reference_number,
      amount: Number(r.amount),
      currency: r.currency,
      issued_at: r.issued_at,
      created_at: r.created_at,
      notes: r.notes,
      line_items: Array.isArray(r.line_items) ? r.line_items : [],
      project_name: r.project_name,
      account_id: r.account_id,
      project_id: r.project_id,
      subtotal: r.subtotal,
      vat_rate: r.vat_rate,
      vat_amount: r.vat_amount,
      client_company: r.account_company,
    });
  }

  return (
    <>
      <div className="mb-6 flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New quotation
        </Button>
      </div>

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

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quotation #</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No quotations yet.</TableCell></TableRow>
            ) : filtered.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => view(r)}>
                <TableCell className="font-medium">{r.quotation_number}</TableCell>
                <TableCell>{r.account_company || "—"}</TableCell>
                <TableCell>{r.project_name || "—"}</TableCell>
                <TableCell>{formatDate(r.issued_at || r.created_at)}</TableCell>
                <TableCell>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Select value={r.status} onValueChange={(v) => updateStatus(r.id, v)}>
                      <SelectTrigger className={`h-7 w-auto min-w-[110px] gap-1 rounded-full border-0 px-2.5 py-0.5 text-xs font-medium focus:ring-0 focus:ring-offset-0 ${statusClasses(r.status)}`}>
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
                <TableCell className="text-right tabular-nums">{formatCurrency(Number(r.amount), r.currency || "GBP")}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu
                    open={openMenuId === r.id}
                    onOpenChange={(o) => {
                      if (o) { setOpenMenuId(r.id); }
                      else { setOpenMenuId(null); setConfirmingDeleteId(null); }
                    }}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {confirmingDeleteId === r.id ? (
                        <div className="px-3 py-2 w-[210px] space-y-3">
                          <p className="text-sm leading-snug text-muted-foreground">Delete this quotation? This cannot be undone.</p>
                          <div className="flex flex-col gap-1">
                            <button
                              className="text-sm font-medium text-rose-500 hover:text-rose-600 text-left"
                              onClick={() => deleteQuotation(r.id)}
                            >
                              Confirm delete
                            </button>
                            <button
                              className="text-sm text-muted-foreground hover:text-foreground text-left"
                              onClick={() => { setConfirmingDeleteId(null); setOpenMenuId(null); }}
                            >
                              Keep it
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <DropdownMenuItem onClick={() => view(r)}>
                            <Eye className="mr-2 h-4 w-4" /> View quotation
                          </DropdownMenuItem>
                          {r.status !== "sent" && <DropdownMenuItem onClick={() => updateStatus(r.id, "sent")}>Mark as sent</DropdownMenuItem>}
                          {r.status !== "signed" && <DropdownMenuItem onClick={() => updateStatus(r.id, "signed")}>Mark as signed</DropdownMenuItem>}
                          {r.status !== "declined" && <DropdownMenuItem onClick={() => updateStatus(r.id, "declined")}>Mark as declined</DropdownMenuItem>}
                          {r.status !== "cancelled" && <DropdownMenuItem onClick={() => updateStatus(r.id, "cancelled")}>Cancel</DropdownMenuItem>}
                          {r.status === "draft" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-rose-500 focus:text-rose-500 focus:bg-rose-500/10"
                                onSelect={(e) => { e.preventDefault(); setConfirmingDeleteId(r.id); }}
                              >
                                Delete quotation
                              </DropdownMenuItem>
                            </>
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <QuotationFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={fetchRows} />
      <QuotationViewer
        quotation={viewing}
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
      />
    </>
  );
}