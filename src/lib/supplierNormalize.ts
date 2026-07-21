// Supplier→category memory keys off a normalized supplier name so
// invoice-format quirks ("Roofoods Ltd." vs "Roofoods Limited" vs
// "Roofoods") collapse to a single stable key. Written on save,
// read on extraction — both use this function.

const COMPANY_SUFFIX_RE = /\b(limited|ltd|inc|llc|plc|corporation|corp)\b\.?/gi;
const PARENTHETICAL_RE  = /\s*\([^)]*\)\s*/g;

/** Normalize a supplier name for the supplier_category_map PK.
 *  Order matters — paren-stripping runs first so "Roofoods Limited"
 *  and "Roofoods Limited (Deliveroo)" collapse to the same key.
 *
 *  1. Strip parenthetical suffixes: "(anything)" removed
 *  2. lowercase
 *  3. NFKD normalise + strip diacritics
 *  4. strip common corporate suffixes (Ltd, Inc, LLC, PLC, Corp)
 *  5. "&" → " and "
 *  6. collapse any non-alphanumeric run to a single space
 *  7. trim
 *
 *  Empty string if the input is empty or normalizes to nothing. */
export function normalizeSupplier(name: string): string {
  if (!name) return "";
  return name
    .replace(PARENTHETICAL_RE, " ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(COMPANY_SUFFIX_RE, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
