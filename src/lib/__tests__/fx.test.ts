import { describe, it, expect, vi } from "vitest";

// fx.ts imports the supabase client, which touches localStorage at module
// scope — absent in the node test environment. The pure functions under test
// never use it.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {},
  SUPABASE_URL: "",
  SUPABASE_PUBLISHABLE_KEY: "",
}));

import { rateFor, toGbp, formatMoney, type FxData } from "@/lib/fx";

// GBP per 1 EUR, with a weekend gap between the 10th (Fri) and 13th (Mon).
const data: FxData = {
  EUR: {
    dates: ["2026-07-08", "2026-07-09", "2026-07-10", "2026-07-13"],
    rates: [0.84, 0.85, 0.86, 0.87],
    latest: 0.87,
    latestDate: "2026-07-13",
  },
};

describe("rateFor", () => {
  it("GBP is always 1", () => {
    expect(rateFor(data, "GBP", "2026-07-09")).toBe(1);
    expect(rateFor(data, "GBP", null)).toBe(1);
  });

  it("unknown currency is null", () => {
    expect(rateFor(data, "JPY", "2026-07-09")).toBeNull();
  });

  it("null date means live/latest", () => {
    expect(rateFor(data, "EUR", null)).toBe(0.87);
  });

  it("exact published date", () => {
    expect(rateFor(data, "EUR", "2026-07-09")).toBe(0.85);
  });

  it("weekend gap falls back to nearest rate on/before (ECB skips Sat/Sun)", () => {
    expect(rateFor(data, "EUR", "2026-07-11")).toBe(0.86); // Sat → Fri's rate
    expect(rateFor(data, "EUR", "2026-07-12")).toBe(0.86); // Sun → Fri's rate
  });

  it("date before the series uses the earliest known rate", () => {
    expect(rateFor(data, "EUR", "2026-01-01")).toBe(0.84);
  });

  it("date after the series uses the last published rate", () => {
    expect(rateFor(data, "EUR", "2026-08-01")).toBe(0.87);
  });
});

describe("toGbp", () => {
  it("GBP passes through untouched, never marked live", () => {
    expect(toGbp(data, 500, "GBP", null)).toEqual({ gbp: 500, rate: 1, live: false, rateDate: null });
  });

  it("locked date converts at that date's rate", () => {
    const c = toGbp(data, 1000, "EUR", "2026-07-09");
    expect(c.gbp).toBeCloseTo(850);
    expect(c.live).toBe(false);
    expect(c.rateDate).toBe("2026-07-09");
  });

  it("null date converts live and reports the rate date", () => {
    const c = toGbp(data, 1000, "EUR", null);
    expect(c.gbp).toBeCloseTo(870);
    expect(c.live).toBe(true);
    expect(c.rateDate).toBe("2026-07-13");
  });

  it("unknown currency yields nulls rather than a wrong number", () => {
    const c = toGbp(data, 1000, "JPY", null);
    expect(c.gbp).toBeNull();
    expect(c.rate).toBeNull();
  });
});

describe("formatMoney", () => {
  it("known symbols", () => {
    expect(formatMoney(1234.5, "GBP")).toBe("£1,234.50");
    expect(formatMoney(1234.5, "EUR")).toBe("€1,234.50");
  });
  it("unknown currency falls back to code prefix", () => {
    expect(formatMoney(10, "CHF")).toBe("CHF 10.00");
  });
});
