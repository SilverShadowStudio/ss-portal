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
              return (
                <TableRow
                  key={r.id}
                  onClick={() => onRowClick(r)}
                  className="cursor-pointer border-divider hover:bg-foreground/[0.03] transition-colors"
                >
                  <TableCell className="text-sm text-strong">
                    {r.supplier_name}
                    {r.is_reverse_charge && (
                      <span className="ml-2 text-[9px] uppercase tracking-[0.28em] text-gold">
                        RC
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
                    <span
                      className={
                        r.payment_status === "paid"
                          ? "text-xs text-gold"
                          : "text-xs text-standard"
                      }
                    >
                      {r.payment_status === "paid" ? "Paid" : "Unpaid"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-recessive">{formatDate(r.due_date)}</TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
