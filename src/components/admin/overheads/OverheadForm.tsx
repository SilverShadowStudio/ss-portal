import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { normalizeSupplier } from "@/lib/supplierNormalize";
import { friendlyDbError, isDuplicateError } from "@/lib/dbErrors";
import {
  computeVat,
  computeReverseChargeVat,
  formatCurrency,
  formatDate,
  VAT_TREATMENT_LABELS,
  VAT_TREATMENT_ORDER,
  type ExpenseCategory,
  type Overhead,
  type VatTreatment,
} from "@/lib/finance";

// ISO date I/O for HTML/DB compatibility: form fields carry "YYYY-MM-DD"
// strings; Calendar works in Date objects. Local time avoids the TZ shift
// that comes from d.toISOString() when the machine is behind UTC.
function isoDateString(d: Date | undefined): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDate(s: string): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

interface OverheadFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial: Overhead | null;
  /** Optional create-mode seed. Ignored when mode="edit". Parent must
   *  keep a stable reference (state, not a fresh object literal) or the
   *  seeding effect will re-fire on every render. */
  defaultValues?: Partial<Overhead> | null;
  categories: ExpenseCategory[];
  onSaved: () => void;
  /** When set (e.g. "2 of 7"), shows a bulk-review position in the header. */
  queueLabel?: string | null;
  /** Why this drop stopped for review instead of filing itself — e.g.
   *  "no invoice number and first invoice from this supplier". */
  reviewReason?: string | null;
  /** Staging path of the dropped file. When set, the document is shown above
   *  the fields: reserved for the case where the figures don't reconcile AND
   *  there's no history with this supplier, so the extracted values alone
   *  aren't worth trusting. */
  previewStagingPath?: string | null;
}

interface FormState {
  supplier_name: string;
  category_code: string;
  currency: string;
  description: string;
  net_amount: string;
  vat_treatment: VatTreatment;
  vat_amount: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  payment_date: string;
  is_reverse_charge: boolean;
  reverse_charge_vat: string;
  notes: string;
}

const EMPTY: FormState = {
  supplier_name: "",
  category_code: "",
  currency: "GBP",
  description: "",
  net_amount: "",
  vat_treatment: "standard",
  vat_amount: "0",
  invoice_number: "",
  invoice_date: "",
  due_date: "",
  payment_date: "",
  is_reverse_charge: false,
  reverse_charge_vat: "0",
  notes: "",
};

function fromOverhead(o: Overhead): FormState {
  return {
    supplier_name: o.supplier_name,
    category_code: o.category_code ?? "",
    currency: o.currency || "GBP",
    description: o.description ?? "",
    net_amount: String(o.net_amount ?? ""),
    vat_treatment: o.vat_treatment,
    vat_amount: String(o.vat_amount ?? 0),
    invoice_number: o.invoice_number ?? "",
    invoice_date: o.invoice_date ?? "",
    due_date: o.due_date ?? "",
    payment_date: o.payment_date ?? "",
    is_reverse_charge: o.is_reverse_charge,
    reverse_charge_vat: String(o.reverse_charge_vat ?? 0),
    notes: o.notes ?? "",
  };
}

function fromDefaults(v: Partial<Overhead>): FormState {
  return {
    supplier_name: v.supplier_name ?? "",
    category_code: v.category_code ?? "",
    currency: v.currency || "GBP",
    description: v.description ?? "",
    net_amount: v.net_amount != null ? String(v.net_amount) : "",
    vat_treatment: v.vat_treatment ?? "standard",
    vat_amount: v.vat_amount != null ? String(v.vat_amount) : "0",
    invoice_number: v.invoice_number ?? "",
    invoice_date: v.invoice_date ?? "",
    due_date: v.due_date ?? "",
    payment_date: v.payment_date ?? "",
    is_reverse_charge: v.is_reverse_charge ?? false,
    reverse_charge_vat: v.reverse_charge_vat != null ? String(v.reverse_charge_vat) : "0",
    notes: v.notes ?? "",
  };
}

export function OverheadForm({
  open,
  onOpenChange,
  mode,
  initial,
  defaultValues,
  categories,
  onSaved,
  queueLabel,
  reviewReason,
  previewStagingPath,
}: OverheadFormProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [invoiceDateOpen, setInvoiceDateOpen] = useState(false);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [paymentDateOpen, setPaymentDateOpen] = useState(false);
  // Which treatment you've explicitly kept against the category's default.
  // Stored as the treatment itself, not a boolean: dismissing the warning for
  // zero-rated must not silently suppress it if you later pick something else.
  const [acceptedVatTreatment, setAcceptedVatTreatment] = useState<VatTreatment | null>(null);
  // Staging storage path is metadata (not user-editable), carried through
  // from defaultValues into the insert payload without polluting FormState.
  const stagingStoragePathRef = useRef<string | null>(null);
  // Same idea for the supplier's bank details: read off the invoice, not
  // user-editable here, but they must survive the review gate or a reviewed
  // invoice would reach Money Out with no way to pay it.
  const bankDetailsRef = useRef<Record<string, unknown>>({});
  const { toast } = useToast();

  // Reset form whenever the dialog opens (create) or the initial changes (edit).
  // In create mode, an optional defaultValues seeds the form (e.g. from an
  // extracted-invoice drop zone).
  useEffect(() => {
    if (!open) return;
    // A VAT deviation accepted on the last invoice must not carry into the next
    // one in the queue.
    setAcceptedVatTreatment(null);
    if (mode === "edit" && initial) {
      setForm(fromOverhead(initial));
      stagingStoragePathRef.current = null;
      bankDetailsRef.current = {};
    } else if (mode === "create" && defaultValues) {
      setForm(fromDefaults(defaultValues));
      stagingStoragePathRef.current = defaultValues.staging_storage_path ?? null;
      bankDetailsRef.current = {
        supplier_iban: defaultValues.supplier_iban ?? null,
        supplier_account_number: defaultValues.supplier_account_number ?? null,
        supplier_sort_code: defaultValues.supplier_sort_code ?? null,
        supplier_bic: defaultValues.supplier_bic ?? null,
        payment_reference: defaultValues.payment_reference ?? null,
      };
    } else {
      setForm(EMPTY);
      stagingStoragePathRef.current = null;
      bankDetailsRef.current = {};
    }
  }, [open, mode, initial, defaultValues]);

  // Signed URL for the staged document, minted only when the parent asks for a
  // preview. The file isn't an overhead yet, so it's read straight out of the
  // staging bucket rather than through overhead-file-preview.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !previewStagingPath) { setPreviewUrl(null); return; }
    let cancelled = false;
    void supabase.storage
      .from("overhead-invoices")
      .createSignedUrl(previewStagingPath, 600)
      .then(({ data }) => { if (!cancelled) setPreviewUrl(data?.signedUrl ?? null); });
    return () => { cancelled = true; };
  }, [open, previewStagingPath]);

  const currencySymbol =
    form.currency === "EUR" ? "€" : form.currency === "USD" ? "$" : "£";

  const net = parseFloat(form.net_amount) || 0;
  const vatAmount = parseFloat(form.vat_amount) || 0;
  const reverseChargeVat = parseFloat(form.reverse_charge_vat) || 0;
  const grossAmount = form.is_reverse_charge ? net : net + vatAmount;

  const selectedCategory = useMemo(
    () => categories.find((c) => c.code === form.category_code) ?? null,
    [categories, form.category_code],
  );

  // Recompute VAT amount when net or treatment changes (both in normal mode).
  // In reverse-charge mode, vat_amount stays 0 and reverse_charge_vat tracks net×20%.
  // "mixed" treatment SKIPS auto-compute so an explicit vat_amount survives
  // (partial-VAT invoices — e.g. Deliveroo where only a service fee is VATable).
  useEffect(() => {
    if (form.is_reverse_charge) {
      setForm((f) => ({
        ...f,
        vat_amount: "0",
        reverse_charge_vat: String(computeReverseChargeVat(net).toFixed(2)),
      }));
    } else if (form.vat_treatment !== "mixed") {
      const { vat } = computeVat(net, form.vat_treatment);
      setForm((f) => ({ ...f, vat_amount: String(vat.toFixed(2)) }));
    }
    // Intentionally NOT depending on form.vat_amount / form.reverse_charge_vat —
    // those are the outputs of this effect; adding them would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.net_amount, form.vat_treatment, form.is_reverse_charge]);

  const deviatesFromDefault =
    selectedCategory != null &&
    !form.is_reverse_charge &&
    form.vat_treatment !== selectedCategory.default_vat_treatment &&
    form.vat_treatment !== acceptedVatTreatment;

  function handleCategoryChange(code: string) {
    const cat = categories.find((c) => c.code === code);
    setForm((f) => ({
      ...f,
      category_code: code,
      vat_treatment: cat?.default_vat_treatment ?? f.vat_treatment,
    }));
  }

  function handleReverseChargeToggle(on: boolean) {
    setForm((f) => ({
      ...f,
      is_reverse_charge: on,
      vat_treatment: on ? "reverse_charge" : (selectedCategory?.default_vat_treatment ?? "standard"),
    }));
  }

  async function handleSave() {
    if (!form.supplier_name.trim()) {
      toast({ title: "Supplier name required", variant: "destructive" });
      return;
    }
    if (!form.category_code) {
      toast({ title: "Category required", variant: "destructive" });
      return;
    }
    if (!form.invoice_date) {
      toast({ title: "Invoice date required (tax point)", variant: "destructive" });
      return;
    }
    if (form.net_amount === "" || isNaN(parseFloat(form.net_amount))) {
      toast({ title: "Net amount required", variant: "destructive" });
      return;
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      supplier_name: form.supplier_name.trim(),
      category_code: form.category_code,
      description: form.description.trim() || null,
      // Carried from the document, never assumed. Stamping every invoice GBP
      // silently converted EUR and USD bills into pounds at 1:1.
      currency: form.currency || "GBP",
      net_amount: net,
      vat_amount: form.is_reverse_charge ? 0 : vatAmount,
      gross_amount: grossAmount,
      vat_treatment: form.vat_treatment,
      invoice_number: form.invoice_number.trim() || null,
      invoice_date: form.invoice_date,
      due_date: form.due_date || null,
      payment_date: form.payment_date || null,
      payment_status: form.payment_date ? "paid" : "unpaid",
      is_reverse_charge: form.is_reverse_charge,
      reverse_charge_vat: form.is_reverse_charge ? reverseChargeVat : 0,
      notes: form.notes.trim() || null,
    };

    let error;
    if (mode === "edit" && initial) {
      ({ error } = await supabase.from("overheads" as any).update(payload).eq("id", initial.id));
    } else {
      const { data: userData } = await supabase.auth.getUser();
      payload.created_by = userData.user?.id ?? null;
      // "manual" for hand-typed rows; "dropzone" when the row was seeded from
      // an extracted invoice that also staged a file (Pass 3 will file it).
      payload.source = stagingStoragePathRef.current ? "dropzone" : "manual";
      if (stagingStoragePathRef.current) {
        payload.staging_storage_path = stagingStoragePathRef.current;
      }
      Object.assign(payload, bankDetailsRef.current);
      ({ error } = await supabase.from("overheads" as any).insert(payload));
    }

    setSaving(false);
    if (error) {
      // Already recorded (same supplier + invoice number) — don't block the
      // bulk review; just say so and move straight on to the next invoice.
      if (isDuplicateError(error.message)) {
        toast({
          title: "Already recorded — skipped",
          description: `${form.supplier_name.trim() || "This invoice"}${form.invoice_number.trim() ? ` (${form.invoice_number.trim()})` : ""} is already in your books.`,
        });
        onOpenChange(false); // advances the review queue (and cleans the staged file)
        return;
      }
      toast({
        title: mode === "edit" ? "Couldn't update this expense" : "Couldn't record this expense",
        description: friendlyDbError(error.message),
        variant: "destructive",
      });
      return;
    }

    // Remember supplier→category mapping so future extractions from the same
    // supplier pre-fill this category. Fire-and-forget; a failure just means
    // Fred picks the category again next time. Runs for both create AND edit
    // so a re-categorised row updates the memory too.
    if (form.supplier_name.trim() && form.category_code) {
      const key = normalizeSupplier(form.supplier_name);
      if (key) {
        const { data: userData } = await supabase.auth.getUser();
        void supabase.from("supplier_category_map" as any).upsert({
          supplier_normalized: key,
          category_code: form.category_code,
          updated_by: userData.user?.id ?? null,
          updated_at: new Date().toISOString(),
        });
      }
    }

    toast({ title: mode === "edit" ? "Expense updated" : "Expense recorded" });
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The modal is a page: panel gradient, 22px radius, the portal's 34px
          inset. Its three tiers are panel → zone → tile, same as everywhere. */}
      <DialogContent className="ssr-panel--dialog max-w-[720px] max-h-[90vh] overflow-y-auto" hideClose>
        <DialogHeader className="mb-5 block space-y-0 text-left">
          <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">
            {mode === "edit" ? "Edit expense" : "New expense"}
            {queueLabel && <span className="ml-2 text-[#C9A96A]">· reviewing {queueLabel}</span>}
          </p>
          <DialogTitle className="mt-2 font-serif font-normal text-2xl">
            {mode === "edit" ? initial?.supplier_name || "Expense" : "Record an expense"}
          </DialogTitle>
        </DialogHeader>

        {/* The same gold sweep a flagged table row gets — one vocabulary for
            "this one needs your eye", whether it's a row or a dialog. */}
        {reviewReason && (
          <p className="mb-4 rounded-xl py-3 pl-4 pr-4 font-sans text-[11.5px] leading-relaxed text-[#ecd39c] ssr-row-sweep" data-open="true">
            <b className="font-medium text-[#f4e2bb]">Stopped for you to check</b> — {reviewReason}.{" "}
            <span className="text-[#ecd39c]/55">Everything else was filed without asking.</span>
          </p>
        )}

        {previewUrl && (
          <div className="mb-4 overflow-hidden rounded-xl bg-black/25">
            {/\.(jpe?g|png)$/i.test(previewStagingPath ?? "") ? (
              <img src={previewUrl} alt="Dropped invoice" className="max-h-[38vh] w-full object-contain" />
            ) : (
              <iframe src={previewUrl} title="Dropped invoice" className="h-[38vh] w-full" />
            )}
          </div>
        )}

        <div>
          {/* ── Zone 1 ─────────────────────────────────────────────────── */}
          <div className="ssr-zone">
          <ZoneTitle>Who and what</ZoneTitle>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Field label="Supplier">
              <Input
                value={form.supplier_name}
                onChange={(e) => setForm((f) => ({ ...f, supplier_name: e.target.value }))}
                className="ssr-field"
              />
            </Field>
            <Field label="Category">
              <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    role="combobox"
                    aria-expanded={categoryOpen}
                    className="ssr-field flex w-full items-center justify-between text-sm text-left"
                  >
                    <span className={selectedCategory ? "text-standard" : "text-muted-foreground"}>
                      {selectedCategory
                        ? `${selectedCategory.code} — ${selectedCategory.name}`
                        : "Choose…"}
                    </span>
                    <span aria-hidden className="ml-2 text-recessive">▾</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[var(--radix-popover-trigger-width)] p-0 rounded-sm border-divider z-[200]"
                >
                  <Command
                    filter={(value, search) => {
                      // cmdk lower-cases both; substring match on "code name" wins
                      // for typing either the code ("445") or any part of the name.
                      return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
                    }}
                  >
                    <CommandInput placeholder="Search code or name…" />
                    <CommandList>
                      <CommandEmpty>No category.</CommandEmpty>
                      <CommandGroup>
                        {categories
                          .filter((c) => c.active)
                          .map((c) => (
                            <CommandItem
                              key={c.code}
                              value={`${c.code} ${c.name}`}
                              onSelect={() => {
                                handleCategoryChange(c.code);
                                setCategoryOpen(false);
                              }}
                            >
                              <span className="text-recessive tabular-nums w-10 shrink-0">
                                {c.code}
                              </span>
                              <span className="text-standard">{c.name}</span>
                              {form.category_code === c.code && (
                                <span aria-hidden className="ml-auto text-gold">✓</span>
                              )}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Description">
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="ssr-field"
              />
            </Field>
          </div>
          </div>

          {/* ── Zone 2 ─────────────────────────────────────────────────── */}
          <div className="ssr-zone">
          <ZoneTitle>The money</ZoneTitle>
          {/* Currency sits first: it decides what every figure below it means.
              Read off the document, correctable — getting it wrong misstates
              the cost and would send the wrong amount. */}
          <div className="grid grid-cols-4 gap-x-6 gap-y-4">
            <Field label="Currency">
              <Select
                value={form.currency}
                onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
              >
                <SelectTrigger className="ssr-field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  <SelectItem value="GBP">GBP — £</SelectItem>
                  <SelectItem value="EUR">EUR — €</SelectItem>
                  <SelectItem value="USD">USD — $</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={`Net (${currencySymbol})`}>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.net_amount}
                onChange={(e) => setForm((f) => ({ ...f, net_amount: e.target.value }))}
                className="ssr-field"
              />
            </Field>
            <Field label="VAT treatment">
              <Select
                value={form.vat_treatment}
                onValueChange={(v) => setForm((f) => ({ ...f, vat_treatment: v as VatTreatment }))}
                disabled={form.is_reverse_charge}
              >
                <SelectTrigger className="ssr-field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {VAT_TREATMENT_ORDER.map((t) => (
                    <SelectItem key={t} value={t}>
                      {VAT_TREATMENT_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={`VAT amount (${currencySymbol})`}>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.vat_amount}
                onChange={(e) => setForm((f) => ({ ...f, vat_amount: e.target.value }))}
                disabled={form.is_reverse_charge}
                className="ssr-field"
              />
            </Field>
          </div>

          {/* The old copy ended "Confirm?" with nothing to confirm — a question
              the screen asked and gave you no way to answer. Both choices now
              act. */}
          {deviatesFromDefault && selectedCategory && !form.is_reverse_charge && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-gold-muted">
              {selectedCategory.name} is normally{" "}
              {VAT_TREATMENT_LABELS[selectedCategory.default_vat_treatment]}.{" "}
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, vat_treatment: selectedCategory.default_vat_treatment }))}
                className="text-[#ecd39c] underline underline-offset-[3px] hover:text-white"
              >
                Use {VAT_TREATMENT_LABELS[selectedCategory.default_vat_treatment]}
              </button>
              {" · "}
              <button
                type="button"
                onClick={() => setAcceptedVatTreatment(form.vat_treatment)}
                className="text-[#ecd39c] underline underline-offset-[3px] hover:text-white"
              >
                Keep {VAT_TREATMENT_LABELS[form.vat_treatment]}
              </button>
            </p>
          )}

          {/* Tier 3 — the one piece of real data on the screen. It shows its own
              arithmetic so a wrong total is traceable without re-reading the
              fields above it. */}
          <div className="ssr-tile mt-5 flex items-baseline justify-between gap-4 px-5 py-4">
            <div>
              <span className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Gross</span>
              <p className="mt-1 text-[10.5px] text-foreground/34">
                {form.is_reverse_charge
                  ? "You pay the net; the VAT is accounted both ways"
                  : `Net ${formatCurrency(net, form.currency || "GBP")} + VAT ${formatCurrency(vatAmount, form.currency || "GBP")}`}
              </p>
            </div>
            <span className="font-serif text-2xl text-strong tabular-nums">
              {formatCurrency(grossAmount, form.currency || "GBP")}
            </span>
          </div>

          {/* Reverse charge — a switch, not a bordered card inside a zone */}
          <div className="mt-4 border-t border-white/[0.07] pt-4">
            <div className="flex items-center gap-3">
              <Switch
                id="rc-toggle"
                checked={form.is_reverse_charge}
                onCheckedChange={handleReverseChargeToggle}
              />
              <Label htmlFor="rc-toggle" className="cursor-pointer text-[13px]">
                Reverse charge
              </Label>
              {form.is_reverse_charge && (
                <span className="ml-auto text-[11px] text-foreground/33">
                  Flagged for the accountant — out of the input-VAT figure
                </span>
              )}
            </div>
            {form.is_reverse_charge && (
              <div className="mt-4 grid grid-cols-4 gap-x-6">
                <Field label={`Self-accounted VAT (${currencySymbol})`}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={form.reverse_charge_vat}
                    onChange={(e) => setForm((f) => ({ ...f, reverse_charge_vat: e.target.value }))}
                    className="ssr-field"
                  />
                </Field>
                <p className="col-span-3 self-end pb-1 text-[11px] leading-relaxed text-foreground/33">
                  Net × 20% by default. Stored for reporting, excluded from the
                  cash-basis input-VAT figure.
                </p>
              </div>
            )}
          </div>
          </div>

          {/* ── Zone 3 ─────────────────────────────────────────────────── */}
          <div className="ssr-zone">
          <ZoneTitle>The paperwork</ZoneTitle>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Field label="Invoice number">
              <Input
                value={form.invoice_number}
                onChange={(e) => setForm((f) => ({ ...f, invoice_number: e.target.value }))}
                className="rounded-sm"
              />
            </Field>
            <Field label="Invoice date (tax point)">
              <DatePickerButton
                value={form.invoice_date}
                open={invoiceDateOpen}
                onOpenChange={setInvoiceDateOpen}
                onSelect={(iso) => setForm((f) => ({ ...f, invoice_date: iso }))}
                placeholder="Pick a date"
              />
            </Field>
            <Field label="Due date">
              <DatePickerButton
                value={form.due_date}
                open={dueDateOpen}
                onOpenChange={setDueDateOpen}
                onSelect={(iso) => setForm((f) => ({ ...f, due_date: iso }))}
                placeholder="—"
                clearable
              />
            </Field>
            <Field label="Payment date">
              <DatePickerButton
                value={form.payment_date}
                open={paymentDateOpen}
                onOpenChange={setPaymentDateOpen}
                onSelect={(iso) => setForm((f) => ({ ...f, payment_date: iso }))}
                placeholder="Blank — unpaid"
                clearable
              />
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Notes">
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Anything you'll want to remember in a year"
                className="ssr-field min-h-[70px] resize-y leading-relaxed"
              />
            </Field>
          </div>
          </div>
        </div>

        {/* Actions — text CTAs, no filled rectangles, no icons */}
        <div className="mt-6 flex items-center justify-end gap-6">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="text-sm text-recessive hover:text-standard transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-sm text-gold hover:underline underline-offset-4 disabled:opacity-50"
          >
            {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Record expense"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Tier 2's heading. Left-aligned, like every column title in the portal. */
function ZoneTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-left text-[9px] uppercase tracking-[0.22em] text-foreground/42">
      {children}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

interface DatePickerButtonProps {
  value: string; // "YYYY-MM-DD" or ""
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (iso: string) => void;
  placeholder: string;
  clearable?: boolean;
}

function DatePickerButton({
  value,
  open,
  onOpenChange,
  onSelect,
  placeholder,
  clearable,
}: DatePickerButtonProps) {
  const selected = parseIsoDate(value);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ssr-field flex w-full items-center justify-between text-left text-sm"
        >
          <span className={value ? "text-standard" : "text-muted-foreground"}>
            {value ? formatDate(value) : placeholder}
          </span>
          <span aria-hidden className="ml-2 text-[10px] text-recessive">▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0 rounded-sm border-divider z-[200]"
      >
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            onSelect(isoDateString(d));
            onOpenChange(false);
          }}
          initialFocus
        />
        {clearable && value && (
          <div className="flex justify-end border-t border-divider p-2">
            <button
              type="button"
              onClick={() => {
                onSelect("");
                onOpenChange(false);
              }}
              className="text-xs text-recessive hover:text-standard transition-colors"
            >
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
