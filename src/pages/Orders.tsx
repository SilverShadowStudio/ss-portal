import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Clock, AlertCircle, ChevronRight, FileText } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { ClientLayout } from "@/components/ClientLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrderLine {
  description: string;
  quantity: number;
  unit_price: number;
  unit?: string;
}

interface Order {
  id: string;
  order_number: string | null;
  reference: string | null;
  title: string;
  status: "pending_acceptance" | "accepted" | "in_production" | "completed" | "cancelled";
  order_type: "subscription" | "project";
  lines: OrderLine[];
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  currency: string;
  notes: string | null;
  accepted_at: string | null;
  created_at: string;
  invoice_id: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency = "GBP") {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function statusConfig(status: Order["status"]) {
  switch (status) {
    case "pending_acceptance":
      return { label: "Awaiting your confirmation", icon: AlertCircle, color: "hsl(var(--gold))" };
    case "accepted":
      return { label: "Confirmed", icon: CheckCircle2, color: "hsl(142 71% 45%)" };
    case "in_production":
      return { label: "In production", icon: Clock, color: "hsl(142 71% 45%)" };
    case "completed":
      return { label: "Completed", icon: CheckCircle2, color: "hsl(var(--foreground) / 0.35)" };
    case "cancelled":
      return { label: "Cancelled", icon: AlertCircle, color: "hsl(var(--foreground) / 0.25)" };
    default:
      return { label: status, icon: Clock, color: "hsl(var(--foreground) / 0.35)" };
  }
}

// ── Order detail modal ─────────────────────────────────────────────────────────

function OrderModal({
  order,
  onClose,
  onAccept,
  accepting,
}: {
  order: Order;
  onClose: () => void;
  onAccept: (id: string) => void;
  accepting: boolean;
}) {
  const isPending = order.status === "pending_acceptance";
  const sc = statusConfig(order.status);
  const Icon = sc.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full md:max-w-lg bg-card border border-border/60 md:rounded-sm overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh", overflowY: "auto" }}
      >
        {/* Header */}
        <div className="px-8 pt-10 pb-6 border-b border-border/30">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p
                className="font-sans uppercase mb-2"
                style={{ fontSize: 9, letterSpacing: "0.3em", color: "hsl(var(--foreground) / 0.4)" }}
              >
                {order.order_number || order.reference || "Order"}
              </p>
              <h2
                className="font-serif text-foreground"
                style={{ fontSize: 22, fontWeight: 400, lineHeight: 1.2 }}
              >
                {order.title}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-foreground/40 hover:text-foreground transition-colors mt-1"
              style={{ fontSize: 20, lineHeight: 1 }}
            >
              ×
            </button>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <Icon style={{ width: 13, height: 13, color: sc.color }} strokeWidth={1.5} />
            <span
              className="font-sans uppercase"
              style={{ fontSize: 9, letterSpacing: "0.22em", color: sc.color }}
            >
              {sc.label}
            </span>
            <span
              className="font-sans ml-2"
              style={{ fontSize: 11, color: "hsl(var(--foreground) / 0.35)" }}
            >
              {order.accepted_at
                ? `Confirmed ${formatDate(order.accepted_at)}`
                : formatDate(order.created_at)}
            </span>
          </div>
        </div>

        {/* Line items */}
        <div className="px-8 py-6">
          <p
            className="font-sans uppercase mb-4"
            style={{ fontSize: 9, letterSpacing: "0.28em", color: "hsl(var(--foreground) / 0.4)" }}
          >
            Scope
          </p>
          <div className="space-y-3">
            {order.lines.map((line, i) => (
              <div key={i} className="flex items-start justify-between gap-6">
                <div className="flex-1">
                  <p className="font-sans text-foreground" style={{ fontSize: 13 }}>
                    {line.description}
                  </p>
                  {line.quantity > 1 && (
                    <p style={{ fontSize: 11, color: "hsl(var(--foreground) / 0.4)", marginTop: 2 }}>
                      {line.quantity} {line.unit || "units"} × {formatCurrency(line.unit_price, order.currency)}
                    </p>
                  )}
                </div>
                <p
                  className="font-sans tabular-nums text-foreground shrink-0"
                  style={{ fontSize: 13 }}
                >
                  {formatCurrency(line.quantity * line.unit_price, order.currency)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div
          className="px-8 py-5 border-t border-border/30 space-y-2"
          style={{ background: "hsl(var(--background))" }}
        >
          <div className="flex justify-between" style={{ fontSize: 12 }}>
            <span style={{ color: "hsl(var(--foreground) / 0.45)" }}>Subtotal</span>
            <span className="tabular-nums">{formatCurrency(order.subtotal, order.currency)}</span>
          </div>
          <div className="flex justify-between" style={{ fontSize: 12 }}>
            <span style={{ color: "hsl(var(--foreground) / 0.45)" }}>
              VAT {order.vat_rate}%
            </span>
            <span className="tabular-nums">{formatCurrency(order.vat_amount, order.currency)}</span>
          </div>
          <div
            className="flex justify-between pt-2 border-t border-border/30"
            style={{ fontSize: 15 }}
          >
            <span className="font-medium">Total</span>
            <span className="font-medium tabular-nums">
              {formatCurrency(order.total, order.currency)}
            </span>
          </div>
        </div>

        {/* Notes */}
        {order.notes && (
          <div className="px-8 py-5 border-t border-border/20">
            <p style={{ fontSize: 12, color: "hsl(var(--foreground) / 0.5)", lineHeight: 1.7 }}>
              {order.notes}
            </p>
          </div>
        )}

        {/* CTA */}
        {isPending && (
          <div className="px-8 py-6 border-t border-border/30">
            <p style={{ fontSize: 12, color: "hsl(var(--foreground) / 0.5)", marginBottom: 16, lineHeight: 1.7 }}>
              By confirming this order, you agree to the scope and fee above. This constitutes a binding commitment under the Silver Shadow Studio Client Agreement you signed on registration.
            </p>
            <button
              onClick={() => onAccept(order.id)}
              disabled={accepting}
              className="w-full flex items-center justify-center gap-2 bg-foreground text-background font-sans uppercase transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ height: 46, fontSize: 11, letterSpacing: "0.28em" }}
            >
              {accepting ? (
                <>
                  <BrandLoader size="sm" className="h-3 w-3" />
                  Confirming…
                </>
              ) : (
                "Confirm order"
              )}
            </button>
          </div>
        )}

        {/* Invoice link */}
        {order.invoice_id && (
          <div className="px-8 pb-6 border-t border-border/20 pt-5">
            <a
              href={`/invoices?invoice=${order.invoice_id}`}
              className="flex items-center gap-2 text-foreground/50 hover:text-foreground transition-colors"
              style={{ fontSize: 11, letterSpacing: "0.14em" }}
            >
              <FileText style={{ width: 13, height: 13 }} strokeWidth={1.5} />
              View invoice
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Orders() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Order | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    fetchOrders();
  }, [user]);

  async function fetchOrders() {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setOrders((data || []) as Order[]);
    } catch (e: any) {
      toast({ title: "Could not load orders", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function acceptOrder(id: string) {
    setAccepting(true);
    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      toast({ title: "Order confirmed", description: "We will be in touch to get started." });
      await fetchOrders();
      setSelected(null);
    } catch (e: any) {
      toast({ title: "Could not confirm order", description: e?.message, variant: "destructive" });
    } finally {
      setAccepting(false);
    }
  }

  const pending = orders.filter((o) => o.status === "pending_acceptance");
  const past = orders.filter((o) => o.status !== "pending_acceptance");

  return (
    <ClientLayout>
      {/* Header */}
      <div className="mb-16 animate-fade-in">
        <h1
          className="font-serif font-normal text-foreground"
          style={{ fontSize: "2.6rem", letterSpacing: "-0.005em" }}
        >
          Orders
        </h1>
        <p
          className="mt-3 font-sans uppercase text-foreground/45"
          style={{ fontSize: 10, letterSpacing: "0.22em" }}
        >
          Scope confirmations and order history
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <BrandLoader size="md" />
        </div>
      ) : orders.length === 0 ? (
        <div className="py-24 text-center">
          <p className="font-serif text-base text-foreground/40">No orders yet.</p>
        </div>
      ) : (
        <div className="space-y-16 animate-fade-in" style={{ animationDelay: "0.1s" }}>

          {/* Pending — needs action */}
          {pending.length > 0 && (
            <section>
              <p
                className="font-sans uppercase mb-6"
                style={{ fontSize: 9, letterSpacing: "0.3em", color: "hsl(var(--gold))" }}
              >
                Awaiting your confirmation — {pending.length}
              </p>
              <div className="space-y-1">
                {pending.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    onClick={() => setSelected(order)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Past orders */}
          {past.length > 0 && (
            <section>
              <p
                className="font-sans uppercase mb-6"
                style={{ fontSize: 9, letterSpacing: "0.3em", color: "hsl(var(--foreground) / 0.35)" }}
              >
                Order history
              </p>
              <div className="space-y-1">
                {past.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    onClick={() => setSelected(order)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <OrderModal
          order={selected}
          onClose={() => setSelected(null)}
          onAccept={acceptOrder}
          accepting={accepting}
        />
      )}
    </ClientLayout>
  );
}

// ── Order row ──────────────────────────────────────────────────────────────────

function OrderRow({ order, onClick }: { order: Order; onClick: () => void }) {
  const sc = statusConfig(order.status);
  const Icon = sc.icon;
  const isPending = order.status === "pending_acceptance";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full flex items-center gap-5 py-4 border-t border-border/30 text-left transition-all hover:border-border/60"
    >
      {/* Status dot */}
      <div
        className="shrink-0 h-1.5 w-1.5 rounded-full"
        style={{
          background: sc.color,
          boxShadow: isPending ? `0 0 6px ${sc.color}` : undefined,
        }}
      />

      {/* Title + meta */}
      <div className="flex-1 min-w-0">
        <p
          className="font-serif text-foreground truncate group-hover:text-gold transition-colors"
          style={{ fontSize: 14 }}
        >
          {order.title}
        </p>
        <p
          className="font-sans uppercase mt-1"
          style={{ fontSize: 9, letterSpacing: "0.18em", color: sc.color }}
        >
          {sc.label}
          <span style={{ color: "hsl(var(--foreground) / 0.3)", margin: "0 8px" }}>·</span>
          <span style={{ color: "hsl(var(--foreground) / 0.35)" }}>
            {formatDate(order.accepted_at || order.created_at)}
          </span>
        </p>
      </div>

      {/* Amount */}
      <p
        className="shrink-0 font-sans tabular-nums text-foreground"
        style={{ fontSize: 13 }}
      >
        {formatCurrency(order.total, order.currency)}
      </p>

      <ChevronRight
        className="shrink-0 text-foreground/20 group-hover:text-foreground/50 transition-colors"
        style={{ width: 14, height: 14 }}
        strokeWidth={1.5}
      />
    </button>
  );
}
