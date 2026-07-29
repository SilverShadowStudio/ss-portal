import { useEffect, useState } from "react";
import { Repeat, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Category { code: string; name: string }
interface Recurring {
  id: string; supplier_name: string; category_code: string | null; description: string | null;
  gross_amount: number; vat_amount: number; day_of_month: number;
  start_date: string; end_date: string | null; active: boolean;
}

const money = (n: number) => "£" + new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const num = (v: string) => { const n = parseFloat(String(v).replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0; };
const ord = (d: number) => `${d}${["th","st","nd","rd"][(d % 100 > 10 && d % 100 < 14) ? 0 : (d % 10 < 4 ? d % 10 : 0)]}`;

/**
 * Manage recurring overheads (rent, workspace, fixed software bills). A template
 * set once auto-creates each month's UNPAID overhead — and backfills arrears on
 * save, so past-due months land in Debts → Overheads immediately.
 */
export function RecurringOverheadsDialog({ categories, onChange }: { categories: Category[]; onChange: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Recurring[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [f, setF] = useState({ supplier_name: "", category_code: "", description: "", gross: "", vat: "0", day_of_month: "1", start_date: "", end_date: "" });

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("recurring_overheads")
      .select("id, supplier_name, category_code, description, gross_amount, vat_amount, day_of_month, start_date, end_date, active")
      .order("active", { ascending: false }).order("supplier_name");
    setRows((data ?? []) as Recurring[]);
    setLoading(false);
  }
  useEffect(() => { if (open) load(); }, [open]);

  async function save() {
    if (!f.supplier_name.trim()) { toast({ title: "Supplier is required", variant: "destructive" }); return; }
    const gross = num(f.gross);
    if (!(gross > 0)) { toast({ title: "Enter the monthly amount", variant: "destructive" }); return; }
    if (!f.start_date) { toast({ title: "Pick a start date (the month arrears begin)", variant: "destructive" }); return; }
    const day = Math.min(28, Math.max(1, parseInt(f.day_of_month, 10) || 1));
    const vat = num(f.vat);
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: inserted, error } = await supabase.from("recurring_overheads").insert({
        supplier_name: f.supplier_name.trim(),
        category_code: f.category_code || null,
        description: f.description.trim() || null,
        currency: "GBP",
        gross_amount: gross,
        vat_amount: vat,
        net_amount: Math.round((gross - vat) * 100) / 100,
        vat_treatment: vat > 0 ? "standard" : "zero",
        day_of_month: day,
        start_date: f.start_date,
        end_date: f.end_date || null,
        created_by: userData.user?.id ?? null,
      }).select("id").single();
      if (error) throw error;
      // Backfill arrears + current month right away.
      const { data: gen, error: genErr } = await supabase.functions.invoke("recurring-overheads-generate", {
        body: { recurring_overhead_id: inserted!.id },
      });
      if (genErr) throw genErr;
      const n = gen?.created ?? 0;
      toast({ title: "Recurring bill added", description: n > 0 ? `${n} month${n === 1 ? "" : "s"} created as unpaid — see Debts → Overheads.` : "Set up. Entries will appear as each month falls due." });
      setF({ supplier_name: "", category_code: "", description: "", gross: "", vat: "0", day_of_month: "1", start_date: "", end_date: "" });
      load();
      onChange();
    } catch (e) {
      toast({ title: "Couldn't add recurring bill", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(r: Recurring) {
    setBusyId(r.id);
    const { error } = await supabase.from("recurring_overheads").update({ active: !r.active }).eq("id", r.id);
    setBusyId(null);
    if (error) { toast({ title: "Couldn't update", description: error.message, variant: "destructive" }); return; }
    setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, active: !x.active } : x));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="flex items-center gap-1.5 text-sm text-gold hover:underline underline-offset-4">
          <Repeat className="h-3.5 w-3.5" strokeWidth={1.5} />Recurring bills
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg rounded-sm border-divider bg-background">
        <DialogHeader>
          <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Money out · Recurring</p>
          <DialogTitle className="font-serif font-normal text-2xl">Recurring bills</DialogTitle>
        </DialogHeader>

        {/* Existing templates */}
        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-6"><BrandLoader size="sm" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-recessive py-2">No recurring bills yet. Add one below.</p>
          ) : (
            rows.map((r) => (
              <div key={r.id} className={`flex items-center justify-between gap-3 rounded-sm border border-white/[0.07] px-3 py-2 ${r.active ? "" : "opacity-45"}`}>
                <div className="min-w-0">
                  <p className="text-sm text-strong truncate">{r.supplier_name}</p>
                  <p className="text-[11px] text-recessive">{money(r.gross_amount)} · {ord(r.day_of_month)} of the month{r.end_date ? " · ends " + r.end_date : ""}</p>
                </div>
                <button onClick={() => toggleActive(r)} disabled={busyId === r.id} className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/80">
                  {r.active ? "Pause" : "Resume"}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add form */}
        <div className="mt-2 border-t border-white/[0.07] pt-4">
          <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[#C9A96A]"><Plus className="h-3 w-3" strokeWidth={1.5} />Add a recurring bill</div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label>Supplier</Label>
              <Input value={f.supplier_name} onChange={(e) => setF((x) => ({ ...x, supplier_name: e.target.value }))} placeholder="Workspace 12 Limited" className="rounded-sm" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Category</Label>
              <Select value={f.category_code} onValueChange={(v) => setF((x) => ({ ...x, category_code: v }))}>
                <SelectTrigger className="rounded-sm"><SelectValue placeholder="Choose a category…" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount / month (gross £)</Label>
              <Input inputMode="decimal" value={f.gross} onChange={(e) => setF((x) => ({ ...x, gross: e.target.value }))} placeholder="1583.17" className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>of which VAT (£)</Label>
              <Input inputMode="decimal" value={f.vat} onChange={(e) => setF((x) => ({ ...x, vat: e.target.value }))} placeholder="263.86" className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Due day of month</Label>
              <Input inputMode="numeric" value={f.day_of_month} onChange={(e) => setF((x) => ({ ...x, day_of_month: e.target.value }))} placeholder="1" className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Starts (first month)</Label>
              <Input type="date" value={f.start_date} onChange={(e) => setF((x) => ({ ...x, start_date: e.target.value }))} className="rounded-sm" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Ends <span className="opacity-50">(optional)</span></Label>
              <Input type="date" value={f.end_date} onChange={(e) => setF((x) => ({ ...x, end_date: e.target.value }))} className="rounded-sm" />
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground/70">Backdate the start to create arrears now. Each month is added <strong>unpaid</strong>; mark them paid in Debts → Overheads. If you receive an invoice for a month, use the drop zone instead to keep exact figures.</p>
          <div className="mt-4 flex justify-end">
            <Button onClick={save} disabled={saving} className="rounded-sm">{saving ? "Adding…" : "Add & create entries"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
