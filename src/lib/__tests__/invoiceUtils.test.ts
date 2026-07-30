import { describe, it, expect, vi } from "vitest";

// invoiceUtils imports the supabase client transitively; localStorage does
// not exist in the node test environment. The pure functions never use it.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {},
  SUPABASE_URL: "",
  SUPABASE_PUBLISHABLE_KEY: "",
}));

import { formatCurrency, formatDate, lineItemsTotal } from "@/lib/invoiceUtils";

describe("formatCurrency (invoiceUtils)", () => {
  it("GBP renders en-GB", () => {
    expect(formatCurrency(1234.5, "GBP")).toBe("£1,234.50");
  });
  it("EUR renders with € symbol", () => {
    expect(formatCurrency(1234.5, "EUR")).toBe("€1,234.50");
  });
  it("garbage currency falls back to code prefix, not a throw", () => {
    expect(formatCurrency(10, "NOPE")).toBe("NOPE 10.00");
  });
});

describe("formatDate (invoiceUtils)", () => {
  it("renders en-GB 2-digit day", () => {
    expect(formatDate("2026-07-30")).toBe("30 Jul 2026");
  });
  it("nullish renders an em dash", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });
});

describe("lineItemsTotal", () => {
  it("sums quantity × unit_price", () => {
    expect(
      lineItemsTotal([
        { description: "a", quantity: 2, unit_price: 100 },
        { description: "b", quantity: 1, unit_price: 49.5 },
      ]),
    ).toBe(249.5);
  });
  it("treats non-numeric fields as zero", () => {
    expect(
      lineItemsTotal([{ description: "x", quantity: NaN as unknown as number, unit_price: 100 }]),
    ).toBe(0);
  });
  it("empty list is zero", () => {
    expect(lineItemsTotal([])).toBe(0);
  });
});
