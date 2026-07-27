import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate, type MoneyInInvoice } from "@/lib/finance";
import { useTableSort, type SortableColumn } from "@/hooks/useTableSort";
import { SortableTh } from "@/components/ui/SortableTh";

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
};

const COLUMNS: SortableColumn<MoneyInInvoice>[] = [
  { id: "client", accessor: (r) => r.account_company ?? "", type: "text" },
  { id: "number", accessor: (r) => r.invoice_number ?? r.reference_number ?? "", type: "text" },
  { id: "type", accessor: (r) => (r.type ? TYPE_LABELS[r.type] ?? r.type : ""), type: "text" },
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
                  {r.type ? TYPE_LABELS[r.type] ?? r.type : "—"}
                </TableCell>
                <TableCell className="text-sm text-standard text-right tabular-nums">
                  {r.subtotal != null ? formatCurrency(r.subtotal, r.currency ?? "GBP") : "—"}
                </TableCell>
                <TableCell className="text-sm text-standard text-right tabular-nums">
                  {r.vat_amount != null ? formatCurrency(r.vat_amount, r.currency ?? "GBP") : "—"}
                </TableCell>
                <TableCell className="text-sm text-strong text-right tabular-nums">
                  {formatCurrency(Number(r.amount ?? 0), r.currency ?? "GBP")}
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
