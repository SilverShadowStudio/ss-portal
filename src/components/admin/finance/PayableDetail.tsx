import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  APPROX_PERIOD_SOURCES,
  formatCurrency,
  formatDate,
  outstandingFor,
  PAYABLE_SOURCE_LABELS,
  type Payable,
  type PayablePaidStatus,
  type PayableSource,
} from "@/lib/finance";

interface PayableDetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payable: Payable | null;
  baseId: string | null;
}

const STATUS_LABELS: Record<PayablePaidStatus, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  partial: "Partial",
  unknown: "Unknown",
};

// Airtable table IDs mirror the Pass 1 config seed. Used only to build the
// "Open in Airtable" deep link on the detail dialog.
const TABLE_ID_FOR_SOURCE: Record<PayableSource, string> = {
  modeller_invoices: "tbl6WfMgznJYgevRt",
  scene_manager_invoice: "tblhYCC3InxUJUK3H",
  photographer_invoice: "tblCoQXYZuUCh0Vgc",
  partner_studios_monthly: "tbl4fdObC6NYOUINx",
  partner_studios_contract: "tblBUVWHpphKDiEKS",
};

export function PayableDetail({
  open,
  onOpenChange,
  payable,
  baseId,
}: PayableDetailProps) {
  const airtableUrl =
    payable && baseId
      ? `https://airtable.com/${baseId}/${TABLE_ID_FOR_SOURCE[payable.source_table]}/${payable.airtable_record_id}`
      : null;

  const statusClass = payable
    ? payable.paid_status === "paid"
      ? "text-gold"
      : payable.paid_status === "partial"
        ? "text-gold-muted"
        : "text-standard"
    : "text-standard";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl rounded-sm border-divider bg-background"
        hideClose
      >
        <DialogHeader>
          <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">
            Payable detail
          </p>
          <DialogTitle className="font-serif font-normal text-2xl">
            {payable?.payee_name ?? "—"}
          </DialogTitle>
        </DialogHeader>

        {payable && (
          <div className="grid gap-4 py-2">
            <Row label="Source">
              {PAYABLE_SOURCE_LABELS[payable.source_table]}
            </Row>
            {payable.payee_email && <Row label="Email">{payable.payee_email}</Row>}

            <div className="grid grid-cols-3 gap-4 border-t border-divider pt-4">
              <Metric label="Total" value={formatCurrency(payable.invoice_total)} />
              <Metric
                label="Paid"
                value={
                  payable.amount_paid != null
                    ? formatCurrency(payable.amount_paid)
                    : "—"
                }
              />
              <Metric
                label="Outstanding"
                value={formatCurrency(outstandingFor(payable))}
                accent
              />
            </div>

            <Row label="Status">
              <span className={statusClass}>
                {STATUS_LABELS[payable.paid_status]}
              </span>
            </Row>
            {payable.payment_stage && (
              <Row label="Payment stage">{payable.payment_stage}</Row>
            )}
            {payable.invoice_number && (
              <Row label="Invoice #">{payable.invoice_number}</Row>
            )}

            <div className="border-t border-divider pt-4 space-y-3">
              <Row label="Period">
                {payable.period_date ? formatDate(payable.period_date) : "—"}
                {APPROX_PERIOD_SOURCES.has(payable.source_table) &&
                  payable.period_date && (
                    <span className="ml-2 text-[9px] uppercase tracking-[0.28em] text-gold-muted">
                      ≈ created
                    </span>
                  )}
              </Row>
              {payable.period_year && payable.period_month && (
                <Row label="Year / Month">
                  {payable.period_year} /{" "}
                  {String(payable.period_month).padStart(2, "0")}
                </Row>
              )}
            </div>

            <div className="border-t border-divider pt-4 space-y-3">
              <Row label="Synced at">{formatDate(payable.synced_at)}</Row>
              <Row label="Airtable ID">
                <span className="text-recessive tabular-nums text-xs">
                  {payable.airtable_record_id}
                </span>
              </Row>
            </div>
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
          {airtableUrl && (
            <a
              href={airtableUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gold hover:underline underline-offset-4"
            >
              Open in Airtable
            </a>
          )}
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

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">
        {label}
      </p>
      <p
        className={
          "mt-1 font-serif text-xl tabular-nums " +
          (accent ? "text-gold" : "text-strong")
        }
      >
        {value}
      </p>
    </div>
  );
}
