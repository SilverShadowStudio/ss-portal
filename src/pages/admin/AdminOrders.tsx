import { useEffect, useState } from "react";
import { Plus, Trash2, Send, ChevronDown } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, formatDate } from "@/lib/invoiceUtils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Account {
  id: string;
  company_name: string;
}

interface OrderLine {
  description: string;
  quantity: number;
  unit_price: number;
  unit: string;
}

interface Order {
  id: string;
  order_number: string | null;
  title: string;
  status: string;
  order_type: string;
  total: number;
  currency: string;
  accepted_at: string | null;
  created_at: string;
  account_id: string;
  account_company?: string;
}

const VAT_RATE = 20;

function calcTotals(lines: OrderLine[]) {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const vat_amount = subtotal * (VAT_RATE / 100);
  const total = subtotal + vat_amount;
  return { subtotal, vat_amount, total };
}

// formatCurrency imported from @/lib/invoiceUtils — one implementation repo-wide.

// formatDate imported from @/lib/invoiceUtils — canonical "01 January 2000".

const STATUS_LABELS: Record<string, string> = {
  pending_acceptance: "Pending",
  accepted: "Accepted",
  in_production: "In Production",
  completed: "Completed",
  cancelled: "Cancelled",
};

function statusDot(status: string) {
  const colors: Record<string, string> = {
    pending_acceptance: "#C6A87A",
    accepted: "#22c55e",
    in_production: "#22c55e",
    completed: "#888",
    cancelled: "#444",
  };
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{ width: 7, height: 7, background: colors[status] || "#888" }}
    />
  );
}

// ── Create order form ─────────────────────────────────────────────────────────

function CreateOrderForm({
  accounts,
  onCreated,
}: {
  accounts: Account[];
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [accountId, setAccountId] = useState("");
  const [title, setTitle] = useState("");
  const [orderType, setOrderType] = useState<"project" | "subscription">("project");
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [lines, setLines] = useState<OrderLine[]>([
    { description: "", quantity: 1, unit_price: 0, unit: "units" },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const { subtotal, vat_amount, total } = calcTotals(lines);

  function addLine() {
    setLines((l) => [...l, { description: "", quantity: 1, unit_price: 0, unit: "units" }]);
  }

  function removeLine(i: number) {
    setLines((l) => l.filter((_, idx) => idx !== i));
  }

  function updateLine(i: number, field: keyof OrderLine, value: string | number) {
    setLines((l) => l.map((line, idx) => idx === i ? { ...line, [field]: value } : line));
  }

  async function handleSubmit() {
    if (!accountId || !title.trim()) {
      toast({ title: "Client and title are required.", variant: "destructive" });
      return;
    }
    if (lines.some((l) => !l.description.trim())) {
      toast({ title: "All line items need a description.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // Generate order number
      const date = new Date();
      const ref = `ORD-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${Math.floor(Math.random() * 900 + 100)}`;

      const { error } = await supabase.from("orders").insert({
        account_id: accountId,
        created_by: user!.id,
        order_number: ref,
        title: title.trim(),
        order_type: orderType,
        status: "pending_acceptance",
        lines,
        subtotal,
        vat_rate: VAT_RATE,
        vat_amount,
        total,
        currency,
        notes: notes.trim() || null,
      });
      if (error) throw error;
      toast({ title: "Order sent to client." });
      // Reset
      setAccountId("");
      setTitle("");
      setNotes("");
      setLines([{ description: "", quantity: 1, unit_price: 0, unit: "units" }]);
      onCreated();
    } catch (e: any) {
      toast({ title: "Failed to create order", description: e?.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "w-full bg-transparent border-b border-border/50 py-2 text-sm text-foreground focus:outline-none focus:border-gold transition-colors placeholder:text-foreground/25";
  const labelCls = "block text-[9px] uppercase tracking-[0.28em] text-foreground/40 mb-1.5";

  return (
    <div className="bg-card rounded-sm p-8 space-y-8">
      <h2 className="font-serif text-xl text-foreground">New Order</h2>

      {/* Client + type */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className={labelCls}>Client</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={inputCls}
          >
            <option value="">Select client…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.company_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Type</label>
          <select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as any)}
            className={inputCls}
          >
            <option value="project">Project</option>
            <option value="subscription">Subscription</option>
          </select>
        </div>
      </div>

      {/* Title */}
      <div>
        <label className={labelCls}>Order title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="45 Charles Street — 11 CGI Stills"
          className={inputCls}
        />
      </div>

      {/* Line items */}
      <div>
        <p className={labelCls}>Scope</p>
        <div className="space-y-3">
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-5">
                {i === 0 && <label className={labelCls}>Description</label>}
                <input
                  type="text"
                  value={line.description}
                  onChange={(e) => updateLine(i, "description", e.target.value)}
                  placeholder="CGI Still Visuals"
                  className={inputCls}
                />
              </div>
              <div className="col-span-2">
                {i === 0 && <label className={labelCls}>Qty</label>}
                <input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(e) => updateLine(i, "quantity", Number(e.target.value))}
                  className={inputCls}
                />
              </div>
              <div className="col-span-2">
                {i === 0 && <label className={labelCls}>Unit</label>}
                <input
                  type="text"
                  value={line.unit}
                  onChange={(e) => updateLine(i, "unit", e.target.value)}
                  placeholder="scenes"
                  className={inputCls}
                />
              </div>
              <div className="col-span-2">
                {i === 0 && <label className={labelCls}>Unit price (£)</label>}
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={line.unit_price}
                  onChange={(e) => updateLine(i, "unit_price", Number(e.target.value))}
                  className={inputCls}
                />
              </div>
              <div className="col-span-1 flex justify-end pb-2">
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    className="text-foreground/25 hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLine}
          className="mt-4 flex items-center gap-2 text-foreground/40 hover:text-foreground transition-colors"
          style={{ fontSize: 11, letterSpacing: "0.14em" }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          Add line
        </button>
      </div>

      {/* Totals */}
      <div className="border-t border-border/30 pt-4 space-y-1.5" style={{ fontSize: 12 }}>
        <div className="flex justify-between">
          <span className="text-foreground/45">Subtotal</span>
          <span className="tabular-nums">{formatCurrency(subtotal, currency)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-foreground/45">VAT 20%</span>
          <span className="tabular-nums">{formatCurrency(vat_amount, currency)}</span>
        </div>
        <div className="flex justify-between pt-2 border-t border-border/30 font-medium" style={{ fontSize: 14 }}>
          <span>Total</span>
          <span className="tabular-nums">{formatCurrency(total, currency)}</span>
        </div>
      </div>

      {/* Notes + currency */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <label className={labelCls}>Notes to client (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Payment: 40% on confirmation, 60% on delivery…"
            className="w-full bg-transparent border-b border-border/50 py-2 text-sm text-foreground focus:outline-none focus:border-gold transition-colors placeholder:text-foreground/25 resize-none"
          />
        </div>
        <div>
          <label className={labelCls}>Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={inputCls}
          >
            <option value="GBP">GBP £</option>
            <option value="EUR">EUR €</option>
            <option value="USD">USD $</option>
            <option value="AED">AED د.إ</option>
          </select>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="flex items-center gap-2 bg-foreground text-background font-sans uppercase hover:opacity-80 disabled:opacity-50 transition-opacity"
        style={{ height: 42, paddingLeft: 28, paddingRight: 28, fontSize: 11, letterSpacing: "0.28em" }}
      >
        {submitting ? (
          <><BrandLoader size="sm" className="h-3 w-3" /> Sending…</>
        ) : (
          <><Send className="h-3.5 w-3.5" strokeWidth={1.5} /> Send to client</>
        )}
      </button>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AdminOrders() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [{ data: accs }, { data: ords }] = await Promise.all([
        supabase.from("accounts").select("id, company_name").order("company_name"),
        supabase.from("orders").select("*").order("created_at", { ascending: false }),
      ]);
      setAccounts(accs || []);
      const accMap = Object.fromEntries((accs || []).map((a) => [a.id, a.company_name]));
      setOrders(
        (ords || []).map((o: any) => ({ ...o, account_company: accMap[o.account_id] || "—" }))
      );
    } catch (e: any) {
      toast({ title: "Failed to load data", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from("orders").update({ status }).eq("id", id);
    fetchAll();
  }

  const filtered = statusFilter === "all"
    ? orders
    : orders.filter((o) => o.status === statusFilter);

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-12 py-10 px-6">
        <div>
          <h1 className="font-serif text-3xl font-normal text-foreground">Orders</h1>
          <p className="mt-2 text-sm text-foreground/45">
            Create and manage client order confirmations.
          </p>
        </div>

        {/* Create form */}
        <CreateOrderForm accounts={accounts} onCreated={fetchAll} />

        {/* Orders list */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-serif text-xl text-foreground">All orders</h2>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent border-b border-border/50 text-sm text-foreground/60 focus:outline-none focus:border-gold transition-colors py-1"
            >
              <option value="all">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <BrandLoader size="md" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-16 text-foreground/35 text-sm">No orders.</p>
          ) : (
            <div className="space-y-1">
              {filtered.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center gap-5 py-4 border-t border-border/30"
                >
                  {statusDot(order.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{order.title}</p>
                    <p className="text-[10px] text-foreground/40 mt-0.5 uppercase tracking-wider">
                      {(order as any).account_company}
                      <span className="mx-2 opacity-40">·</span>
                      {formatDate(order.created_at)}
                    </p>
                  </div>
                  <p className="text-sm tabular-nums text-foreground/70 shrink-0">
                    {formatCurrency(order.total, order.currency)}
                  </p>
                  {/* Status changer */}
                  <div className="relative shrink-0">
                    <select
                      value={order.status}
                      onChange={(e) => updateStatus(order.id, e.target.value)}
                      className="appearance-none bg-transparent border border-border/40 rounded-sm text-[10px] uppercase tracking-wider text-foreground/60 py-1 pl-3 pr-7 focus:outline-none focus:border-gold cursor-pointer"
                    >
                      {Object.entries(STATUS_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40"
                      style={{ width: 10, height: 10 }}
                      strokeWidth={1.5}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
