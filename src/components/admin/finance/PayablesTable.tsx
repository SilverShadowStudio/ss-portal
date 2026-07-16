import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  APPROX_PERIOD_SOURCES,
  formatCurrency,
  formatDate,
  outstandingFor,
  PAYABLE_SOURCE_LABELS,
  payablePeriodDate,
  type Payable,
  type PayablePaidStatus,
} from "@/lib/finance";
import { useTableSort, type SortableColumn } from "@/hooks/useTableSort";
import { SortableTh } from "@/components/ui/SortableTh";

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

const COLUMNS: SortableColumn<Payable>[] = [
  { id: "payee", accessor: (r) => r.payee_name, type: "text" },
  { id: "source", accessor: (r) => PAYABLE_SOURCE_LABELS[r.source_table], type: "text" },
  { id: "period", accessor: (r) => payablePeriodDate(r), type: "date" },
  { id: "total", accessor: (r) => r.invoice_total, type: "number" },
  { id: "paid", accessor: (r) => r.amount_paid, type: "number" },
  { id: "outstanding", accessor: (r) => outstandingFor(r), type: "number" },
  { id: "status", accessor: (r) => r.paid_status, type: "text" },
];

export function PayablesTable({ rows, loading, onRowClick }: PayablesTableProps) {
  const { sortedRows, sortKey, sortDir, toggle } = useTableSort<Payable>(
    rows,
    COLUMNS,
    { key: "period", dir: "desc" },
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
    <div className="border border-divider rounded-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-divider">
            {th("payee", "Payee")}
            {th("source", "Source")}
            {th("period", "Period")}
            {th("total", "Total", "text-right")}
            {th("paid", "Paid", "text-right")}
            {th("outstanding", "Outstanding", "text-right")}
            {th("status", "Status")}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-recessive">
                Loading…
              </TableCell>
            </TableRow>
          ) : sortedRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-recessive">
                No payables synced yet.
              </TableCell>
            </TableRow>
          ) : (
            sortedRows.map((r) => {
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

