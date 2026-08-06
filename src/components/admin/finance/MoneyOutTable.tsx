import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCurrency,
  formatDate,
  type MoneyOutRow,
  type PayablePaidStatus,
} from "@/lib/finance";
import { useTableSort, type SortableColumn } from "@/hooks/useTableSort";
import { SortableTh } from "@/components/ui/SortableTh";
import { CurrencyAmount } from "@/components/finance/CurrencyAmount";
import { MissingDocChip } from "./MissingDocChip";
import { differenceInCalendarDays } from "date-fns";

type Urgency = "overdue" | "due-soon" | null;

// Only fixed (overhead) rows carry a due date, so urgency is fixed-only.
function computeUrgency(dueDate: string | null, status: PayablePaidStatus): Urgency {
  if (status === "paid" || !dueDate) return null;
  const days = differenceInCalendarDays(new Date(`${dueDate}T00:00:00`), new Date());
  if (days < 0) return "overdue";
  if (days <= 7) return "due-soon";
  return null;
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

const COLUMNS: SortableColumn<MoneyOutRow>[] = [
  { id: "name", accessor: (r) => r.name, type: "text" },
  { id: "kind", accessor: (r) => r.kind, type: "text" },
  { id: "detail", accessor: (r) => r.detail ?? "", type: "text" },
  { id: "date", accessor: (r) => r.date, type: "date" },
  { id: "net", accessor: (r) => r.net ?? -1, type: "number" },
  { id: "vat", accessor: (r) => r.vat ?? -1, type: "number" },
  { id: "amount", accessor: (r) => r.amount, type: "number" },
  { id: "status", accessor: (r) => r.status, type: "text" },
];

interface MoneyOutTableProps {
  rows: MoneyOutRow[];
  loading: boolean;
  onRowClick: (r: MoneyOutRow) => void;
  onAttachInvoice?: (r: MoneyOutRow) => void;
  /** Drop/click a payslip PDF straight onto a salary row's "Payslip missing" chip. */
  onAttachPayslipFile?: (r: MoneyOutRow, file: File) => void | Promise<void>;
  /** Drop/click an invoice PDF straight onto an overhead row's "Invoice missing" chip. */
  onAttachInvoiceFile?: (r: MoneyOutRow, file: File) => void | Promise<void>;
  /** Settle an unpaid overhead by transferring from Revolut. Fixed rows only —
   *  freelancer payables are paid through Airtable, not from here. */
  onPay?: (r: MoneyOutRow) => void;
}

export function MoneyOutTable({ rows, loading, onRowClick, onAttachInvoice, onAttachPayslipFile, onAttachInvoiceFile, onPay }: MoneyOutTableProps) {
  const { sortedRows, sortKey, sortDir, toggle } = useTableSort<MoneyOutRow>(
    rows,
    COLUMNS,
    { key: "date", dir: "desc" },
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
            {th("name", "Name")}
            {th("kind", "Type")}
            {th("detail", "Category / Source")}
            {th("date", "Date")}
            {th("net", "Net", "text-right")}
            {th("vat", "VAT", "text-right")}
            {th("amount", "Amount", "text-right")}
            {th("status", "Status")}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-12 text-recessive">
                Loading…
              </TableCell>
            </TableRow>
          ) : sortedRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-12 text-recessive">
                Nothing here yet.
              </TableCell>
            </TableRow>
          ) : (
            sortedRows.map((r) => {
              const urgency = computeUrgency(r.dueDate, r.status);
              const rowClass =
                urgency === "overdue"
                  ? "cursor-pointer border-divider border-l-2 border-l-gold bg-gold/[0.12] hover:bg-gold/[0.16] transition-colors"
                  : "cursor-pointer border-divider hover:bg-foreground/[0.03] transition-colors";
              return (
                <TableRow key={r.key} onClick={() => onRowClick(r)} className={rowClass}>
                  <TableCell className="text-sm text-strong">
                    {r.name}
                    {r.isReverseCharge && (
                      <span className="ml-2 text-[9px] uppercase tracking-[0.28em] text-gold">
                        RC
                      </span>
                    )}
                    {r.filing && (
                      <span
                        className="ml-2 text-[9px] uppercase tracking-[0.28em] text-gold/60 animate-pulse"
                        title="File staged in Supabase Storage, awaiting Dropbox upload."
                      >
                        Filing…
                      </span>
                    )}
                    {r.kind === "fixed" && !r.salary && !r.filed && !r.filing && (
                      onAttachInvoiceFile && r.overhead ? (
                        <span className="ml-2 inline-flex" onClick={(e) => e.stopPropagation()}>
                          <MissingDocChip
                            label="Invoice missing"
                            title="No invoice filed — click or drop the invoice PDF"
                            onFile={(file) => onAttachInvoiceFile(r, file)}
                          />
                        </span>
                      ) : onAttachInvoice && r.overhead ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onAttachInvoice(r); }}
                          className="ml-2 text-[9px] uppercase tracking-[0.28em] text-[#d8a184] hover:text-[#ecd39c] transition-colors"
                          title="No invoice filed — click to upload it"
                        >
                          Invoice missing
                        </button>
                      ) : (
                        <span
                          className="ml-2 text-[9px] uppercase tracking-[0.28em] text-[#c98a6a]"
                          title="No invoice PDF filed to Dropbox yet"
                        >
                          Not filed
                        </span>
                      )
                    )}
                    {r.salary && !r.filed && (
                      onAttachPayslipFile ? (
                        <span className="ml-2 inline-flex" onClick={(e) => e.stopPropagation()}>
                          <MissingDocChip
                            label="Payslip missing"
                            title="No payslip filed — click or drop this month's payslip"
                            onFile={(file) => onAttachPayslipFile(r, file)}
                          />
                        </span>
                      ) : (
                        <span
                          className="ml-2 text-[9px] uppercase tracking-[0.28em] text-[#d8a184]"
                          title="No payslip filed — click the row to upload this month's payslip"
                        >
                          Payslip missing
                        </span>
                      )
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        r.kind === "fixed"
                          ? "text-[9px] uppercase tracking-[0.28em] text-gold-muted"
                          : "text-[9px] uppercase tracking-[0.28em] text-foreground/40"
                      }
                    >
                      {r.kind === "fixed" ? "Fixed" : "Variable"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-standard">{r.detail ?? "—"}</TableCell>
                  <TableCell className="text-sm text-standard">
                    {formatDate(r.date)}
                    {r.approxPeriod && (
                      <span className="ml-2 text-[9px] uppercase tracking-[0.28em] text-gold-muted">
                        ≈ created
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-standard text-right">
                    {r.net != null ? <CurrencyAmount amount={r.net} currency={r.currency} rateDate={r.rateDate} /> : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-standard text-right">
                    {r.vat != null ? <CurrencyAmount amount={r.vat} currency={r.currency} rateDate={r.rateDate} /> : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-strong text-right">
                    <CurrencyAmount amount={r.amount} currency={r.currency} rateDate={r.rateDate} />
                  </TableCell>
                  <TableCell>
                    <span className="flex items-baseline gap-3">
                      {urgency === "overdue" ? (
                        <span className="text-xs font-medium uppercase tracking-[0.24em] text-gold">
                          OVERDUE
                        </span>
                      ) : (
                        <span className={STATUS_CLASS[r.status]}>{STATUS_LABELS[r.status]}</span>
                      )}
                      {/* GBP only: revolut-pay-overhead refuses anything else,
                          so offering Pay on a EUR/USD row would be a button
                          that can only ever fail. Those are paid in Revolut
                          directly until multi-currency is built. */}
                      {onPay && r.overhead && r.status === "unpaid" && (
                        (r.currency ?? "GBP").toUpperCase() === "GBP" ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); onPay(r); }}
                            className="text-[9px] uppercase tracking-[0.28em] text-gold hover:text-[#ecd39c] transition-colors"
                            title="Pay this invoice from Revolut"
                          >
                            Pay
                          </button>
                        ) : (
                          <span
                            className="text-[9px] uppercase tracking-[0.28em] text-foreground/30"
                            title={`${(r.currency ?? "").toUpperCase()} invoice — pay this one in Revolut directly`}
                          >
                            {(r.currency ?? "").toUpperCase()}
                          </span>
                        )
                      )}
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
