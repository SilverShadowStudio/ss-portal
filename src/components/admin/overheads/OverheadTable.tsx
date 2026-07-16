import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatCurrency,
  formatDate,
  type ExpenseCategory,
  type Overhead,
} from "@/lib/finance";

interface OverheadTableProps {
  rows: Overhead[];
  categories: ExpenseCategory[];
  loading: boolean;
  onRowClick: (o: Overhead) => void;
}

export function OverheadTable({ rows, categories, loading, onRowClick }: OverheadTableProps) {
  const catByCode = new Map(categories.map((c) => [c.code, c] as const));

  return (
    <div className="border border-divider rounded-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-divider">
            <Th>Supplier</Th>
            <Th>Category</Th>
            <Th>Invoice date</Th>
            <Th className="text-right">Net</Th>
            <Th className="text-right">VAT</Th>
            <Th className="text-right">Gross</Th>
            <Th>Status</Th>
            <Th>Due</Th>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-12 text-recessive">
                Loading…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-12 text-recessive">
                No expenses recorded yet.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => {
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
