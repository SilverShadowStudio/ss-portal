import { Receipt, FileText, ChevronRight, ArrowRight, Layers } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ClientLayout } from "@/components/ClientLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LaneTask {
  id: string;
  lane_index: number;
  title: string;
  description: string | null;
  status: "queued" | "in_progress" | "completed" | "cancelled";
  delivery_status?: string;
  delivery_due_at?: string | null;
}

interface ReviewItem {
  id: string;
  type: "message" | "reply" | "invoice" | "quotation";
  label: string;
  actionLabel: string;
  actionLink: string;
  dueContext?: string;
}

interface PartnerStats {
  activeLanes: number;
  tasksInProgress: number;
  tasksQueued: number;
  unreadMessages: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function formatDue(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ── Stat Block ────────────────────────────────────────────────────────────────

function StatBlock({
  label,
  value,
  active,
  pulse,
  delay,
}: {
  label: string;
  value: number;
  active: boolean;
  pulse?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: delay ?? 0 }}
    >
      <div className="flex items-center gap-2 mb-4">
        <p className="text-[9px] font-sans uppercase tracking-[0.28em] text-foreground/45">
          {label}
        </p>
        {pulse && active && (
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_hsl(142_71%_45%/0.55)]"
          />
        )}
      </div>
      <span
        className={`font-serif text-[2.8rem] leading-none font-normal tabular-nums ${
          active ? "text-foreground" : "text-foreground/18"
        }`}
      >
        {pad(value)}
      </span>
    </motion.div>
  );
}

// ── Task Row ──────────────────────────────────────────────────────────────────

function TaskRow({ task, index }: { task: LaneTask; index: number }) {
  const navigate = useNavigate();
  const isDelivered = task.delivery_status === "delivered";

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06 }}
      className="group flex items-center gap-5 py-4 border-b border-border/18 last:border-0 cursor-pointer"
      onClick={() => navigate("/delivery")}
    >
      {/* Status dot */}
      <span
        className={`shrink-0 h-1.5 w-1.5 rounded-full ${
          isDelivered
            ? "bg-[hsl(var(--gold))] shadow-[0_0_6px_hsl(var(--gold)/0.5)] animate-pulse"
            : "bg-emerald-500 shadow-[0_0_6px_hsl(142_71%_45%/0.55)]"
        }`}
      />

      {/* Title */}
      <span className="font-serif text-sm text-foreground/75 group-hover:text-foreground transition-colors leading-tight truncate flex-1"
        style={{ letterSpacing: "0.01em" }}>
        {task.title}
      </span>

      {/* Delivery due / lane */}
      <div className="flex items-center gap-4 shrink-0">
        {isDelivered ? (
          <span className="text-[9px] uppercase tracking-[0.22em] font-sans"
            style={{ color: "hsl(var(--gold) / 0.75)" }}>
            Ready
          </span>
        ) : task.delivery_due_at ? (
          <span className="text-[9px] uppercase tracking-[0.18em] text-foreground/30 font-sans">
            Due {formatDue(task.delivery_due_at)}
          </span>
        ) : null}
        <span className="text-[9px] uppercase tracking-[0.15em] text-foreground/22 font-sans w-14 text-right">
          Lane {pad(task.lane_index)}
        </span>
      </div>

      <ChevronRight
        size={11}
        strokeWidth={1.5}
        className="text-foreground/20 group-hover:text-foreground/45 transition-colors shrink-0"
      />
    </motion.div>
  );
}

// ── Review Item ───────────────────────────────────────────────────────────────

function ReviewRow({ item, index }: { item: ReviewItem; index: number }) {
  const icon =
    item.type === "invoice" ? (
      <Receipt size={13} strokeWidth={1.5} className="text-foreground/35" />
    ) : (
      <FileText size={13} strokeWidth={1.5} className="text-foreground/35" />
    );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="flex items-center justify-between gap-6 py-4 border-b border-border/18 last:border-0"
    >
      <div className="flex items-center gap-4 min-w-0">
        {icon}
        <div className="min-w-0">
          <span className="font-serif text-sm text-foreground/75 leading-tight block truncate"
            style={{ letterSpacing: "0.01em" }}>
            {item.label}
          </span>
          {item.dueContext && (
            <p className="text-[9px] text-foreground/30 font-sans mt-1 uppercase tracking-[0.18em]">
              {item.dueContext}
            </p>
          )}
        </div>
      </div>
      <Link
        to={item.actionLink}
        className="shrink-0 inline-flex items-center gap-2 px-5 py-1.5 text-[9px] tracking-[0.24em] uppercase text-foreground/50 border border-border/30 hover:text-foreground/80 hover:border-border/55 transition-all font-sans"
        style={{ borderRadius: 2 }}
      >
        {item.actionLabel}
      </Link>
    </motion.div>
  );
}

// ── Section Header ────────────────────────────────────────────────────────────

function SectionHeader({
  label,
  action,
  onAction,
  delay,
}: {
  label: string;
  action?: string;
  onAction?: () => void;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: delay ?? 0 }}
      className="flex items-center justify-between mb-8"
    >
      <h2 className="text-[9px] font-sans uppercase tracking-[0.32em] text-foreground/40">
        {label}
      </h2>
      {action && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="text-[9px] uppercase tracking-[0.22em] text-foreground/28 hover:text-[hsl(var(--gold))] transition-colors font-sans"
        >
          {action}
        </button>
      )}
    </motion.div>
  );
}

// ── Onboarding ────────────────────────────────────────────────────────────────

function OnboardingCard() {
  const navigate = useNavigate();
  const steps = [
    "Submit a task from the Timeline page",
    "Our team reviews and schedules it into your lane",
    "Track progress and receive deliveries on the Deliveries page",
    "Review, annotate, and approve — or request the next iteration",
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="mb-20 border px-8 py-8"
      style={{
        borderRadius: 4,
        borderColor: "hsl(var(--gold) / 0.18)",
        background: "hsl(var(--gold) / 0.03)",
      }}
    >
      <div className="flex items-start gap-6">
        <div
          className="shrink-0 mt-0.5 h-8 w-8 flex items-center justify-center"
          style={{ border: "1px solid hsl(var(--gold) / 0.25)", borderRadius: 2 }}
        >
          <Layers className="h-4 w-4" style={{ color: "hsl(var(--gold))" }} strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-sans uppercase tracking-[0.32em] mb-4"
            style={{ color: "hsl(var(--gold))" }}>
            Subscription active
          </p>
          <p className="font-serif text-foreground/70 leading-relaxed mb-7"
            style={{ fontSize: "1.05rem", fontWeight: 300 }}>
            Each lane represents one dedicated production capacity — one active task at a time, full-time, ongoing.
          </p>
          <div className="space-y-3 mb-8">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="shrink-0 font-serif text-[10px] text-foreground/25 mt-0.5" style={{ minWidth: 20 }}>
                  {pad(i + 1)}
                </span>
                <span className="text-[11px] font-sans text-foreground/45 tracking-wide leading-relaxed">
                  {step}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => navigate("/timeline")}
            className="inline-flex items-center gap-2.5 text-[9px] font-sans uppercase tracking-[0.28em] text-foreground/55 border border-foreground/18 px-6 py-3 hover:text-foreground hover:border-foreground/35 transition-all"
            style={{ borderRadius: 2 }}
          >
            Submit your first task
            <ArrowRight size={11} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Overview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isNewAccount, setIsNewAccount] = useState(false);
  const [stats, setStats] = useState<PartnerStats>({
    activeLanes: 0,
    tasksInProgress: 0,
    tasksQueued: 0,
    unreadMessages: 0,
  });
  const [activeTasks, setActiveTasks] = useState<LaneTask[]>([]);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      if (!user) return;
      try {
        const { data: member } = await supabase
          .from("account_members")
          .select("account_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!member?.account_id) return;

        const { data: sub } = await supabase
          .from("subscriptions")
          .select("active_lanes, status")
          .eq("account_id", member.account_id)
          .maybeSingle();

        const { data: tasks } = await supabase
          .from("lane_tasks")
          .select("*")
          .eq("account_id", member.account_id)
          .in("status", ["in_progress", "queued"])
          .order("lane_index")
          .order("position");

        const inProgress = (tasks || []).filter((t) => t.status === "in_progress");
        const queued = (tasks || []).filter((t) => t.status === "queued");

        // Detect new account — no tasks ever
        const { data: allTasks } = await supabase
          .from("lane_tasks")
          .select("id")
          .eq("account_id", member.account_id)
          .limit(1);
        setIsNewAccount(!allTasks || allTasks.length === 0);

        setActiveTasks(inProgress as LaneTask[]);
        setStats({
          activeLanes: sub?.active_lanes ?? 0,
          tasksInProgress: inProgress.length,
          tasksQueued: queued.length,
          unreadMessages: 0,
        });

        const items: ReviewItem[] = [];

        // Unread studio messages
        const { data: messages } = await supabase
          .from("scene_messages")
          .select("id, parent_message_id")
          .eq("sender_type", "studio")
          .eq("is_read", false);

        (messages || []).forEach((msg) => {
          items.push({
            id: `msg-${msg.id}`,
            type: msg.parent_message_id ? "reply" : "message",
            label: "New message from the studio",
            actionLabel: "Open",
            actionLink: "/documents",
          });
        });

        // Pending invoices
        const { data: invoices } = await supabase
          .from("invoices")
          .select("id, reference_number, due_date")
          .eq("status", "pending");

        (invoices || []).forEach((inv) => {
          items.push({
            id: `inv-${inv.id}`,
            type: "invoice",
            label: inv.reference_number,
            actionLabel: "View",
            actionLink: "/documents",
            dueContext: inv.due_date ? `Due ${formatDue(inv.due_date)}` : undefined,
          });
        });

        // Pending quotations
        const { data: quotations } = await supabase
          .from("quotations")
          .select("id, reference_number")
          .eq("status", "pending");

        (quotations || []).forEach((q) => {
          items.push({
            id: `q-${q.id}`,
            type: "quotation",
            label: q.reference_number,
            actionLabel: "Review",
            actionLink: "/documents",
          });
        });

        setReviewItems(items);
        setStats((prev) => ({ ...prev, unreadMessages: messages?.length ?? 0 }));
      } catch (err) {
        console.error("Dashboard fetch error:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [user]);

  const isUpToDate = !loading && reviewItems.length === 0;

  return (
    <ClientLayout>
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="mb-14"
      >
        <div className="flex items-center gap-4 mb-5">
          <div className="h-px w-8" style={{ background: "hsl(var(--gold) / 0.55)" }} />
          <span className="text-[9px] uppercase tracking-[0.42em] font-sans"
            style={{ color: "hsl(var(--gold))" }}>
            Studio Portal
          </span>
        </div>
        <h1
          className="font-serif font-light text-foreground"
          style={{ fontSize: "clamp(2.2rem, 4vw, 3rem)", letterSpacing: "0.02em" }}
        >
          Overview
        </h1>
      </motion.div>

      {/* Onboarding */}
      {!loading && isNewAccount && <OnboardingCard />}

      {/* Stats */}
      {!loading && (
        <div className="mb-16 md:mb-20">
          <div className="grid grid-cols-3 gap-y-8 gap-x-4 md:gap-x-14">
            <StatBlock label="Lanes" value={stats.activeLanes} active={stats.activeLanes > 0} delay={0.05} />
            <StatBlock label="In Progress" value={stats.tasksInProgress} active={stats.tasksInProgress > 0} pulse delay={0.1} />
            <StatBlock label="Queued" value={stats.tasksQueued} active={stats.tasksQueued > 0} delay={0.15} />
          </div>
        </div>
      )}

      {/* Messages summary — below stats */}
      {!loading && (
        <motion.section
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.17 }}
          className="mb-20"
        >
          <div className="flex items-center gap-2 mb-6">
            <h2 className="text-[9px] font-sans uppercase tracking-[0.32em] text-foreground/40">
              Messages
            </h2>
            <span
              aria-hidden
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                stats.unreadMessages > 0
                  ? "bg-rose-500 shadow-[0_0_6px_hsl(0_84%_60%/0.55)]"
                  : "bg-emerald-500 shadow-[0_0_6px_hsl(142_71%_45%/0.55)]"
              }`}
            />
          </div>
          <div className="flex items-baseline gap-3">
            <span
              className={`font-serif text-[2.8rem] leading-none tabular-nums ${
                stats.unreadMessages > 0
                  ? "text-[hsl(var(--gold))]"
                  : "text-foreground/18"
              }`}
            >
              {pad(stats.unreadMessages)}
            </span>
            {stats.unreadMessages > 0 ? (
              <span className="text-[9px] uppercase tracking-[0.28em] font-sans"
                style={{ color: "hsl(var(--gold) / 0.75)" }}>
                Unread
              </span>
            ) : (
              <span className="text-[9px] uppercase tracking-[0.24em] font-sans text-foreground/25">
                No unread messages
              </span>
            )}
          </div>
        </motion.section>
      )}

      {/* Active tasks */}
      <section className="mb-20">
        <SectionHeader
          label="Active tasks"
          action={activeTasks.length > 0 ? "View all" : undefined}
          onAction={() => navigate("/timeline")}
          delay={0.18}
        />

        {loading ? (
          <div className="py-10">
            {[1, 2].map((i) => (
              <div key={i} className="py-4 border-b border-border/18 flex items-center gap-4">
                <div className="h-1.5 w-1.5 rounded-full bg-foreground/10 shrink-0" />
                <div className="h-3 rounded bg-foreground/8 flex-1" style={{ maxWidth: 240 }} />
              </div>
            ))}
          </div>
        ) : activeTasks.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="py-8 border-t border-border/18"
          >
            <p className="font-serif text-foreground/28 text-base" style={{ fontWeight: 300 }}>
              No tasks in production
            </p>
            <p className="mt-2 text-[10px] font-sans text-foreground/22 tracking-wide leading-relaxed">
              Tasks appear here once our team has scheduled your requests into a lane.
            </p>
            <button
              type="button"
              onClick={() => navigate("/timeline")}
              className="mt-5 inline-flex items-center gap-2 text-[9px] font-sans uppercase tracking-[0.24em] text-foreground/30 hover:text-[hsl(var(--gold))] transition-colors"
            >
              Go to Timeline
              <ChevronRight size={10} strokeWidth={1.5} />
            </button>
          </motion.div>
        ) : (
          <div>
            {activeTasks.map((task, i) => (
              <TaskRow key={task.id} task={task} index={i} />
            ))}
          </div>
        )}
      </section>

      {/* Requires attention */}
      <section className="mb-20">
        <SectionHeader label="Requires attention" delay={0.22} />

        {loading ? (
          <div className="py-10">
            <div className="py-4 border-b border-border/18 flex items-center gap-4">
              <div className="h-3 w-3 rounded bg-foreground/10 shrink-0" />
              <div className="h-3 rounded bg-foreground/8 flex-1" style={{ maxWidth: 200 }} />
            </div>
          </div>
        ) : isUpToDate ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.24 }}
            className="py-8 border-t border-border/18"
          >
            <p className="font-serif text-foreground/28 text-base" style={{ fontWeight: 300 }}>
              Nothing requires your attention
            </p>
          </motion.div>
        ) : (
          <div>
            {reviewItems.map((item, i) => (
              <ReviewRow key={item.id} item={item} index={i} />
            ))}
          </div>
        )}
      </section>

    </ClientLayout>
  );
}
