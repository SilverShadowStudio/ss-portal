// Shared types + VAT helpers + quarter math for the Finance module.
// The generated Supabase types don't yet include overheads / expense_categories
// (Management-API token 401, so no regen). Local interfaces below mirror the
// migration schema; frontend queries cast results to these types.

export type VatTreatment =
  | "standard"
  | "reduced"
  | "zero"
  | "exempt"
  | "none"
  | "reverse_charge";

export type PaymentStatus = "unpaid" | "paid";

export interface ExpenseCategory {
  code: string;
  name: string;
  default_vat_treatment: VatTreatment;
  active: boolean;
}

export interface Overhead {
  id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  supplier_name: string;
  category_code: string | null;
  description: string | null;
  currency: string;
  net_amount: number;
  vat_amount: number;
  gross_amount: number;
  vat_treatment: VatTreatment;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  payment_date: string | null;
  payment_status: PaymentStatus;
  is_reverse_charge: boolean;
  reverse_charge_vat: number;
  source: string;
  dropbox_path: string | null;
  notes: string | null;
}

export const VAT_RATES: Record<VatTreatment, number> = {
  standard: 20,
  reduced: 5,
  zero: 0,
  exempt: 0,
  none: 0,
  reverse_charge: 0,
};

export const REVERSE_CHARGE_DEFAULT_RATE = 20;

export const VAT_TREATMENT_LABELS: Record<VatTreatment, string> = {
  standard: "Standard (20%)",
  reduced: "Reduced (5%)",
  zero: "Zero-rated (0%)",
  exempt: "Exempt",
  none: "Outside scope",
  reverse_charge: "Reverse charge",
};

export const VAT_TREATMENT_ORDER: VatTreatment[] = [
  "standard",
  "reduced",
  "zero",
  "exempt",
  "none",
  "reverse_charge",
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeVat(net: number, treatment: VatTreatment): { vat: number; gross: number } {
  const rate = VAT_RATES[treatment] ?? 0;
  const vat = round2((net * rate) / 100);
  return { vat, gross: round2(net + vat) };
}

export function computeReverseChargeVat(
  net: number,
  ratePercent: number = REVERSE_CHARGE_DEFAULT_RATE,
): number {
  return round2((net * ratePercent) / 100);
}

export function formatCurrency(amount: number | null | undefined, currency = "GBP"): string {
  const n = typeof amount === "number" ? amount : 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// UK Stagger 1: quarters end 31 Mar / 30 Jun / 30 Sep / 31 Dec.
export interface Quarter {
  year: number;
  q: 1 | 2 | 3 | 4;
  start: Date; // inclusive local midnight
  end: Date; // inclusive local end-of-day
  label: string; // "Q3 2026"
}

export function getQuarterForDate(date: Date): Quarter {
  const month = date.getMonth(); // 0-11
  const q = (Math.floor(month / 3) + 1) as 1 | 2 | 3 | 4;
  const year = date.getFullYear();
  const startMonth = (q - 1) * 3;
  const start = new Date(year, startMonth, 1, 0, 0, 0, 0);
  const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  return { year, q, start, end, label: `Q${q} ${year}` };
}

export function getCurrentQuarter(): Quarter {
  return getQuarterForDate(new Date());
}

export function getPreviousQuarter(from?: Quarter): Quarter {
  const base = from ?? getCurrentQuarter();
  const prev = new Date(base.start);
  prev.setMonth(prev.getMonth() - 1);
  return getQuarterForDate(prev);
}

export function dateInQuarter(dateStr: string | null | undefined, quarter: Quarter): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return d >= quarter.start && d <= quarter.end;
}

// UK VAT return + payment deadline: 1 month + 7 days after the quarter end.
// Q1 (Jan-Mar) → 7 May, Q2 (Apr-Jun) → 7 Aug, Q3 (Jul-Sep) → 7 Nov, Q4 (Oct-Dec) → 7 Feb.
export function getHmrcDeadline(quarter: Quarter): Date {
  const y = quarter.end.getFullYear();
  const m = quarter.end.getMonth(); // 0-11 (Jun = 5)
  return new Date(y, m + 2, 7, 23, 59, 59, 999);
}

export function formatHmrcDeadline(quarter: Quarter): string {
  return getHmrcDeadline(quarter).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Shape used by the finance dashboard for the Money-IN read of `invoices`.
// The generated Supabase types cover `invoices` fully, but Pass 3 only reads
// a subset — this narrows what the UI depends on.
export interface MoneyInInvoice {
  id: string;
  invoice_number: string | null;
  reference_number: string | null;
  account_id: string | null;
  account_company?: string | null;
  subtotal: number | null;
  vat_amount: number | null;
  vat_rate: number | null;
  amount: number;
  currency: string | null;
  status: string;
  type: string | null;
  paid_at: string | null;
  due_date: string | null;
  issued_at: string | null;
  created_at: string;
  notes: string | null;
  line_items: unknown;
  stripe_checkout_url: string | null;
  project_id: string | null;
  user_id: string;
}

export interface ReverseChargeItem {
  id: string;
  supplier_name: string;
  reverse_charge_vat: number;
  payment_date: string | null;
}

export interface QuarterVat {
  quarter: Quarter;
  outputVat: number;
  inputVat: number;
  netVat: number;
  reverseChargeItems: ReverseChargeItem[];
  reverseChargeTotal: number;
}

// Cash-basis quarter VAT:
//   Output VAT = Σ invoices.vat_amount WHERE status='paid' AND paid_at ∈ quarter
//   Input  VAT = Σ overheads.vat_amount WHERE payment_status='paid' AND payment_date ∈ quarter AND NOT is_reverse_charge
//   Reverse-charge items surfaced separately (excluded from Input VAT sum).
export function computeQuarterVat(
  invoices: MoneyInInvoice[],
  overheads: Overhead[],
  quarter: Quarter,
): QuarterVat {
  const outputVat = invoices
    .filter((i) => i.status === "paid" && dateInQuarter(i.paid_at, quarter))
    .reduce((s, i) => s + Number(i.vat_amount ?? 0), 0);

  const paidOverheadsInQuarter = overheads.filter(
    (o) => o.payment_status === "paid" && dateInQuarter(o.payment_date, quarter),
  );

  const inputVat = paidOverheadsInQuarter
    .filter((o) => !o.is_reverse_charge)
    .reduce((s, o) => s + Number(o.vat_amount ?? 0), 0);

  const reverseChargeItems: ReverseChargeItem[] = paidOverheadsInQuarter
    .filter((o) => o.is_reverse_charge)
    .map((o) => ({
      id: o.id,
      supplier_name: o.supplier_name,
      reverse_charge_vat: Number(o.reverse_charge_vat ?? 0),
      payment_date: o.payment_date,
    }));

  const reverseChargeTotal = reverseChargeItems.reduce(
    (s, i) => s + i.reverse_charge_vat,
    0,
  );

  return {
    quarter,
    outputVat: round2(outputVat),
    inputVat: round2(inputVat),
    netVat: round2(outputVat - inputVat),
    reverseChargeItems,
    reverseChargeTotal: round2(reverseChargeTotal),
  };
}
