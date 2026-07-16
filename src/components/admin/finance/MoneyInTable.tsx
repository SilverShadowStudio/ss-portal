import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate, type MoneyInInvoice } from "@/lib/finance";

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

export function MoneyInTable({ rows, loading, onRowClick }: MoneyInTableProps) {
  return (
    <div className="border border-divider rounded-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-divider">
            <Th>Client</Th>
            <Th>Invoice #</Th>
            <Th>Type</Th>
            <Th className="text-right">Net</Th>
            <Th className="text-right">VAT</Th>
            <Th className="text-right">Gross</Th>
            <Th>Status</Th>
            <Th>Paid</Th>
            <Th>Due</Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-12 text-recessive">
                Loading…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-12 text-recessive">
                No invoices in this view.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow
                key={r.id}
                onClick={() => onRowClick(r)}
                className="cursor-pointer border-divider hover:bg-foreground/[0.03] transition-colors"
              >
                <TableCell className="text-sm text-strong">{r.account_company ?? "—"}</TableCell>
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

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <TableHead
      className={
        "text-[9px] uppercase tracking-[0.28em] text-foreground/40 font-normal " +
        (className ?? "")
      }
    >
      {children}
    </TableHead>
  );
}
