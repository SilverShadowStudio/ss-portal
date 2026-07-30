import { describe, it, expect } from "vitest";
import {
  computeVat,
  computeReverseChargeVat,
  formatCurrency,
  getQuarterForDate,
  getPreviousQuarter,
  dateInQuarter,
  VAT_RATES,
} from "@/lib/finance";

describe("computeVat", () => {
  it("standard rate is 20%", () => {
    expect(computeVat(100, "standard")).toEqual({ vat: 20, gross: 120 });
  });

  it("reduced rate is 5%", () => {
    expect(computeVat(100, "reduced")).toEqual({ vat: 5, gross: 105 });
  });

  it("zero / exempt / none / reverse_charge / mixed add no VAT", () => {
    for (const t of ["zero", "exempt", "none", "reverse_charge", "mixed"] as const) {
      expect(computeVat(250, t)).toEqual({ vat: 0, gross: 250 });
    }
  });

  it("rounds half-up to 2dp", () => {
    // 33.33 * 20% = 6.666 → 6.67; gross 39.996 → 40
    expect(computeVat(33.33, "standard")).toEqual({ vat: 6.67, gross: 40 });
  });

  it("VAT_RATES stays in sync with treatments", () => {
    expect(VAT_RATES.standard).toBe(20);
    expect(VAT_RATES.reduced).toBe(5);
  });
});

describe("computeReverseChargeVat", () => {
  it("defaults to 20%", () => {
    expect(computeReverseChargeVat(100)).toBe(20);
  });
  it("accepts a custom rate", () => {
    expect(computeReverseChargeVat(200, 5)).toBe(10);
  });
});

describe("formatCurrency (finance)", () => {
  it("defaults to GBP, en-GB, 2dp", () => {
    expect(formatCurrency(1234.5)).toBe("£1,234.50");
  });
  it("null/undefined render as zero, never NaN", () => {
    expect(formatCurrency(null)).toBe("£0.00");
    expect(formatCurrency(undefined)).toBe("£0.00");
  });
});

describe("UK Stagger-1 quarters", () => {
  it("30 Jul 2026 is Q3 2026 (Jul–Sep)", () => {
    const q = getQuarterForDate(new Date(2026, 6, 30));
    expect(q.label).toBe("Q3 2026");
    expect(q.start.getMonth()).toBe(6); // July
    expect(q.end.getMonth()).toBe(8); // September
    expect(q.end.getDate()).toBe(30);
  });

  it("31 Mar is Q1; 1 Apr is Q2", () => {
    expect(getQuarterForDate(new Date(2026, 2, 31)).label).toBe("Q1 2026");
    expect(getQuarterForDate(new Date(2026, 3, 1)).label).toBe("Q2 2026");
  });

  it("previous quarter of Q1 2026 is Q4 2025", () => {
    const q1 = getQuarterForDate(new Date(2026, 0, 15));
    expect(getPreviousQuarter(q1).label).toBe("Q4 2025");
  });

  it("dateInQuarter handles boundaries, nulls, and garbage", () => {
    const q3 = getQuarterForDate(new Date(2026, 6, 15));
    expect(dateInQuarter("2026-07-01", q3)).toBe(true);
    expect(dateInQuarter("2026-09-30", q3)).toBe(true);
    expect(dateInQuarter("2026-06-30", q3)).toBe(false);
    expect(dateInQuarter("2026-10-01", q3)).toBe(false);
    expect(dateInQuarter(null, q3)).toBe(false);
    expect(dateInQuarter("not-a-date", q3)).toBe(false);
  });
});
