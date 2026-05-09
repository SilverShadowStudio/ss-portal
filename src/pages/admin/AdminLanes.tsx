import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const LANE_PRICES_PENCE = [
  395000, 380000, 370000, 360000, 350000, 335000, 325000, 320000, 310000, 300000,
];

interface Subscription {
  id: string;
  account_id: string;
  active_lanes: number;
  monthly_cost_pence: number;
  status: string;
  started_at: string;
}

interface Account {
  id: string;
  company_name: string;
}

interface LaneTask {
  id: string;
  account_id: string;
  lane_index: number;
  position: number;
  title: string;
  status: "queued" | "in_progress" | "completed" | "cancelled";
}

const formatGBP = (pence: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(pence / 100);

export default function AdminLanes() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tasks, setTasks] = useState<LaneTask[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data: s }, { data: a }, { data: t }] = await Promise.all([
      supabase.from("subscriptions").select("*").order("started_at", { ascending: false }),
      supabase.from("accounts").select("id, company_name"),
      supabase.from("lane_tasks").select("*").order("lane_index").order("position"),
    ]);
    setSubs((s as Subscription[]) ?? []);
    setAccounts((a as Account[]) ?? []);
    setTasks((t as LaneTask[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const accountById = useMemo(() => {
    const m: Record<string, Account> = {};
    accounts.forEach((a) => (m[a.id] = a));
    return m;
  }, [accounts]);

  const totals = useMemo(() => {
    const mrr = subs
      .filter((s) => s.status === "active")
      .reduce((sum, s) => sum + s.monthly_cost_pence, 0);
    const lanes = subs
      .filter((s) => s.status === "active")
      .reduce((sum, s) => sum + s.active_lanes, 0);
    return { mrr, lanes, active: subs.filter((s) => s.status === "active").length };
  }, [subs]);

  const tasksFor = (accountId: string, lane: number) =>
    tasks.filter((t) => t.account_id === accountId && t.lane_index === lane);

  const setLaneCount = async (sub: Subscription, n: number) => {
    const monthly = LANE_PRICES_PENCE.slice(0, n).reduce((a, b) => a + b, 0);
    const { error } = await supabase
      .from("subscriptions")
      .update({ active_lanes: n, monthly_cost_pence: monthly })
      .eq("id", sub.id);
    if (error) toast.error(error.message);
    else load();
  };

  const setStatus = async (sub: Subscription, status: string) => {
    const patch: Record<string, unknown> = { status };
    if (status === "paused") patch.paused_at = new Date().toISOString();
    if (status === "cancelled") patch.cancelled_at = new Date().toISOString();
    if (status === "active") {
      patch.paused_at = null;
      patch.cancelled_at = null;
    }
    const { error } = await supabase.from("subscriptions").update(patch).eq("id", sub.id);
    if (error) toast.error(error.message);
    else load();
  };

  const completeTask = async (task: LaneTask) => {
    await supabase
      .from("lane_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", task.id);
    const queued = tasks
      .filter(
        (t) =>
          t.account_id === task.account_id &&
          t.lane_index === task.lane_index &&
          t.status === "queued",
      )
      .sort((a, b) => a.position - b.position);
    if (queued[0]) {
      await supabase
        .from("lane_tasks")
        .update({ status: "in_progress", started_at: new Date().toISOString() })
        .eq("id", queued[0].id);
    }
    load();
  };

  const startSubscriptionFor = async (accountId: string) => {
    const { error } = await supabase.from("subscriptions").insert({
      account_id: accountId,
      active_lanes: 1,
      monthly_cost_pence: LANE_PRICES_PENCE[0],
      status: "active",
    });
    if (error) toast.error(error.message);
    else load();
  };

  const accountsWithoutSub = accounts.filter(
    (a) => !subs.find((s) => s.account_id === a.id),
  );

  return (
    <AdminLayout>
      <div className="p-8 md:p-12 max-w-7xl mx-auto">
        <header className="mb-10">
          <p className="font-serif text-xs tracking-[0.3em] text-[hsl(var(--gold))]">
            STUDIO PARTNERSHIP
          </p>
          <h1 className="mt-2 font-serif text-3xl">Subscriptions & Lanes</h1>
        </header>

        <div className="grid sm:grid-cols-3 gap-4 mb-10">
          <Stat label="Active subscriptions" value={String(totals.active)} />
          <Stat label="Total active lanes" value={String(totals.lanes)} />
          <Stat label="Monthly recurring" value={formatGBP(totals.mrr)} />
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : subs.length === 0 ? (
          <p className="text-muted-foreground italic">No subscriptions yet.</p>
        ) : (
          <div className="space-y-6">
            {subs.map((sub) => {
              const acct = accountById[sub.account_id];
              return (
                <div
                  key={sub.id}
                  className="rounded-sm border border-border bg-card p-6"
                >
                  <div className="flex items-start justify-between flex-wrap gap-4">
                    <div>
                      <p className="font-serif text-lg">
                        {acct?.company_name ?? "Unknown account"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {sub.active_lanes} lane{sub.active_lanes === 1 ? "" : "s"} ·{" "}
                        {formatGBP(sub.monthly_cost_pence)}/month ·{" "}
                        <span className="uppercase tracking-wider">{sub.status}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={sub.active_lanes}
                        onChange={(e) => setLaneCount(sub, Number(e.target.value))}
                        className="rounded-sm border border-border bg-background px-2 py-1 text-sm"
                      >
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {n} lane{n === 1 ? "" : "s"}
                          </option>
                        ))}
                      </select>
                      {sub.status === "active" ? (
                        <Button size="sm" variant="outline" onClick={() => setStatus(sub, "paused")}>
                          Pause
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setStatus(sub, "active")}>
                          Resume
                        </Button>
                      )}
                      {sub.status !== "cancelled" && (
                        <Button size="sm" variant="ghost" onClick={() => setStatus(sub, "cancelled")}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: sub.active_lanes }, (_, i) => i + 1).map((lane) => {
                      const list = tasksFor(sub.account_id, lane);
                      const active = list.find((t) => t.status === "in_progress");
                      const queued = list.filter((t) => t.status === "queued");
                      return (
                        <div key={lane} className="rounded-sm border border-border/60 p-4">
                          <p className="font-serif text-xs tracking-widest mb-3">
                            LANE {lane}
                          </p>
                          {active ? (
                            <div className="rounded-sm border border-[hsl(var(--gold))]/40 bg-[hsl(var(--surface-elevated))]/40 p-3">
                              <p className="text-sm font-medium">{active.title}</p>
                              <Button
                                size="sm"
                                className="mt-2"
                                onClick={() => completeTask(active)}
                              >
                                <CheckCircle2 className="h-4 w-4 mr-1" /> Mark done
                              </Button>
                            </div>
                          ) : (
                            <p className="text-xs italic text-muted-foreground">Idle</p>
                          )}
                          {queued.length > 0 && (
                            <p className="mt-3 text-xs text-muted-foreground">
                              {queued.length} queued
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {accountsWithoutSub.length > 0 && (
          <div className="mt-12">
            <p className="font-serif text-xs tracking-[0.3em] text-muted-foreground mb-3">
              ACCOUNTS WITHOUT SUBSCRIPTION
            </p>
            <div className="rounded-sm border border-border bg-card divide-y divide-border">
              {accountsWithoutSub.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm">{a.company_name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startSubscriptionFor(a.id)}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Start subscription
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border bg-card p-5">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-serif text-2xl">{value}</p>
    </div>
  );
}
