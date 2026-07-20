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
}

interface FormState {
  supplier_name: string;
  category_code: string;
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
}: OverheadFormProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [invoiceDateOpen, setInvoiceDateOpen] = useState(false);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [paymentDateOpen, setPaymentDateOpen] = useState(false);
  // Staging storage path is metadata (not user-editable), carried through
  // from defaultValues into the insert payload without polluting FormState.
  const stagingStoragePathRef = useRef<string | null>(null);
  const { toast } = useToast();

  // Reset form whenever the dialog opens (create) or the initial changes (edit).
  // In create mode, an optional defaultValues seeds the form (e.g. from an
  // extracted-invoice drop zone).
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initial) {
      setForm(fromOverhead(initial));
      stagingStoragePathRef.current = null;
    } else if (mode === "create" && defaultValues) {
      setForm(fromDefaults(defaultValues));
      stagingStoragePathRef.current = defaultValues.staging_storage_path ?? null;
    } else {
      setForm(EMPTY);
      stagingStoragePathRef.current = null;
    }
  }, [open, mode, initial, defaultValues]);

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
  useEffect(() => {
    if (form.is_reverse_charge) {
      setForm((f) => ({
        ...f,
        vat_amount: "0",
        reverse_charge_vat: String(computeReverseChargeVat(net).toFixed(2)),
      }));
    } else {
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
    form.vat_treatment !== selectedCategory.default_vat_treatment;

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
      currency: "GBP",
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
      ({ error } = await supabase.from("overheads" as any).insert(payload));
    }

    setSaving(false);
    if (error) {
      toast({
        title: mode === "edit" ? "Update failed" : "Create failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: mode === "edit" ? "Expense updated" : "Expense recorded" });
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-sm border-divider bg-background"
        hideClose
      >
        <DialogHeader>
          <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">
            {mode === "edit" ? "Edit expense" : "New expense"}
          </p>
          <DialogTitle className="font-serif font-normal text-2xl">
            {mode === "edit" ? initial?.supplier_name || "Expense" : "Record an expense"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          {/* Supplier + category */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Supplier">
              <Input
                value={form.supplier_name}
                onChange={(e) => setForm((f) => ({ ...f, supplier_name: e.target.value }))}
                className="rounded-sm"
              />
            </Field>
            <Field label="Category">
              <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    role="combobox"
                    aria-expanded={categoryOpen}
                    className="flex h-10 w-full items-center justify-between rounded-sm border border-input bg-background px-3 py-2 text-sm text-left ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
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

          <Field label="Description">
            <Input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="rounded-sm"
            />
          </Field>

          {/* Net / treatment / VAT */}
          <div className="grid grid-cols-3 gap-4">
            <Field label="Net (£)">
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.net_amount}
                onChange={(e) => setForm((f) => ({ ...f, net_amount: e.target.value }))}
                className="rounded-sm"
              />
            </Field>
            <Field label="VAT treatment">
              <Select
                value={form.vat_treatment}
                onValueChange={(v) => setForm((f) => ({ ...f, vat_treatment: v as VatTreatment }))}
                disabled={form.is_reverse_charge}
              >
                <SelectTrigger className="rounded-sm">
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
            <Field label="VAT amount (£)">
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.vat_amount}
                onChange={(e) => setForm((f) => ({ ...f, vat_amount: e.target.value }))}
                disabled={form.is_reverse_charge}
                className="rounded-sm"
              />
            </Field>
          </div>

          {deviatesFromDefault && selectedCategory && (
            <p className="text-xs text-gold-muted">
              {selectedCategory.name} is normally {VAT_TREATMENT_LABELS[selectedCategory.default_vat_treatment]}. Confirm?
            </p>
          )}

          {/* Gross readout */}
          <div className="flex items-baseline justify-between border-t border-divider pt-3">
            <span className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Gross</span>
            <span className="font-serif text-xl text-strong">{formatCurrency(grossAmount)}</span>
          </div>

          {/* Reverse charge */}
          <div className="flex items-start justify-between gap-4 border border-divider rounded-sm p-4">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <Switch
                  id="rc-toggle"
                  checked={form.is_reverse_charge}
                  onCheckedChange={handleReverseChargeToggle}
                />
                <Label htmlFor="rc-toggle" className="text-sm cursor-pointer">
                  Reverse charge
                </Label>
              </div>
              {form.is_reverse_charge && (
                <p className="mt-2 text-xs text-gold-muted">
                  Flagged for accountant. Excluded from the cash-basis input-VAT figure.
                  The notional self-accounted VAT below (net × 20% by default) is stored
                  for reporting.
                </p>
              )}
            </div>
            {form.is_reverse_charge && (
              <div className="w-40">
                <Label className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">
                  Self-acc. VAT (£)
                </Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={form.reverse_charge_vat}
                  onChange={(e) => setForm((f) => ({ ...f, reverse_charge_vat: e.target.value }))}
                  className="rounded-sm mt-1"
                />
              </div>
            )}
          </div>

          {/* Invoice + dates */}
          <div className="grid grid-cols-2 gap-4">
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
            <Field label="Payment date (blank = unpaid)">
              <DatePickerButton
                value={form.payment_date}
                open={paymentDateOpen}
                onOpenChange={setPaymentDateOpen}
                onSelect={(iso) => setForm((f) => ({ ...f, payment_date: iso }))}
                placeholder="—"
                clearable
              />
            </Field>
          </div>

          <Field label="Notes">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="rounded-sm min-h-[80px]"
            />
          </Field>
        </div>

        {/* Actions — text CTAs, no filled rectangles, no icons */}
        <div className="flex items-center justify-end gap-6 border-t border-divider pt-4">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">{label}</Label>
      <div className="mt-1">{children}</div>
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
          className="flex h-10 w-full items-center justify-between rounded-sm border border-input bg-background px-3 py-2 text-sm text-left ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <span className={value ? "text-standard" : "text-muted-foreground"}>
            {value ? formatDate(value) : placeholder}
          </span>
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
