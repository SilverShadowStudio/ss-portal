import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  APPROX_PERIOD_SOURCES,
  formatCurrency,
  formatDate,
  outstandingFor,
  PAYABLE_SOURCE_LABELS,
  type Payable,
  type PayablePaidStatus,
} from "@/lib/finance";

interface PayablesTableProps {
  rows: Payable[];
  loading: boolean;
  onRowClick: (p: Payable) => void;
}

const STATUS_LABELS: Record<PayablePaidStatus, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  partial: "Partial",
  unknown: "Unknown",
};

const STATUS_CLASS: Record<PayablePaidStatus, string> = {
  paid: "text-xs text-gold",
  unpaid: "text-xs text-standard",
  partial: "text-xs text-gold-muted",
  unknown: "text-xs text-recessive",
};

export function PayablesTable({ rows, loading, onRowClick }: PayablesTableProps) {
  return (
    <div className="border border-divider rounded-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-divider">
            <Th>Payee</Th>
            <Th>Source</Th>
            <Th>Period</Th>
            <Th className="text-right">Total</Th>
            <Th className="text-right">Paid</Th>
            <Th className="text-right">Outstanding</Th>
            <Th>Status</Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-recessive">
                Loading…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-recessive">
                No payables synced yet.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => {
              const isApprox = APPROX_PERIOD_SOURCES.has(r.source_table);
              const periodText = r.period_date
                ? formatDate(r.period_date)
                : r.period_year && r.period_month
                  ? `${String(r.period_month).padStart(2, "0")}/${r.period_year}`
                  : "—";
              return (
                <TableRow
                  key={r.airtable_record_id}
                  onClick={() => onRowClick(r)}
                  className="cursor-pointer border-divider hover:bg-foreground/[0.03] transition-colors"
                >
                  <TableCell className="text-sm text-strong">
                    {r.payee_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-standard">
                    {PAYABLE_SOURCE_LABELS[r.source_table]}
                  </TableCell>
                  <TableCell className="text-sm text-standard">
                    {periodText}
                    {isApprox && r.period_date && (
                      <span className="ml-2 text-[9px] uppercase tracking-[0.28em] text-gold-muted">
                        ≈ created
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-standard text-right tabular-nums">
                    {formatCurrency(r.invoice_total)}
                  </TableCell>
                  <TableCell className="text-sm text-standard text-right tabular-nums">
                    {r.amount_paid != null ? formatCurrency(r.amount_paid) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-strong text-right tabular-nums">
                    {formatCurrency(outstandingFor(r))}
                  </TableCell>
                  <TableCell>
                    <span className={STATUS_CLASS[r.paid_status]}>
                      {STATUS_LABELS[r.paid_status]}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })
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
