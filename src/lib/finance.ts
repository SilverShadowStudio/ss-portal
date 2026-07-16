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
