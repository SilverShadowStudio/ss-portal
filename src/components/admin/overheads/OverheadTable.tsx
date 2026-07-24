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
  type ExpenseCategory,
  type Overhead,
} from "@/lib/finance";
import { useTableSort, type SortableColumn } from "@/hooks/useTableSort";
import { SortableTh } from "@/components/ui/SortableTh";
import { differenceInCalendarDays } from "date-fns";

type Urgency = "overdue" | "due-soon" | null;

function computeUrgency(dueDate: string | null, status: string): Urgency {
  if (status === "paid" || !dueDate) return null;
  const days = differenceInCalendarDays(new Date(`${dueDate}T00:00:00`), new Date());
  if (days < 0) return "overdue";
  if (days <= 7) return "due-soon";
  return null;
}

interface OverheadTableProps {
  rows: Overhead[];
  categories: ExpenseCategory[];
  loading: boolean;
  onRowClick: (o: Overhead) => void;
}

export function OverheadTable({ rows, categories, loading, onRowClick }: OverheadTableProps) {
  const catByCode = new Map(categories.map((c) => [c.code, c] as const));

  const columns: SortableColumn<Overhead>[] = [
    { id: "supplier", accessor: (r) => r.supplier_name, type: "text" },
    {
      id: "category",
      accessor: (r) => {
        const c = r.category_code ? catByCode.get(r.category_code) : null;
        return c ? `${c.code} ${c.name}` : (r.category_code ?? "");
      },
      type: "text",
    },
    { id: "invoice_date", accessor: (r) => r.invoice_date, type: "date" },
    { id: "net", accessor: (r) => r.net_amount, type: "number" },
    { id: "vat", accessor: (r) => r.vat_amount, type: "number" },
    { id: "gross", accessor: (r) => r.gross_amount, type: "number" },
    { id: "status", accessor: (r) => r.payment_status, type: "text" },
    { id: "due", accessor: (r) => r.due_date, type: "date" },
  ];

  const { sortedRows, sortKey, sortDir, toggle } = useTableSort<Overhead>(
    rows,
    columns,
    { key: "invoice_date", dir: "desc" },
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
            {th("supplier", "Supplier")}
            {th("category", "Category")}
            {th("invoice_date", "Invoice date")}
            {th("net", "Net", "text-right")}
            {th("vat", "VAT", "text-right")}
            {th("gross", "Gross", "text-right")}
            {th("status", "Status")}
            {th("due", "Due")}
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
                No expenses recorded yet.
              </TableCell>
            </TableRow>
          ) : (
            sortedRows.map((r) => {
              const cat = r.category_code ? catByCode.get(r.category_code) : null;
              const urgency = computeUrgency(r.due_date, r.payment_status);
              const rowClass =
                urgency === "overdue"
                  ? "cursor-pointer border-divider border-l-2 border-l-gold bg-gold/[0.12] hover:bg-gold/[0.16] transition-colors"
                  : "cursor-pointer border-divider hover:bg-foreground/[0.03] transition-colors";
              const dueCellClass =
                urgency === "overdue"
                  ? "text-sm text-gold"
                  : urgency === "due-soon"
                    ? "text-sm text-gold/70"
                    : "text-sm text-recessive";
              return (
                <TableRow
                  key={r.id}
                  onClick={() => onRowClick(r)}
                  className={rowClass}
                >
                  <TableCell className="text-sm text-strong">
                    {r.supplier_name}
                    {r.is_reverse_charge && (
                      <span className="ml-2 text-[9px] uppercase tracking-[0.28em] text-gold">
                        RC
                      </span>
                    )}
                    {r.staging_storage_path && !r.dropbox_path && (
                      <span
                        className="ml-2 text-[9px] uppercase tracking-[0.28em] text-gold/60 animate-pulse"
                        title="File staged in Supabase Storage, awaiting Dropbox upload."
                      >
                        Filing…
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-standard">
                    {cat ? `${cat.code} — ${cat.name}` : r.category_code ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-standard">{formatDate(r.invoice_date)}</TableCell>
                  <TableCell className="text-sm text-standard text-right tabular-nums">
                    {formatCurrency(r.net_amount)}
                  </TableCell>
                  <TableCell className="text-sm text-standard text-right tabular-nums">
                    {formatCurrency(r.vat_amount)}
                  </TableCell>
                  <TableCell className="text-sm text-strong text-right tabular-nums">
                    {formatCurrency(r.gross_amount)}
                  </TableCell>
                  <TableCell>
                    {r.payment_status === "paid" ? (
                      <span className="text-xs text-gold">Paid</span>
                    ) : urgency === "overdue" ? (
                      <span className="text-xs font-medium uppercase tracking-[0.24em] text-gold">
                        OVERDUE
                      </span>
                    ) : urgency === "due-soon" ? (
                      <span className="text-xs text-gold/70">Unpaid</span>
                    ) : (
                      <span className="text-xs text-standard">Unpaid</span>
                    )}
                  </TableCell>
                  <TableCell className={dueCellClass}>{formatDate(r.due_date)}</TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
