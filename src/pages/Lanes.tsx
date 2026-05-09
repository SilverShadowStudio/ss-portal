import { useEffect, useMemo, useState } from "react";
import { ClientLayout } from "@/components/ClientLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, CheckCircle2, Clock, Play, ChevronUp, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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
}

interface LaneTask {
  id: string;
  account_id: string;
  lane_index: number;
  position: number;
  title: string;
  description: string | null;
  status: "queued" | "in_progress" | "completed" | "cancelled";
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

const formatGBP = (pence: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(pence / 100);

export default function Lanes() {
  const { user } = useAuth();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [tasks, setTasks] = useState<LaneTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [openModal, setOpenModal] = useState<{ lane: number } | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");

  useEffect(() => {
    if (!user) return;
    supabase
      .from("account_members")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.account_id) setAccountId(data.account_id);
        else setLoading(false);
      });
  }, [user]);

  const loadAll = async (acc: string) => {
    setLoading(true);
    const [{ data: s }, { data: t }] = await Promise.all([
      supabase.from("subscriptions").select("*").eq("account_id", acc).maybeSingle(),
      supabase
        .from("lane_tasks")
        .select("*")
        .eq("account_id", acc)
        .order("lane_index")
        .order("position"),
    ]);
    setSub(s as Subscription | null);
    setTasks((t as LaneTask[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (accountId) loadAll(accountId);
  }, [accountId]);

  const lanes = sub?.active_lanes ?? 1;
  const tasksByLane = useMemo(() => {
    const m: Record<number, LaneTask[]> = {};
    for (let i = 1; i <= lanes; i++) m[i] = [];
    tasks.forEach((t) => {
      if (t.lane_index <= lanes) (m[t.lane_index] ||= []).push(t);
    });
    return m;
  }, [tasks, lanes]);

  const enableSubscription = async () => {
    if (!accountId) return;
    const { error } = await supabase.from("subscriptions").upsert(
      {
        account_id: accountId,
        active_lanes: 1,
        monthly_cost_pence: LANE_PRICES_PENCE[0],
        status: "active",
      },
      { onConflict: "account_id" },
    );
    if (error) toast.error(error.message);
    else loadAll(accountId);
  };

  const setLaneCount = async (n: number) => {
    if (!sub || !accountId) return;
    const monthly = LANE_PRICES_PENCE.slice(0, n).reduce((a, b) => a + b, 0);
    const { error } = await supabase
      .from("subscriptions")
      .update({ active_lanes: n, monthly_cost_pence: monthly })
      .eq("id", sub.id);
    if (error) toast.error(error.message);
    else loadAll(accountId);
  };

  const addTask = async () => {
    if (!openModal || !accountId || !user || !newTitle.trim()) return;
    const laneTasks = tasksByLane[openModal.lane] || [];
    const nextPos = laneTasks.length;
    const { error } = await supabase.from("lane_tasks").insert({
      account_id: accountId,
      lane_index: openModal.lane,
      position: nextPos,
      title: newTitle.trim(),
      description: newDesc.trim() || null,
      created_by: user.id,
      status: nextPos === 0 ? "in_progress" : "queued",
      started_at: nextPos === 0 ? new Date().toISOString() : null,
    });
    if (error) toast.error(error.message);
    else {
      setOpenModal(null);
      setNewTitle("");
      setNewDesc("");
      loadAll(accountId);
    }
  };

  const completeTask = async (task: LaneTask) => {
    if (!accountId) return;
    await supabase
      .from("lane_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", task.id);
    // Promote next queued task in the same lane
    const queued = (tasksByLane[task.lane_index] || []).filter(
      (t) => t.status === "queued" && t.id !== task.id,
    );
    if (queued.length > 0) {
      await supabase
        .from("lane_tasks")
        .update({ status: "in_progress", started_at: new Date().toISOString() })
        .eq("id", queued[0].id);
    }
    loadAll(accountId);
  };

  const reorder = async (task: LaneTask, dir: -1 | 1) => {
    const lane = (tasksByLane[task.lane_index] || []).filter(
      (t) => t.status === "queued",
    );
    const idx = lane.findIndex((t) => t.id === task.id);
    const swapWith = lane[idx + dir];
    if (!swapWith) return;
    await Promise.all([
      supabase.from("lane_tasks").update({ position: swapWith.position }).eq("id", task.id),
      supabase.from("lane_tasks").update({ position: task.position }).eq("id", swapWith.id),
    ]);
    if (accountId) loadAll(accountId);
  };

  if (loading) {
    return (
      <ClientLayout>
        <div className="p-12 text-muted-foreground">Loading lanes…</div>
      </ClientLayout>
    );
  }

  if (!accountId) {
    return (
      <ClientLayout>
        <div className="mx-auto max-w-2xl p-12 text-center">
          <h1 className="font-serif text-2xl">No account linked</h1>
          <p className="mt-4 text-muted-foreground">
            Your user is not yet attached to a company account. An admin needs
            to add you to an account before you can manage lanes.
          </p>
        </div>
      </ClientLayout>
    );
  }

  if (!sub) {
    return (
      <ClientLayout>
        <div className="mx-auto max-w-2xl p-12 text-center">
          <p className="font-serif text-xs tracking-[0.3em] text-[hsl(var(--gold))]">
            STUDIO PARTNERSHIP
          </p>
          <h1 className="mt-3 font-serif text-3xl">No active subscription</h1>
          <p className="mt-4 text-muted-foreground">
            Activate your lane subscription to start queueing work.
          </p>
          <Button className="mt-8" onClick={enableSubscription}>
            Activate 1-Lane subscription
          </Button>
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      <div className="p-8 md:p-12 max-w-7xl mx-auto">
        <header className="flex items-end justify-between flex-wrap gap-6 mb-10">
          <div>
            <p className="font-serif text-xs tracking-[0.3em] text-[hsl(var(--gold))]">
              STUDIO PARTNERSHIP
            </p>
            <h1 className="mt-2 font-serif text-3xl">Your Lanes</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {lanes} active lane{lanes === 1 ? "" : "s"} ·{" "}
              {formatGBP(sub.monthly_cost_pence)}/month
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Lanes
            </span>
            <select
              value={lanes}
              onChange={(e) => setLaneCount(Number(e.target.value))}
              className="rounded-sm border border-border bg-card px-3 py-1.5 text-sm"
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: lanes }, (_, i) => i + 1).map((lane) => {
            const list = tasksByLane[lane] || [];
            const active = list.find((t) => t.status === "in_progress");
            const queued = list.filter((t) => t.status === "queued");
            const completed = list.filter((t) => t.status === "completed");
            return (
              <div
                key={lane}
                className="rounded-sm border border-border bg-card p-5 flex flex-col"
              >
                <div className="flex items-center justify-between">
                  <p className="font-serif text-sm tracking-widest">LANE {lane}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setOpenModal({ lane })}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add task
                  </Button>
                </div>

                <div className="mt-4">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                    <Play className="h-3 w-3" /> Active
                  </p>
                  {active ? (
                    <div className="mt-2 rounded-sm border border-[hsl(var(--gold))]/40 bg-[hsl(var(--surface-elevated))]/40 p-3">
                      <p className="font-medium text-sm">{active.title}</p>
                      {active.description && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {active.description}
                        </p>
                      )}
                      <Button
                        size="sm"
                        className="mt-3"
                        onClick={() => completeTask(active)}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Approve & advance
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground italic">
                      No task in progress.
                    </p>
                  )}
                </div>

                <div className="mt-4">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Queue ({queued.length})
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {queued.map((t, idx) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between rounded-sm border border-border/60 px-3 py-2 text-sm"
                      >
                        <span className="truncate">{t.title}</span>
                        <span className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => reorder(t, -1)}
                            disabled={idx === 0}
                            className="p-1 disabled:opacity-30 hover:text-foreground"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => reorder(t, 1)}
                            disabled={idx === queued.length - 1}
                            className="p-1 disabled:opacity-30 hover:text-foreground"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </li>
                    ))}
                    {queued.length === 0 && (
                      <li className="text-xs text-muted-foreground italic">Empty.</li>
                    )}
                  </ul>
                </div>

                {completed.length > 0 && (
                  <details className="mt-4 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      Completed ({completed.length})
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {completed.map((t) => (
                        <li key={t.id} className="line-through">
                          {t.title}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Dialog
        open={!!openModal}
        onOpenChange={(o) => {
          if (!o) {
            setOpenModal(null);
            setNewTitle("");
            setNewDesc("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              New task — Lane {openModal?.lane}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Task title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <Textarea
              placeholder="Brief / details (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={5}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenModal(null)}>
              Cancel
            </Button>
            <Button onClick={addTask} disabled={!newTitle.trim()}>
              Add to lane
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ClientLayout>
  );
}
