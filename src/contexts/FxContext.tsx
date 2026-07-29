import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { loadFxData, toGbp, type FxData, type Converted } from "@/lib/fx";

interface FxValue {
  ready: boolean;
  data: FxData;
  /** Convert to GBP. dateISO null → live rate. */
  convert: (amount: number, currency: string, dateISO: string | null) => Converted;
  /** GBP total for a sum, foreign converted (unconvertible amounts pass through). */
  gbp: (amount: number, currency: string, dateISO: string | null) => number;
}

const FxContext = createContext<FxValue | null>(null);

export function FxProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<FxData>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadFxData().then((d) => { if (alive) { setData(d); setReady(true); } });
    return () => { alive = false; };
  }, []);

  const value = useMemo<FxValue>(() => ({
    ready,
    data,
    convert: (amount, currency, dateISO) => toGbp(data, amount, currency, dateISO),
    gbp: (amount, currency, dateISO) => {
      const c = toGbp(data, amount, currency, dateISO);
      return c.gbp ?? amount; // if a foreign rate is unavailable, fall back to raw
    },
  }), [data, ready]);

  return <FxContext.Provider value={value}>{children}</FxContext.Provider>;
}

export function useFx(): FxValue {
  const ctx = useContext(FxContext);
  if (!ctx) {
    // Safe no-op fallback if a consumer renders outside the provider.
    return {
      ready: false,
      data: {},
      convert: (amount, currency) => ({ gbp: currency === "GBP" ? amount : null, rate: currency === "GBP" ? 1 : null, live: false, rateDate: null }),
      gbp: (amount) => amount,
    };
  }
  return ctx;
}
