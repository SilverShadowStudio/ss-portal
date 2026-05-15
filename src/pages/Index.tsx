/**
 * Client Dashboard — single focused state.
 *
 * Shows exactly one thing: what requires the client's attention right now.
 * Priority:
 *   1. Lane task delivered — awaiting feedback
 *   2. Lane task in production — countdown
 *   3. Scene round awaiting client review
 *   4. Pending order to confirm
 *   5. Nothing to do — clean holding state
 */

import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, CheckCircle2, X } from "lucide-react";
import { ClientLayout } from "@/components/ClientLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";
import { AssetViewer } from "@/components/client/AssetViewer";
import { NewRoundModal } from "@/components/client/NewRoundModal";
import { logActivity } from "@/lib/activityLog";
import { toast as sonnerToast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type FocusState =
  | { kind: "delivered";   task: LaneTask }
  | { kind: "countdown";   task: LaneTask }
  | { kind: "review";      round: SceneRound }
  | { kind: "order";       order: PendingOrder }
  | { kind: "idle" }
  | { kind: "loading" };

interface LaneTask {
  id: string;
  title: string;
  description: string | null;
  delivery_status: string;
  delivery_due_at: string | null;
  delivery_image_url: string | null;
  delivered_at: string | null;
  lane_index: number;
}

interface SceneRound {
  id: string;
  round_number: number;
  status: string;
  image_url: string | null;
  scene_id: string;
  scene_name: string | null;
  project_name: string | null;
  delivered_at: string | null;
  asset_url: string | null;
}

interface PendingOrder {
  id: string;
  title: string;
  total: number;
  currency: string;
}

// ── Countdown hook ─────────────────────────────────────────────────────────────

function useCountdown(dueAt: string | null) {
  const [remaining, setRemaining] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!dueAt) return;
    const tick = () => setRemaining(Math.max(0, new Date(dueAt).getTime() - Date.now()));
    tick();
    ref.current = setInterval(tick, 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [dueAt]);
  const s = Math.floor(remaining / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  return { d, h: h % 24, m: m % 60, s: s % 60, total: remaining };
}

function pad(n: number) { return String(n).padStart(2, "0"); }

function formatCurrency(n: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(n);
}

// ── Ambient glow ──────────────────────────────────────────────────────────────

function AmbientGlow({ variant }: { variant: "gold" | "green" | "none" }) {
  if (variant === "none") return null;
  const color = variant === "gold"
    ? "hsl(var(--gold) / 0.10)"
    : "hsl(142 71% 45% / 0.07)";
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-[2000ms]"
      style={{
        background: `radial-gradient(ellipse 70% 50% at 50% 100%, ${color} 0%, transparent 70%)`,
      }}
    />
  );
}

// ── State views ───────────────────────────────────────────────────────────────

function DeliveredView({ task, onNext }: { task: LaneTask; onNext: () => void }) {
  return (
    <motion.div
      key="delivered"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4"
    >
      {task.delivery_image_url && (
        <div className="w-full max-w-2xl mb-10 rounded-sm overflow-hidden aspect-video">
          <img src={task.delivery_image_url} alt={task.title} className="w-full h-full object-cover" />
        </div>
      )}
      <p className="font-sans uppercase text-[9px] tracking-[0.36em] text-gold mb-4">
        Delivered · Round ready for review
      </p>
      <h1 className="font-serif text-3xl md:text-4xl font-normal text-foreground mb-3">
        {task.title}
      </h1>
      {task.delivered_at && (
        <p className="font-sans text-foreground/40 text-sm mb-10">
          Delivered {new Date(task.delivered_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
        </p>
      )}
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <button
          onClick={onNext}
          className="flex items-center gap-2 bg-foreground text-background font-sans uppercase hover:opacity-80 transition-opacity"
          style={{ height: 46, paddingLeft: 32, paddingRight: 32, fontSize: 11, letterSpacing: "0.28em" }}
        >
          Submit corrections
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <button
          onClick={onNext}
          className="font-sans uppercase text-foreground/40 hover:text-foreground transition-colors"
          style={{ fontSize: 10, letterSpacing: "0.22em" }}
        >
          Approve
        </button>
      </div>
    </motion.div>
  );
}

function CountdownView({ task }: { task: LaneTask }) {
  const { d, h, m, s, total } = useCountdown(task.delivery_due_at);
  const isPast = total === 0;
  return (
    <motion.div
      key="countdown"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4"
    >
      <p className="font-sans uppercase text-[9px] tracking-[0.36em] text-foreground/35 mb-8">
        In production
      </p>
      <h1 className="font-serif text-2xl md:text-3xl font-normal text-foreground mb-12">
        {task.title}
      </h1>
      {isPast ? (
        <p className="font-serif text-xl text-gold">Due now</p>
      ) : (
        <div className="flex items-end gap-6 md:gap-10">
          {d > 0 && (
            <div className="text-center">
              <span className="font-serif text-[4rem] md:text-[6rem] leading-none tabular-nums text-foreground">{pad(d)}</span>
              <p className="font-sans uppercase text-[8px] tracking-[0.28em] text-foreground/30 mt-2">Days</p>
            </div>
          )}
          <div className="text-center">
            <span className="font-serif text-[4rem] md:text-[6rem] leading-none tabular-nums text-foreground">{pad(h)}</span>
            <p className="font-sans uppercase text-[8px] tracking-[0.28em] text-foreground/30 mt-2">Hours</p>
          </div>
          <div className="text-center">
            <span className="font-serif text-[4rem] md:text-[6rem] leading-none tabular-nums text-foreground">{pad(m)}</span>
            <p className="font-sans uppercase text-[8px] tracking-[0.28em] text-foreground/30 mt-2">Min</p>
          </div>
          <div className="text-center">
            <span className="font-serif text-[4rem] md:text-[6rem] leading-none tabular-nums" style={{ color: "hsl(var(--gold))" }}>{pad(s)}</span>
            <p className="font-sans uppercase text-[8px] tracking-[0.28em] text-foreground/30 mt-2">Sec</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function ReviewView({ round, onOpenReview }: { round: SceneRound; onOpenReview: () => void }) {
  const imageUrl = round.asset_url || round.image_url;
  return (
    <motion.div
      key="review"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4"
    >
      {imageUrl && (
        <div className="w-full max-w-2xl mb-10 rounded-sm overflow-hidden aspect-video">
          <img src={imageUrl} alt={round.scene_name || "Scene"} className="w-full h-full object-cover" />
        </div>
      )}
      <p className="font-sans uppercase text-[9px] tracking-[0.36em] text-gold mb-4">
        Awaiting your review
      </p>
      <h1 className="font-serif text-3xl md:text-4xl font-normal text-foreground mb-2">
        {round.scene_name || "Scene"}
      </h1>
      {round.project_name && (
        <p className="font-sans text-foreground/40 text-sm mb-10">{round.project_name} · Round {round.round_number}</p>
      )}
      <button
        onClick={onOpenReview}
        className="flex items-center gap-2 bg-foreground text-background font-sans uppercase hover:opacity-80 transition-opacity"
        style={{ height: 46, paddingLeft: 32, paddingRight: 32, fontSize: 11, letterSpacing: "0.28em" }}
      >
        Review now
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    </motion.div>
  );
}

function OrderView({ order, onNavigate }: { order: PendingOrder; onNavigate: () => void }) {
  return (
    <motion.div
      key="order"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4"
    >
      <p className="font-sans uppercase text-[9px] tracking-[0.36em] text-gold mb-4">
        Order awaiting confirmation
      </p>
      <h1 className="font-serif text-3xl md:text-4xl font-normal text-foreground mb-3">
        {order.title}
      </h1>
      <p className="font-serif text-xl text-foreground/50 mb-10">
        {formatCurrency(order.total, order.currency)}
      </p>
      <button
        onClick={onNavigate}
        className="flex items-center gap-2 bg-foreground text-background font-sans uppercase hover:opacity-80 transition-opacity"
        style={{ height: 46, paddingLeft: 32, paddingRight: 32, fontSize: 11, letterSpacing: "0.28em" }}
      >
        Review order
        <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    </motion.div>
  );
}

function IdleView() {
  return (
    <motion.div
      key="idle"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4"
    >
      <CheckCircle2 className="h-8 w-8 text-foreground/15 mb-6" strokeWidth={1} />
      <p className="font-serif text-xl text-foreground/30 font-normal">
        Nothing requires your attention.
      </p>
    </motion.div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Index() {
  const { user, accountType } = useAuth();
  const navigate = useNavigate();
  const [focus, setFocus] = useState<FocusState>({ kind: "loading" });
  const [reviewOverlayOpen, setReviewOverlayOpen] = useState(false);
  const [newRoundModalOpen, setNewRoundModalOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchFocus();
  }, [user, accountType]);

  async function fetchFocus() {
    setFocus({ kind: "loading" });
    try {
      const { data: member } = await supabase
        .from("account_members")
        .select("account_id")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (!member?.account_id) { setFocus({ kind: "idle" }); return; }
      const aid = member.account_id;

      // Lane tasks — only for partnership accounts (or unknown type)
      if (accountType !== 'project') {
        // 1. Lane task delivered — awaiting feedback
        const { data: deliveredTasks } = await supabase
          .from("lane_tasks")
          .select("id, title, description, delivery_status, delivery_due_at, delivery_image_url, delivered_at, lane_index")
          .eq("account_id", aid)
          .eq("delivery_status", "delivered")
          .order("delivered_at", { ascending: false })
          .limit(1);

        if (deliveredTasks && deliveredTasks.length > 0) {
          setFocus({ kind: "delivered", task: deliveredTasks[0] as LaneTask });
          return;
        }

        // 2. Lane task in production — countdown
        const { data: inProdTasks } = await supabase
          .from("lane_tasks")
          .select("id, title, description, delivery_status, delivery_due_at, delivery_image_url, delivered_at, lane_index")
          .eq("account_id", aid)
          .eq("delivery_status", "in_production")
          .order("delivery_due_at", { ascending: true })
          .limit(1);

        if (inProdTasks && inProdTasks.length > 0) {
          setFocus({ kind: "countdown", task: inProdTasks[0] as LaneTask });
          return;
        }
      }

      // Scene rounds — only for project accounts (or unknown type)
      if (accountType !== 'partnership') {
        // 3. Scene round awaiting client review
      const { data: reviewRounds } = await supabase
        .from("scene_rounds")
        .select(`
          id, round_number, status, image_url, scene_id, delivered_at,
          scenes!inner ( name, projects!inner ( name, account_id ) )
        `)
        .in("status", ["client_review", "awaiting_review", "delivered"])
        .order("delivered_at", { ascending: false })
        .limit(10);

      const clientRound = (reviewRounds || []).find(
        (r: any) => r.scenes?.projects?.account_id === aid
      );

      if (clientRound) {
        // Try to get latest asset URL, preferring Dropbox-delivered renders.
        const { data: asset } = await supabase
          .from("round_assets")
          .select("dropbox_path, storage_path, image_url, source")
          .eq("scene_round_id", clientRound.id)
          .eq("is_current", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        let assetUrl: string | null = (asset as any)?.image_url || null;
        if (!assetUrl && (asset as any)?.dropbox_path) {
          try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            if (token) {
              const res = await fetch(
                `${SUPABASE_URL}/functions/v1/dropbox-api?action=get-temporary-link`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ path: (asset as any).dropbox_path }),
                }
              );
              if (res.ok) assetUrl = (await res.json()).link ?? null;
            }
          } catch { /* ignore */ }
        }
        if (!assetUrl && (asset as any)?.storage_path) {
          const rawPath = ((asset as any).storage_path as string).replace(/^\/+/, "");
          const { data: urlData } = supabase.storage.from("scene-assets").getPublicUrl(rawPath);
          assetUrl = urlData.publicUrl || null;
        }

        setFocus({
          kind: "review",
          round: {
            id: clientRound.id,
            round_number: clientRound.round_number,
            status: clientRound.status,
            image_url: clientRound.image_url,
            scene_id: clientRound.scene_id,
            scene_name: (clientRound as any).scenes?.name || null,
            project_name: (clientRound as any).scenes?.projects?.name || null,
            delivered_at: clientRound.delivered_at,
            asset_url: assetUrl,
          },
        });
        return;
      }
      } // end accountType !== 'partnership'

      // 4. Pending order
      const { data: orders } = await supabase
        .from("orders")
        .select("id, title, total, currency")
        .eq("account_id", aid)
        .eq("status", "pending_acceptance")
        .order("created_at", { ascending: true })
        .limit(1);

      if (orders && orders.length > 0) {
        setFocus({ kind: "order", order: orders[0] as PendingOrder });
        return;
      }

      // 5. Nothing
      setFocus({ kind: "idle" });

    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setFocus({ kind: "idle" });
    }
  }

  async function handleCreateCorrections(instructions: string, deliveryDate?: Date, startDate?: Date) {
    if (focus.kind !== "review") return;
    const round = focus.round;
    try {
      const { error } = await supabase
        .from("scene_rounds")
        .insert({
          scene_id: round.scene_id,
          round_number: round.round_number + 1,
          status: "pending",
          start_date: (startDate ?? new Date()).toISOString(),
          instructions,
          ...(deliveryDate ? { end_date: deliveryDate.toISOString() } : {}),
        });
      if (error) throw error;

      // Move old round out of the dashboard's review filter
      await supabase
        .from("scene_rounds")
        .update({ status: "in_production" })
        .eq("id", round.id);

      await logActivity({
        action: "revision_requested",
        description: `Submitted corrections for ${round.scene_name || "scene"} — Round ${round.round_number + 1} requested`,
        entityType: "scene_round",
        entityId: round.id,
        metadata: { round_number: round.round_number + 1 },
      });

      setNewRoundModalOpen(false);
      setReviewOverlayOpen(false);
      sonnerToast.success("Corrections submitted — Round " + (round.round_number + 1).toString().padStart(2, "0") + " is in the queue");
      fetchFocus();
    } catch (err: any) {
      console.error("Error submitting corrections:", err);
      sonnerToast.error(err.message || "Failed to submit corrections");
    }
  }

  const glowVariant =
    focus.kind === "delivered" ? "gold" :
    focus.kind === "countdown" ? "green" :
    "none";

  return (
    <ClientLayout>
      <AmbientGlow variant={glowVariant} />
      <div className="relative z-10">
        <AnimatePresence mode="wait">
          {focus.kind === "loading" && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-center min-h-[60vh]"
            >
              <div className="h-5 w-5 rounded-full border border-gold/40 border-t-gold animate-spin" />
            </motion.div>
          )}

          {focus.kind === "delivered" && (
            <DeliveredView
              task={focus.task}
              onNext={() => navigate("/delivery")}
            />
          )}

          {focus.kind === "countdown" && (
            <CountdownView task={focus.task} />
          )}

          {focus.kind === "review" && (
            <ReviewView
              round={focus.round}
              onOpenReview={() => setReviewOverlayOpen(true)}
            />
          )}

          {focus.kind === "order" && (
            <OrderView
              order={focus.order}
              onNavigate={() => navigate("/orders")}
            />
          )}

          {focus.kind === "idle" && <IdleView />}
        </AnimatePresence>
      </div>

      {/* ── Review overlay ────────────────────────────────────────────────── */}
      {reviewOverlayOpen && focus.kind === "review" && (
        <>
          <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
            <div className="relative max-w-5xl mx-auto px-6 py-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="font-sans uppercase text-[9px] tracking-[0.28em] text-gold">
                    {focus.round.project_name}
                  </p>
                  <h2 className="font-serif text-xl font-normal text-foreground mt-0.5">
                    {focus.round.scene_name || "Scene"} · Round {String(focus.round.round_number).padStart(2, "0")}
                  </h2>
                </div>
                <button
                  onClick={() => setReviewOverlayOpen(false)}
                  className="text-foreground/40 hover:text-foreground transition-colors"
                  aria-label="Close review"
                >
                  <X className="h-5 w-5" strokeWidth={1} />
                </button>
              </div>
              <AssetViewer
                sceneRoundId={focus.round.id}
                sceneName={focus.round.scene_name || ""}
                projectName={focus.round.project_name ?? undefined}
                roundNumber={focus.round.round_number}
                onClose={() => setReviewOverlayOpen(false)}
                onRequestNextRound={() => setNewRoundModalOpen(true)}
                nextRoundNumber={focus.round.round_number + 1}
                siblingRounds={[{ id: focus.round.id, round_number: focus.round.round_number, status: focus.round.status }]}
              />
            </div>
          </div>
          <NewRoundModal
            isOpen={newRoundModalOpen}
            onClose={() => setNewRoundModalOpen(false)}
            onCreate={(instr) => handleCreateCorrections(instr)}
            onCreateWithDate={(instr, dd, sd) => handleCreateCorrections(instr, dd, sd)}
            sceneName={focus.round.scene_name || ""}
            sceneId={focus.round.scene_id}
            roundNumber={focus.round.round_number + 1}
          />
        </>
      )}
    </ClientLayout>
  );
}
