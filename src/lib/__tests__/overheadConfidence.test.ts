import { describe, expect, it } from "vitest";
import {
  assessOverhead,
  describeFlags,
  rawFiguresReconcile,
} from "@/lib/overheadConfidence";
import type { Overhead } from "@/lib/finance";

// A clean recurring invoice from a supplier we've filed before — the case the
// drop zone is meant to handle without stopping.
const GOOD_RAW = {
  supplier_name: "Adobe Inc",
  invoice_number: "IEE2026012385380",
  invoice_date: "2026-08-03",
  net_total: 25.99,
  vat_amount: 5.2,
  gross_total: 31.19,
};

const GOOD_DEFAULTS: Partial<Overhead> = {
  supplier_name: "Adobe Inc",
  invoice_number: "IEE2026012385380",
  invoice_date: "2026-08-03",
  net_amount: 25.99,
  vat_amount: 5.2,
  gross_amount: 31.19,
  category_code: "463",
};

describe("rawFiguresReconcile", () => {
  it("accepts figures that add up", () => {
    expect(rawFiguresReconcile(GOOD_RAW)).toBe(true);
  });

  it("rejects figures that don't", () => {
    expect(rawFiguresReconcile({ ...GOOD_RAW, gross_total: 40 })).toBe(false);
  });

  it("tolerates rounding to the penny", () => {
    expect(rawFiguresReconcile({ net_total: 10.005, vat_amount: 2, gross_total: 12.005 })).toBe(true);
  });

  it("can't judge when a figure is missing", () => {
    expect(rawFiguresReconcile({ net_total: 10, gross_total: 12 })).toBeNull();
  });

  it("copes with money as strings", () => {
    expect(rawFiguresReconcile({ net_total: "£25.99", vat_amount: "5.20", gross_total: "£31.19" })).toBe(true);
  });
});

describe("assessOverhead", () => {
  it("lets a clean invoice from a known supplier through", () => {
    const v = assessOverhead(GOOD_RAW, GOOD_DEFAULTS, { categoryFromMemory: true });
    expect(v.auto).toBe(true);
    expect(v.flags).toEqual([]);
    expect(v.showDocument).toBe(false);
  });

  it("stops the first invoice from a new supplier", () => {
    const v = assessOverhead(GOOD_RAW, GOOD_DEFAULTS, { categoryFromMemory: false });
    expect(v.auto).toBe(false);
    expect(v.flags).toContain("new_supplier");
  });

  it("stops when the figures don't reconcile, even for a known supplier", () => {
    const v = assessOverhead(
      { ...GOOD_RAW, gross_total: 40 },
      GOOD_DEFAULTS,
      { categoryFromMemory: true },
    );
    expect(v.auto).toBe(false);
    expect(v.flags).toContain("does_not_reconcile");
    // Known supplier — the remembered category is still worth something, so
    // the fields alone are enough to correct from.
    expect(v.showDocument).toBe(false);
  });

  it("shows the document when the numbers are wrong AND the supplier is new", () => {
    const v = assessOverhead(
      { ...GOOD_RAW, gross_total: 40 },
      GOOD_DEFAULTS,
      { categoryFromMemory: false },
    );
    expect(v.showDocument).toBe(true);
  });

  it("stops without an invoice date — there'd be no folder to file it in", () => {
    const { invoice_date: _omit, ...rest } = GOOD_DEFAULTS;
    const v = assessOverhead(GOOD_RAW, rest, { categoryFromMemory: true });
    expect(v.auto).toBe(false);
    expect(v.flags).toContain("no_invoice_date");
  });

  it("stops without an invoice number — the duplicate guard needs one", () => {
    const v = assessOverhead(
      GOOD_RAW,
      { ...GOOD_DEFAULTS, invoice_number: "  " },
      { categoryFromMemory: true },
    );
    expect(v.auto).toBe(false);
    expect(v.flags).toContain("no_invoice_number");
  });

  it("stops when no total was read", () => {
    const v = assessOverhead(
      { ...GOOD_RAW, gross_total: null },
      { ...GOOD_DEFAULTS, gross_amount: undefined },
      { categoryFromMemory: true },
    );
    expect(v.auto).toBe(false);
    expect(v.flags).toContain("no_gross");
  });

  it("flags a missing category rather than filing it uncategorised", () => {
    const { category_code: _omit, ...rest } = GOOD_DEFAULTS;
    const v = assessOverhead(GOOD_RAW, rest, { categoryFromMemory: false });
    expect(v.auto).toBe(false);
    expect(v.flags).toContain("no_category");
    // no_category and new_supplier are alternatives, never both.
    expect(v.flags).not.toContain("new_supplier");
  });

  it("does not double-count reconciliation when there is no total at all", () => {
    const v = assessOverhead(
      { ...GOOD_RAW, gross_total: null },
      { ...GOOD_DEFAULTS, gross_amount: undefined },
      { categoryFromMemory: true },
    );
    expect(v.flags).not.toContain("does_not_reconcile");
  });
});

describe("describeFlags", () => {
  it("reads as a sentence fragment", () => {
    expect(describeFlags(["no_invoice_number", "new_supplier"])).toBe(
      "no invoice number and first invoice from this supplier",
    );
  });

  it("handles a single flag", () => {
    expect(describeFlags(["new_supplier"])).toBe("first invoice from this supplier");
  });

  it("handles none", () => {
    expect(describeFlags([])).toBe("");
  });
});
