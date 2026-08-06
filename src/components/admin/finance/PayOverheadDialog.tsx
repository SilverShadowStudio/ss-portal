import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDate, type Overhead } from "@/lib/finance";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overhead: Overhead | null;
  onPaid: () => void;
}

/** Mask all but the last four digits — enough to recognise the account, not
 *  enough to be worth leaking off a screen. */
function maskAccount(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value.replace(/\s+/g, "");
  if (clean.length <= 4) return clean;
  return `${"•".repeat(Math.max(0, clean.length - 4))}${clean.slice(-4)}`;
}

/**
 * The one place the portal sends money out. Everything about it is deliberate:
 * the amount is restated, the destination is shown before the button, and the
 * gross the admin actually saw is echoed back to the edge function so a row
 * that changed underneath can't be paid at the new figure.
 */
export function PayOverheadDialog({ open, onOpenChange, overhead, onPaid }: Props) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  if (!overhead) return null;

  const gross = Number(overhead.gross_amount ?? 0);
  const sortCode = overhead.supplier_sort_code;
  const accountNo = maskAccount(overhead.supplier_account_number);
  const iban = maskAccount(overhead.supplier_iban);
  const hasDestination = !!((sortCode && overhead.supplier_account_number) || overhead.supplier_iban);

  async function handlePay() {
    if (!overhead) return;
    setSending(true);
    setError(null);
    const { data, error: fnErr } = await supabase.functions.invoke("revolut-pay-overhead", {
      body: { overhead_id: overhead.id, confirm_gross: gross },
    });

    // On a non-2xx, supabase-js leaves `data` null and hides the body inside
    // FunctionsHttpError.context — a Response. Without reading it, every
    // failure would read "Edge Function returned a non-2xx status code" and
    // the reason the payment stopped (wrong amount, no bank details, missing
    // Revolut scope) would never reach the screen.
    let payload = data as { success?: boolean; error?: string; reference?: string } | null;
    if (!payload && fnErr) {
      const res = (fnErr as { context?: Response }).context;
      if (res && typeof res.json === "function") {
        payload = await res.json().catch(() => null);
      }
    }
    setSending(false);

    if (!payload?.success) {
      setError(
        payload?.error ?? fnErr?.message ?? "The payment didn't go through. Nothing was sent.",
      );
      return;
    }

    toast({
      title: `Paid ${overhead.supplier_name} — ${formatCurrency(gross)}`,
      description: `Sent from Revolut${payload.reference ? ` with reference ${payload.reference}` : ""}.`,
    });
    onPaid();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-sm border-divider bg-background" hideClose>
        <DialogHeader>
          <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">
            Pay from Revolut
          </p>
          <DialogTitle className="font-serif font-normal text-2xl">
            {overhead.supplier_name}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="border-y border-divider py-4">
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">
              Amount to send
            </p>
            <p className="mt-1 ssr-figure text-gold">{formatCurrency(gross)}</p>
          </div>

          <Row label="Invoice">{overhead.invoice_number || "—"}</Row>
          <Row label="Invoice date">{formatDate(overhead.invoice_date)}</Row>
          {overhead.due_date && <Row label="Due">{formatDate(overhead.due_date)}</Row>}
          <Row label="Reference">
            {overhead.payment_reference || overhead.invoice_number || "—"}
          </Row>

          <div className="border-t border-divider pt-4">
            {hasDestination ? (
              <Row label="To account">
                {sortCode && accountNo ? `${sortCode} · ${accountNo}` : iban}
              </Row>
            ) : (
              <p className="font-sans text-[11px] leading-relaxed text-[#d8a184]">
                No bank details were found on this invoice, so there's nowhere to
                send it. Add them to the row first, or pay this one in Revolut
                directly.
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-sm border border-[#d8a184]/40 bg-[#d8a184]/[0.08] px-3 py-2 font-sans text-[11px] leading-relaxed text-[#e5b39a]">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-6 border-t border-divider pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-sm text-recessive hover:text-standard transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handlePay}
            disabled={sending || !hasDestination}
            className="bg-gold px-5 py-2 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {sending ? "Sending…" : `Send ${formatCurrency(gross)}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="shrink-0 text-[9px] uppercase tracking-[0.28em] text-foreground/40">
        {label}
      </span>
      <span className="text-right text-sm text-standard">{children}</span>
    </div>
  );
}
