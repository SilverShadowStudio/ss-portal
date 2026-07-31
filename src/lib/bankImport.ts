// Revolut Business CSV → bank_transactions records.
//
// This is the browser-side twin of scripts/load-bank-csv.py: the SAME
// classification rules, so a self-service CSV import and (later) the Revolut
// read-API sync produce identical rows. Re-importing is safe — the caller
// upserts on the Revolut transaction id with ignoreDuplicates, so already
// reviewed/categorised rows are never clobbered.

const SELF = "SILVERSHADOW STUDIO LIMITED";

export type BankClass =
  | "client_income" | "expense" | "internal_fx" | "pocket_move"
  | "directors_loan" | "bank_fee" | "refund" | "ebay_resale" | "uncategorized";

/** Classify one Revolut row. Order matters — non-trading buckets first. */
export function classifyRow(r: Record<string, string>): BankClass {
  const t = r["Type"] ?? "";
  const desc = r["Description"] ?? "";
  const ref = r["Reference"] ?? "";
  const snd = r["Sender name"] ?? "";
  const amount = Number(r["Amount"] || 0);

  if (t === "FEE") return "bank_fee";
  if (t === "EXCHANGE") return "internal_fx";
  if (snd === SELF || desc.includes("Provision") || ref.includes("recover negative balance") ||
      desc.includes("→ Revenue") || desc.startsWith("From British")) return "pocket_move";
  if (ref.includes("Directors Loan") || snd === "COLOMB A") return "directors_loan";
  if (amount > 0) {
    if (snd.toUpperCase().includes("EBAY")) return "ebay_resale";
    if (desc.includes("Refund") || snd.toUpperCase().includes("PAYSEND") || ref.toLowerCase().includes("refund")) return "refund";
    return "client_income";
  }
  return "expense";
}

function counterparty(r: Record<string, string>): string {
  const amount = Number(r["Amount"] || 0);
  return (amount > 0 ? (r["Sender name"] || r["Description"]) : (r["Beneficiary name"] || r["Description"]) || "").trim();
}

const numOrNull = (v: string | undefined) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** RFC-4180-ish CSV parse: honours quoted fields + embedded commas/newlines. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let field = "", row: string[] = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) out.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((f) => f !== "")) out.push(row); }
  return out;
}

export interface BankRecord {
  id: string;
  date_started: string | null;
  date_completed: string | null;
  type: string | null;
  state: string | null;
  description: string | null;
  reference: string | null;
  counterparty: string | null;
  orig_currency: string | null;
  orig_amount: number | null;
  amount: number;
  fee: number;
  balance: number | null;
  account: string | null;
  mcc: string | null;
  classification: BankClass;
  raw: Record<string, string>;
}

/** Parse a Revolut Business statement CSV into insert-ready records. */
export function parseRevolutCsv(text: string): BankRecord[] {
  const rowsRaw = parseCsv(text);
  if (rowsRaw.length < 2) return [];
  const header = rowsRaw[0];
  const idx = (name: string) => header.indexOf(name);
  const need = ["ID", "Amount", "Type"];
  if (need.some((n) => idx(n) < 0)) throw new Error("Not a Revolut statement CSV (missing ID / Amount / Type columns).");

  const records: BankRecord[] = [];
  for (let i = 1; i < rowsRaw.length; i++) {
    const cells = rowsRaw[i];
    const r: Record<string, string> = {};
    header.forEach((h, j) => { r[h] = cells[j] ?? ""; });
    const amount = numOrNull(r["Amount"]);
    if (!r["ID"] || amount == null) continue;
    records.push({
      id: r["ID"],
      date_started: r["Date started (UTC)"] || null,
      date_completed: r["Date completed (UTC)"] || null,
      type: r["Type"] || null,
      state: r["State"] || null,
      description: r["Description"] || null,
      reference: r["Reference"] || null,
      counterparty: counterparty(r) || null,
      orig_currency: r["Orig currency"] || null,
      orig_amount: numOrNull(r["Orig amount"]),
      amount,
      fee: numOrNull(r["Fee"]) ?? 0,
      balance: numOrNull(r["Balance"]),
      account: r["Account"] || null,
      mcc: r["MCC"] || null,
      classification: classifyRow(r),
      raw: Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "")),
    });
  }
  return records;
}
