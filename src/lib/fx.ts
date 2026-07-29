// Foreign-exchange to GBP for the finance module. Rates are the ECB daily
// reference rates (the set HMRC and UK accountants accept), cached server-side
// in the fx_rates table by the fx-sync edge function — the browser reads the
// table (reliable) rather than a flaky third-party API.
//
// Policy (Fred): PAST/paid amounts lock to the rate on their date; FUTURE/unpaid
// amounts use the live rate. Callers pass the lock date, or null for live.
import { supabase } from "@/integrations/supabase/client";

export const BASE = "GBP";
export const FOREIGN = ["EUR", "USD"] as const;
export type Currency = "GBP" | "EUR" | "USD";
export const CURRENCY_SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" };

export interface FxSeries {
  // date (YYYY-MM-DD) → GBP per 1 unit of the currency, sorted ascending.
  dates: string[];
  rates: number[];
  latest: number; // most recent published rate (live)
  latestDate: string;
}
export type FxData = Record<string, FxSeries>; // keyed by foreign currency

const isForeign = (c: string) => c === "EUR" || c === "USD";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function readTable(): Promise<FxData> {
  const { data } = await supabase
    .from("fx_rates")
    .select("base, rate_date, rate")
    .in("base", FOREIGN as unknown as string[])
    .order("rate_date", { ascending: true });
  const out: FxData = {};
  for (const row of (data ?? []) as { base: string; rate_date: string; rate: number }[]) {
    const s = out[row.base] ?? (out[row.base] = { dates: [], rates: [], latest: 0, latestDate: "" });
    s.dates.push(row.rate_date);
    s.rates.push(Number(row.rate));
  }
  for (const c of Object.keys(out)) {
    const s = out[c];
    s.latest = s.rates[s.rates.length - 1];
    s.latestDate = s.dates[s.dates.length - 1];
  }
  return out;
}

/**
 * Load ECB→GBP series from the cached fx_rates table. If the cache is empty or
 * more than a few days stale (weekends: ECB skips Sat/Sun), trigger fx-sync and
 * re-read. Returns {} only if the table is empty and the sync failed — callers
 * then fall back to showing the original currency untouched.
 */
export async function loadFxData(): Promise<FxData> {
  let data = await readTable();
  const cutoff = isoDaysAgo(4);
  const stale = FOREIGN.some((c) => !data[c] || data[c].latestDate < cutoff);
  if (Object.keys(data).length === 0 || stale) {
    try {
      await supabase.functions.invoke("fx-sync", { body: {} });
      data = await readTable();
    } catch { /* keep whatever we have */ }
  }
  return data;
}

/** GBP per 1 unit of `currency` on/at `dateISO` (null = live/latest). null if unknown. */
export function rateFor(data: FxData, currency: string, dateISO: string | null): number | null {
  if (currency === BASE) return 1;
  const s = data[currency];
  if (!s) return null;
  if (!dateISO) return s.latest;
  // Nearest published rate on/before the date (ECB skips weekends/holidays).
  let lo = 0, hi = s.dates.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s.dates[mid] <= dateISO) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans >= 0) return s.rates[ans];
  return s.rates[0]; // date precedes the series — use the earliest known rate
}

export interface Converted { gbp: number | null; rate: number | null; live: boolean; rateDate: string | null }

/** Convert to GBP. `dateISO` null → live rate. */
export function toGbp(data: FxData, amount: number, currency: string, dateISO: string | null): Converted {
  if (currency === BASE) return { gbp: amount, rate: 1, live: false, rateDate: null };
  const rate = rateFor(data, currency, dateISO);
  if (rate == null) return { gbp: null, rate: null, live: !dateISO, rateDate: dateISO };
  const s = data[currency];
  return { gbp: amount * rate, rate, live: !dateISO, rateDate: dateISO ?? s?.latestDate ?? null };
}

export const isForeignCurrency = isForeign;

export function formatMoney(amount: number, currency = "GBP"): string {
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  return sym + new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
}
