// Foreign-exchange to GBP for the finance module. Rates are the ECB daily
// reference rates (via Frankfurter, api.frankfurter.app) — the set HMRC and UK
// accountants accept. We fetch one daily time-series per foreign currency
// (earliest record → today) so every historical date resolves locally, plus the
// latest rate for live/unpaid conversions. Cached in localStorage for the day.
//
// Policy (Fred): PAST/paid amounts lock to the rate on their date; FUTURE/unpaid
// amounts use the live rate. Callers pass the lock date, or null for live.

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

const CACHE_KEY = "ssfx-v1";
const isForeign = (c: string) => c === "EUR" || c === "USD";

interface CachePayload { day: string; start: string; data: FxData }

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchSeries(currency: string, start: string, end: string): Promise<FxSeries | null> {
  try {
    const url = `https://api.frankfurter.dev/v1/${start}..${end}?base=${currency}&symbols=${BASE}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.json() as { rates?: Record<string, Record<string, number>> };
    const entries = Object.entries(body.rates ?? {})
      .map(([d, r]) => [d, r?.[BASE]] as [string, number | undefined])
      .filter((e): e is [string, number] => typeof e[1] === "number")
      .sort((a, b) => a[0].localeCompare(b[0]));
    if (entries.length === 0) return null;
    return {
      dates: entries.map((e) => e[0]),
      rates: entries.map((e) => e[1]),
      latest: entries[entries.length - 1][1],
      latestDate: entries[entries.length - 1][0],
    };
  } catch {
    return null;
  }
}

/**
 * Load ECB→GBP series for the foreign currencies from `start` to today.
 * Cached per-day in localStorage. Returns {} if the network/API is unavailable
 * (callers fall back to showing the original currency untouched).
 */
export async function loadFxData(start = "2024-01-01"): Promise<FxData> {
  const day = todayISO();
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null") as CachePayload | null;
    if (cached && cached.day === day && cached.start <= start) return cached.data;
  } catch { /* ignore */ }

  const out: FxData = {};
  await Promise.all(FOREIGN.map(async (cur) => {
    const s = await fetchSeries(cur, start, day);
    if (s) out[cur] = s;
  }));
  if (Object.keys(out).length > 0) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ day, start, data: out } as CachePayload)); } catch { /* quota */ }
  }
  return out;
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
