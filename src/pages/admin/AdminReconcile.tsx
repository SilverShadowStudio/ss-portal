import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Check, Search, UploadCloud, FilePlus2, RefreshCw } from "lucide-react";
import { parseRevolutCsv } from "@/lib/bankImport";
import { normalizeSupplier } from "@/lib/supplierNormalize";
import { useFx } from "@/contexts/FxContext";
import { IncomeInvoiceReviewDialog, EMPTY_INCOME_FORM, type FormState, type InvoiceKind } from "@/components/admin/finance/IncomeInvoiceUpload";
import { BankTruthChart } from "@/components/admin/finance/BankTruthChart";

// bank_transactions isn't in the generated Supabase types (same reason as
// overheads/expense_categories — the type-gen token 401s), so we type it
// locally and cast the client, mirroring src/lib/finance.ts.
const sb = supabase as unknown as {
  from: (t: string) => any;
};

interface BankTxn {
  id: string;
  date_completed: string | null;
  type: string | null;
  description: string | null;
  reference: string | null;
  counterparty: string | null;
  amount: number;
  classification: string;
  category_code: string | null;
  matched_type: string | null;
  matched_id: string | null;
  status: string;
  reviewed: boolean;
  matchedAmount?: number | null; // gross of the matched invoice/overhead, for discrepancy detection
}
interface Cat { code: string; name: string }

// A matched transaction whose bank amount differs from the record it matched
// (e.g. KAT025-A: £13,200 received vs £26,400 invoiced).
const hasDiscrepancy = (t: BankTxn) =>
  t.matched_id != null && t.matchedAmount != null && Math.abs(Math.abs(t.amount) - t.matchedAmount) > 0.01;

const money = (n: number) =>
  (n < 0 ? "−£" : "£") +
  Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

// Non-trading buckets are excluded from the P&L by classification.
const NON_TRADING = new Set(["internal_fx", "pocket_move", "directors_loan"]);
const CLASS_LABEL: Record<string, string> = {
  client_income: "Income", ebay_resale: "eBay", expense: "Expense", bank_fee: "Fee",
  refund: "Refund", internal_fx: "Internal FX", pocket_move: "Pocket move",
  directors_loan: "Directors loan", uncategorized: "Unclassified",
};
const classTone = (c: string) =>
  c === "client_income" || c === "ebay_resale" ? "text-[#84b594]"
    : NON_TRADING.has(c) ? "text-white/35"
    : c === "bank_fee" ? "text-gold-muted"
    : "text-[#d8a184]";

const FILTERS: { key: string; label: string; test: (t: BankTxn) => boolean }[] = [
  { key: "review", label: "Needs review", test: (t) => !t.reviewed && !NON_TRADING.has(t.classification) && t.classification !== "bank_fee" && (t.classification === "expense" ? !t.category_code : t.matched_id == null) },
  { key: "discrepancy", label: "Discrepancies", test: hasDiscrepancy },
  { key: "income", label: "Income", test: (t) => t.classification === "client_income" || t.classification === "ebay_resale" },
  { key: "expense", label: "Expenses", test: (t) => t.classification === "expense" },
  { key: "internal", label: "Non-trading", test: (t) => NON_TRADING.has(t.classification) },
  { key: "all", label: "All", test: () => true },
];

export default function AdminReconcile() {
  const { toast } = useToast();
  const fx = useFx();
  const [rows, setRows] = useState<BankTxn[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("review");
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Live pull from Revolut (the read API) — supersedes manual CSV import.
  async function syncNow() {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("revolut-sync", { body: {} });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      await applyCategoryMap();
      await load();
      toast({ title: `Synced from Revolut — ${(data as { fetched?: number })?.fetched ?? 0} transactions checked` });
    } catch (e) {
      toast({ title: "Revolut sync failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }
  const [recordInitial, setRecordInitial] = useState<FormState | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);

  // Pre-fill the income-invoice review dialog from a bank transaction. VAT is
  // left blank — the bank only knows gross, and foreign clients are often
  // zero-rated, so we never guess it. Fred confirms client + VAT, then saves.
  function recordAsIncome(t: BankTxn) {
    const ref = (t.reference ?? "").trim();
    const suffix = ref.match(/-?\s?([A-Za-z])\d*$/)?.[1]?.toUpperCase();
    const kind: InvoiceKind = suffix === "A" ? "deposit" : (suffix && suffix >= "B" && suffix <= "Z") ? "balance" : "standalone";
    setRecordInitial({
      ...EMPTY_INCOME_FORM,
      clientName: t.counterparty ?? "",
      invoiceNumber: ref,
      invoiceDate: t.date_completed ?? "",
      dueDate: t.date_completed ?? "",
      gross: String(t.amount),
      currency: "GBP",
      paid: "paid",
      kind,
    });
    setRecordOpen(true);
  }

  async function onRecorded() {
    // The new invoice's number = the bank reference, so the matcher links it.
    await (supabase as unknown as { rpc: (n: string) => Promise<unknown> }).rpc("match_bank_transactions").catch(() => {});
    await load();
  }

  async function importCsv(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = parseRevolutCsv(text);
      if (parsed.length === 0) { toast({ title: "No transactions found in that file", variant: "destructive" }); return; }
      // Convert foreign-pocket amounts to GBP (the GBP pocket is a no-op), then
      // drop the transient paymentCurrency before insert.
      const records = parsed.map(({ paymentCurrency, ...rec }) => ({
        ...rec,
        amount: paymentCurrency === "GBP" ? rec.amount : fx.gbp(rec.amount, paymentCurrency, rec.date_completed),
      }));
      // Upsert on the Revolut id, ignoring duplicates — new transactions land,
      // already-reviewed/categorised rows are left untouched.
      const countAll = async () => (await sb.from("bank_transactions").select("id", { count: "exact", head: true })).count ?? 0;
      const before = await countAll();
      const chunk = 200;
      for (let i = 0; i < records.length; i += chunk) {
        const { error } = await sb.from("bank_transactions").upsert(records.slice(i, i + chunk), { onConflict: "id", ignoreDuplicates: true });
        if (error) throw error;
      }
      const added = (await countAll()) - before;
      // Auto-match to invoices/overheads by reference + auto-categorise
      // expenses from remembered supplier mappings.
      await (supabase as unknown as { rpc: (n: string) => Promise<unknown> }).rpc("match_bank_transactions").catch(() => {});
      await applyCategoryMap();
      await load();
      toast({ title: added > 0 ? `Imported ${added} new transaction${added === 1 ? "" : "s"}` : "Already up to date — no new transactions" });
    } catch (e) {
      toast({ title: "Couldn't import the statement", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  async function load() {
    const [{ data: txns }, { data: c }] = await Promise.all([
      sb.from("bank_transactions").select("id, date_completed, type, description, reference, counterparty, amount, classification, category_code, matched_type, matched_id, status, reviewed").order("date_completed", { ascending: false }),
      sb.from("expense_categories").select("code, name").eq("active", true).order("code"),
    ]);
    const list = (txns ?? []) as BankTxn[];
    // Pull the matched records' amounts so we can flag discrepancies.
    const invIds = [...new Set(list.filter((r) => r.matched_type === "income_invoice" && r.matched_id).map((r) => r.matched_id!))];
    const ovhIds = [...new Set(list.filter((r) => r.matched_type === "overhead" && r.matched_id).map((r) => r.matched_id!))];
    const amt = new Map<string, number>();
    if (invIds.length) { const { data } = await sb.from("invoices").select("id, amount").in("id", invIds); for (const x of (data ?? []) as { id: string; amount: number }[]) amt.set(x.id, Number(x.amount)); }
    if (ovhIds.length) { const { data } = await sb.from("overheads").select("id, gross_amount").in("id", ovhIds); for (const x of (data ?? []) as { id: string; gross_amount: number }[]) amt.set(x.id, Number(x.gross_amount)); }
    for (const r of list) if (r.matched_id) r.matchedAmount = amt.get(r.matched_id) ?? null;
    setRows(list);
    setCats((c ?? []) as Cat[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function patch(id: string, fields: Partial<BankTxn>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)));
    const { error } = await sb.from("bank_transactions").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast({ title: "Couldn't save", description: error.message, variant: "destructive" }); load(); }
  }

  // Categorise an expense — and apply the same category to every other
  // uncategorised transaction with the same (normalised) counterparty, then
  // remember it so future imports auto-categorise. Clearing only affects the
  // one row.
  async function categorizeExpense(t: BankTxn, code: string) {
    if (!code) { patch(t.id, { category_code: null, reviewed: false }); return; }
    const key = normalizeSupplier(t.counterparty ?? t.description ?? "");
    const ids = key
      ? rows.filter((r) => r.classification === "expense" && !r.category_code && normalizeSupplier(r.counterparty ?? r.description ?? "") === key).map((r) => r.id)
      : [t.id];
    const targets = ids.length ? ids : [t.id];
    setRows((prev) => prev.map((r) => (targets.includes(r.id) ? { ...r, category_code: code, reviewed: true } : r)));
    const { error } = await sb.from("bank_transactions").update({ category_code: code, reviewed: true, updated_at: new Date().toISOString() }).in("id", targets);
    if (error) { toast({ title: "Couldn't save", description: error.message, variant: "destructive" }); load(); return; }
    if (key) sb.from("supplier_category_map").upsert({ supplier_normalized: key, category_code: code, updated_at: new Date().toISOString() }).then(() => {}, () => {});
    const cat = cats.find((c) => c.code === code);
    toast({ title: targets.length > 1 ? `Categorised ${targets.length} × “${t.counterparty ?? "similar"}” → ${cat?.name ?? code}` : `Categorised → ${cat?.name ?? code}` });
  }

  // Apply remembered supplier→category mappings to any uncategorised expenses
  // (used after an import so known suppliers auto-classify).
  async function applyCategoryMap() {
    const [{ data: map }, { data: exp }] = await Promise.all([
      sb.from("supplier_category_map").select("supplier_normalized, category_code"),
      sb.from("bank_transactions").select("id, counterparty, description").eq("classification", "expense").is("category_code", null),
    ]);
    const m = new Map((map ?? []).map((r: { supplier_normalized: string; category_code: string }) => [r.supplier_normalized, r.category_code]));
    const byCode: Record<string, string[]> = {};
    for (const r of (exp ?? []) as { id: string; counterparty: string | null; description: string | null }[]) {
      const c = m.get(normalizeSupplier(r.counterparty ?? r.description ?? ""));
      if (c) (byCode[c] ??= []).push(r.id);
    }
    for (const [code, ids] of Object.entries(byCode))
      for (let i = 0; i < ids.length; i += 200)
        await sb.from("bank_transactions").update({ category_code: code, reviewed: true, updated_at: new Date().toISOString() }).in("id", ids.slice(i, i + 200));
  }

  // Bank-truth P&L (trading only).
  const pnl = useMemo(() => {
    let income = 0, expenses = 0, fees = 0, excluded = 0, reviewCount = 0;
    for (const t of rows) {
      if (t.classification === "client_income" || t.classification === "ebay_resale" || t.classification === "refund") income += t.amount;
      else if (t.classification === "expense") expenses += t.amount;
      else if (t.classification === "bank_fee") fees += t.amount;
      else if (NON_TRADING.has(t.classification)) excluded += t.amount;
      if (FILTERS[0].test(t)) reviewCount++;
    }
    return { income, expenses, fees, net: income + expenses + fees, excluded, reviewCount };
  }, [rows]);

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const q = search.trim().toLowerCase();
    return rows.filter((t) => f.test(t) && (!q || (t.description ?? "").toLowerCase().includes(q) || (t.reference ?? "").toLowerCase().includes(q) || (t.counterparty ?? "").toLowerCase().includes(q)));
  }, [rows, filter, search]);

  return (
    <AdminLayout panel>
      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-px w-12 bg-gold-muted" />
          <span className="text-label-gold text-[#ecd39c]">Reconciliation</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={syncNow} disabled={syncing}
            className={`inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors ${syncing ? "bg-white/5 text-white/30" : "bg-gold/20 text-[#ecd39c] hover:bg-gold/30"}`}>
            {syncing ? <BrandLoader size="sm" className="h-3 w-3" /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />}
            {syncing ? "Syncing…" : "Sync from Revolut"}
          </button>
          <label className={`inline-flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors ${importing ? "border-white/10 text-white/30" : "border-white/15 text-white/45 hover:border-[#C9A96A]/50 hover:text-[#C9A96A]"}`} title="Manual fallback — the live sync above is the primary path">
            {importing ? <BrandLoader size="sm" className="h-3 w-3" /> : <UploadCloud className="h-3.5 w-3.5" strokeWidth={1.5} />}
            {importing ? "Importing…" : "CSV"}
            <input type="file" accept=".csv,text/csv" className="hidden" disabled={importing}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
          </label>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><BrandLoader size="md" /></div>
      ) : (
        <>
          {/* Bank-truth P&L */}
          <section className="ssr-zone mb-6">
            <div className="mb-5 flex items-center gap-3 border-b border-white/[0.07] pb-3">
              <div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Bank-truth position · from Revolut</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Income" value={pnl.income} tone="pos" />
              <Tile label="Expenses" value={pnl.expenses} tone="neg" />
              <Tile label="Bank fees" value={pnl.fees} tone="neg" />
              <Tile label="Net trading" value={pnl.net} tone={pnl.net < 0 ? "neg" : "pos"} hero />
            </div>
            <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-white/30">
              {money(pnl.excluded)} internal FX / financing excluded · indicative, pre-categorisation
            </p>
            <BankTruthChart rows={rows} />
          </section>

          {/* Feed + review */}
          <section className="ssr-zone">
            <div className="mb-4 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
              <div className="flex items-center gap-3"><div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Transactions</h2></div>
              {pnl.reviewCount > 0 && <span className="text-[10px] uppercase tracking-[0.2em] text-[#d8a184]">{pnl.reviewCount} need review</span>}
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              {FILTERS.map((f) => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={filter === f.key
                    ? "rounded-full bg-gold/20 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[#ecd39c]"
                    : "rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/45 hover:text-white/75"}>
                  {f.label}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-2 border-b border-white/15 px-1">
                <Search className="h-3 w-3 text-white/30" strokeWidth={1.5} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SEARCH"
                  className="w-40 bg-transparent py-1 text-[11px] uppercase tracking-[0.16em] text-standard placeholder:text-white/25 focus:outline-none" />
              </div>
            </div>

            {shown.length === 0 ? (
              <div className="ssr-tile p-10 text-center text-recessive text-sm">Nothing here — all clear.</div>
            ) : (
              <div className="ssr-tile overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-[10px] uppercase tracking-[0.18em] text-white/35">
                      <th className="px-3 py-3 text-left font-normal">Date</th>
                      <th className="px-3 py-3 text-left font-normal">Description</th>
                      <th className="px-3 py-3 text-left font-normal">Reference</th>
                      <th className="px-3 py-3 text-right font-normal">Amount</th>
                      <th className="px-3 py-3 text-left font-normal">Type</th>
                      <th className="px-3 py-3 text-right font-normal" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, 400).map((t) => (
                      <tr key={t.id} className={`border-b border-white/[0.05] last:border-0 ${t.reviewed ? "opacity-55" : ""}`}>
                        <td className="px-3 py-2.5 text-recessive whitespace-nowrap">{fmtDate(t.date_completed)}</td>
                        <td className="px-3 py-2.5 text-standard">
                          {t.description || t.counterparty || "—"}
                          {hasDiscrepancy(t) && (
                            <span className="ml-2 whitespace-nowrap text-[9px] uppercase tracking-[0.14em] text-[#d8a184]" title="Bank amount differs from the matched record">
                              ⚠ {money(Math.abs(t.amount))} vs {money(t.matchedAmount!)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-recessive text-[12px]">{t.reference || "—"}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${t.amount < 0 ? "text-strong" : "text-[#84b594]"}`}>{money(t.amount)}</td>
                        <td className={`px-3 py-2.5 text-[10px] uppercase tracking-[0.16em] ${classTone(t.classification)}`}>{CLASS_LABEL[t.classification] ?? t.classification}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {NON_TRADING.has(t.classification) ? (
                            <span className="text-[9px] uppercase tracking-[0.18em] text-white/25">excluded</span>
                          ) : t.classification === "expense" ? (
                            <select
                              value={t.category_code ?? ""}
                              onChange={(e) => categorizeExpense(t, e.target.value)}
                              className="max-w-[190px] rounded-sm border border-white/10 bg-[#1b1b1b] px-2 py-1 text-[11px] text-standard focus:border-[#C9A96A] focus:outline-none">
                              <option value="">Categorise…</option>
                              {cats.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                            </select>
                          ) : (t.classification === "client_income" || t.classification === "ebay_resale") && !t.matched_id ? (
                            <button onClick={() => recordAsIncome(t)} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">
                              <FilePlus2 className="h-3 w-3" strokeWidth={1.5} /> Record
                            </button>
                          ) : t.matched_id ? (
                            hasDiscrepancy(t)
                              ? <span className="text-[9px] uppercase tracking-[0.16em] text-[#d8a184]">review ⚠</span>
                              : <span className="text-[9px] uppercase tracking-[0.18em] text-[#84b594]">invoiced ✓</span>
                          ) : t.reviewed ? (
                            <button onClick={() => patch(t.id, { reviewed: false })} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-white/40 hover:text-white/70">
                              <Check className="h-3 w-3" strokeWidth={1.5} /> reviewed
                            </button>
                          ) : (
                            <button onClick={() => patch(t.id, { reviewed: true })} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]">
                              Confirm
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shown.length > 400 && <p className="p-3 text-center text-[10px] uppercase tracking-[0.2em] text-white/25">Showing first 400 of {shown.length} — narrow with a filter or search</p>}
              </div>
            )}
          </section>
        </>
      )}

      {recordInitial && (
        <IncomeInvoiceReviewDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          initial={recordInitial}
          sourceFile={null}
          onSaved={onRecorded}
        />
      )}
    </AdminLayout>
  );
}

function Tile({ label, value, tone, hero }: { label: string; value: number; tone: "pos" | "neg"; hero?: boolean }) {
  return (
    <div className="ssr-tile p-5">
      <p className="text-[9px] uppercase tracking-[0.28em] text-white/40">{label}</p>
      <p className={`mt-2 ${hero ? "ssr-figure-lg" : "ssr-figure"} ${tone === "pos" ? "text-[#84b594]" : "text-strong"}`}>{money(value)}</p>
    </div>
  );
}
