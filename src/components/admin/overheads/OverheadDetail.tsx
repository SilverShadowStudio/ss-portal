import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatCurrency,
  formatDate,
  VAT_TREATMENT_LABELS,
  type ExpenseCategory,
  type Overhead,
} from "@/lib/finance";

interface OverheadDetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overhead: Overhead | null;
  categories: ExpenseCategory[];
  onEdit: () => void;
}

export function OverheadDetail({
  open,
  onOpenChange,
  overhead,
  categories,
  onEdit,
}: OverheadDetailProps) {
  const cat = overhead ? categories.find((c) => c.code === overhead.category_code) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl rounded-sm border-divider bg-background"
        hideClose
      >
        <DialogHeader>
          <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Expense detail</p>
          <DialogTitle className="font-serif font-normal text-2xl">
            {overhead?.supplier_name ?? "—"}
          </DialogTitle>
        </DialogHeader>

        {overhead && (
          <div className="grid gap-4 py-2">
            <Row label="Category">
              {cat ? `${cat.code} — ${cat.name}` : overhead.category_code ?? "—"}
            </Row>
            {overhead.description && <Row label="Description">{overhead.description}</Row>}

            <div className="grid grid-cols-3 gap-4 border-t border-divider pt-4">
              <Metric label="Net" value={formatCurrency(overhead.net_amount)} />
              <Metric label="VAT" value={formatCurrency(overhead.vat_amount)} />
              <Metric label="Gross" value={formatCurrency(overhead.gross_amount)} accent />
            </div>

            <Row label="VAT treatment">{VAT_TREATMENT_LABELS[overhead.vat_treatment]}</Row>

            {overhead.is_reverse_charge && (
              <div className="border border-divider rounded-sm p-4">
                <p className="text-[9px] uppercase tracking-[0.28em] text-gold">Reverse charge</p>
                <p className="mt-2 text-xs text-gold-muted">
                  Flagged for accountant. Excluded from the cash-basis input-VAT figure.
                </p>
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-sm text-recessive">Self-accounted VAT</span>
                  <span className="font-serif text-lg text-strong">
                    {formatCurrency(overhead.reverse_charge_vat)}
                  </span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 border-t border-divider pt-4">
              <Row label="Invoice number">{overhead.invoice_number ?? "—"}</Row>
              <Row label="Invoice date">{formatDate(overhead.invoice_date)}</Row>
              <Row label="Due date">{formatDate(overhead.due_date)}</Row>
              <Row label="Payment date">{formatDate(overhead.payment_date)}</Row>
            </div>

            <Row label="Status">
              <span
                className={
                  overhead.payment_status === "paid"
                    ? "text-gold"
                    : "text-standard"
                }
              >
                {overhead.payment_status === "paid" ? "Paid" : "Unpaid"}
              </span>
            </Row>

            {overhead.notes && (
              <div className="border-t border-divider pt-4">
                <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40 mb-2">
                  Notes
                </p>
                <p className="text-sm text-standard whitespace-pre-wrap">{overhead.notes}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-6 border-t border-divider pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-sm text-recessive hover:text-standard transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="text-sm text-gold hover:underline underline-offset-4"
          >
            Edit
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-[9px] uppercase tracking-[0.28em] text-foreground/40 shrink-0">
        {label}
      </span>
      <span className="text-sm text-standard text-right">{children}</span>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">{label}</p>
      <p
        className={
          accent
            ? "mt-1 font-serif text-xl text-gold"
            : "mt-1 font-serif text-xl text-strong"
        }
      >
        {value}
      </p>
    </div>
  );
}
