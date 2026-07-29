import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate, type MoneyInInvoice } from "@/lib/finance";
import { useTableSort, type SortableColumn } from "@/hooks/useTableSort";
import { SortableTh } from "@/components/ui/SortableTh";
import { CurrencyAmount } from "@/components/finance/CurrencyAmount";

interface MoneyInTableProps {
  rows: MoneyInInvoice[];
  loading: boolean;
  onRowClick: (i: MoneyInInvoice) => void;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
  pending: "Pending",
  cancelled: "Cancelled",
};

const TYPE_LABELS: Record<string, string> = {
  deposit: "Deposit",
  balance: "Balance",
  standalone: "Standalone",
  external: "External",
};

// For portal invoices the stage is `type`; for external ones it's `invoice_kind`.
function typeDisplay(r: MoneyInInvoice): string {
  if (r.type && r.type !== "external") return TYPE_LABELS[r.type] ?? r.type;
  if (r.invoice_kind) return TYPE_LABELS[r.invoice_kind] ?? r.invoice_kind;
  return r.type ? TYPE_LABELS[r.type] ?? r.type : "—";
}

const COLUMNS: SortableColumn<MoneyInInvoice>[] = [
  { id: "client", accessor: (r) => r.account_company ?? "", type: "text" },
  { id: "number", accessor: (r) => r.invoice_number ?? r.reference_number ?? "", type: "text" },
  { id: "type", accessor: (r) => typeDisplay(r), type: "text" },
  { id: "net", accessor: (r) => r.subtotal, type: "number" },
  { id: "vat", accessor: (r) => r.vat_amount, type: "number" },
  { id: "gross", accessor: (r) => r.amount, type: "number" },
  { id: "status", accessor: (r) => r.status, type: "text" },
  { id: "paid", accessor: (r) => r.paid_at, type: "date" },
  { id: "due", accessor: (r) => r.due_date, type: "date" },
];

export function MoneyInTable({ rows, loading, onRowClick }: MoneyInTableProps) {
  const { sortedRows, sortKey, sortDir, toggle } = useTableSort<MoneyInInvoice>(
    rows,
    COLUMNS,
    { key: "paid", dir: "desc" },
  );

  const th = (id: string, label: string, className?: string) => (
    <SortableTh
      id={id}
      label={label}
      className={className}
      activeKey={sortKey}
      dir={sortDir}
      onClick={toggle}
    />
  );

  return (
    <div className="ssr-tile overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-divider">
            {th("client", "Client")}
            {th("number", "Invoice #")}
            {th("type", "Type")}
            {th("net", "Net", "text-right")}
            {th("vat", "VAT", "text-right")}
            {th("gross", "Gross", "text-right")}
            {th("status", "Status")}
            {th("paid", "Paid")}
            {th("due", "Due")}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-12 text-recessive">
                Loading…
              </TableCell>
            </TableRow>
          ) : sortedRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-12 text-recessive">
                No invoices in this view.
              </TableCell>
            </TableRow>
          ) : (
            sortedRows.map((r) => (
              <TableRow
                key={r.id}
                onClick={() => onRowClick(r)}
                className="cursor-pointer border-divider hover:bg-foreground/[0.03] transition-colors"
              >
                <TableCell className="text-sm text-strong">
                  {r.account_company ?? "—"}
                  {!r.dropbox_path && r.status !== "draft" && r.status !== "cancelled" && (
                    <span
                      className="ml-2 text-[9px] uppercase tracking-[0.28em] text-[#c98a6a]"
                      title="No invoice PDF filed to Dropbox yet"
                    >
                      Not filed
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-standard">
                  {r.invoice_number ?? r.reference_number ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-standard">
                  {typeDisplay(r)}
                </TableCell>
                <TableCell className="text-sm text-standard text-right">
                  {r.subtotal != null ? <CurrencyAmount amount={r.subtotal} currency={r.currency ?? "GBP"} rateDate={r.status === "paid" ? r.paid_at : null} /> : "—"}
                </TableCell>
                <TableCell className="text-sm text-standard text-right">
                  {r.vat_amount != null ? <CurrencyAmount amount={r.vat_amount} currency={r.currency ?? "GBP"} rateDate={r.status === "paid" ? r.paid_at : null} /> : "—"}
                </TableCell>
                <TableCell className="text-sm text-strong text-right">
                  <CurrencyAmount amount={Number(r.amount ?? 0)} currency={r.currency ?? "GBP"} rateDate={r.status === "paid" ? r.paid_at : null} />
                </TableCell>
                <TableCell>
                  <span
                    className={
                      r.status === "paid"
                        ? "text-xs text-gold"
                        : r.status === "overdue"
                          ? "text-xs text-strong"
                          : "text-xs text-standard"
                    }
                  >
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-recessive">{formatDate(r.paid_at)}</TableCell>
                <TableCell className="text-sm text-recessive">{formatDate(r.due_date)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
