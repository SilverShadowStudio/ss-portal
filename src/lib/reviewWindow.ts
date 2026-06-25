/**
 * Compute the client-review window applied when admin delivers a round.
 *
 * Spec (per product):
 *   start  = the moment of delivery
 *   end    = the **following Friday at 14:00**, with the count starting
 *            **after 2 days**.
 *
 * Concretely: take `delivery + 2 days`, then jump to the next Friday on or
 * after that target. If the target itself is a Friday, the same Friday at
 * 14:00 is used (it is "the following Friday after the 2-day buffer").
 *
 * Returned dates are kept in the local server-side timezone of the JS
 * runtime, exactly mirroring how the rest of the app stores `start_date` /
 * `end_date` (ISO strings via `toISOString()` at the call site).
 */
export function computeReviewWindow(deliveredAt: Date = new Date()): {
  start: Date;
  end: Date;
} {
  const start = new Date(deliveredAt.getTime());

  // Step 1: count starts after 2 full days.
  const target = new Date(start.getTime());
  target.setDate(target.getDate() + 2);

  // Step 2: find the next Friday on or after `target` (Friday = 5).
  const day = target.getDay();
  const daysUntilFriday = (5 - day + 7) % 7;
  const friday = new Date(target.getTime());
  friday.setDate(friday.getDate() + daysUntilFriday);

  // Step 3: pin to 14:00 local time.
  friday.setHours(14, 0, 0, 0);

  return { start, end: friday };
}

/**
 * Minimum lead time between a round's request date and its delivery date.
 * A delivery on or before the request — or inside this lead — produces an
 * impossible timeline window (the "0D 0H total / 0% elapsed" card).
 */
export const MIN_DELIVERY_LEAD_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Guard a proposed delivery date against the round's request date.
 *
 * Rule: delivery must be strictly after the request, with at least one full
 * day of lead. Used by the admin delivery-date editor and by the round-create
 * write paths so a backwards/zero-length window can never be persisted.
 *
 * When `requestDate` is invalid (e.g. created_at not yet loaded) there is no
 * reference to compare against, so we only reject an outright-invalid delivery.
 */
export function validateDeliveryDate(
  deliveryDate: Date,
  requestDate: Date,
): { ok: boolean; error?: string } {
  if (!(deliveryDate instanceof Date) || isNaN(deliveryDate.getTime())) {
    return { ok: false, error: "Pick a valid delivery date." };
  }
  if (!(requestDate instanceof Date) || isNaN(requestDate.getTime())) {
    return { ok: true };
  }
  if (deliveryDate.getTime() <= requestDate.getTime()) {
    return { ok: false, error: "Delivery must be after the request date." };
  }
  if (deliveryDate.getTime() < requestDate.getTime() + MIN_DELIVERY_LEAD_MS) {
    return { ok: false, error: "Delivery must be at least one day after the request date." };
  }
  return { ok: true };
}

import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activityLog";

/**
 * Side-effects applied to scene_rounds when admin delivers a round:
 *   1. Mark the production round as `delivered`, stamp `delivered_at`, and
 *      cap its `end_date` at the delivery moment so its timeline bar stops
 *      growing the instant the file lands.
 *   2. Insert a sibling **review round** (same `scene_id` + `round_number`,
 *      `kind='review'`, `status='client_review'`) running from now until the
 *      computed review-window end.
 *
 * Idempotent: if a review row already exists for this (scene, round_number),
 * we don't insert a duplicate — re-uploads on the same round just refresh
 * the existing review row's start/end.
 */
export async function deliverRoundAndStartReview(roundId: string): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const { start, end } = computeReviewWindow(now);

  // Read the round so we can find its scene_id + round_number.
  const { data: round, error: readErr } = await supabase
    .from("scene_rounds")
    .select("id, scene_id, round_number, kind")
    .eq("id", roundId)
    .maybeSingle();
  if (readErr || !round) {
    console.error("deliverRoundAndStartReview: round not found", readErr);
    return;
  }

  // 1) Cap & flip the production round.
  await supabase
    .from("scene_rounds")
    .update({
      status: "delivered",
      delivered_at: nowIso,
      end_date: nowIso,
    })
    .eq("id", roundId);

  // 2) Upsert the sibling review round.
  const { data: existingReview } = await supabase
    .from("scene_rounds")
    .select("id")
    .eq("scene_id", round.scene_id)
    .eq("round_number", round.round_number)
    .eq("kind", "review")
    .maybeSingle();

  if (existingReview) {
    await supabase
      .from("scene_rounds")
      .update({
        status: "client_review",
        start_date: start.toISOString(),
        end_date: end.toISOString(),
      })
      .eq("id", existingReview.id);
  } else {
    await supabase.from("scene_rounds").insert({
      scene_id: round.scene_id,
      round_number: round.round_number,
      kind: "review",
      status: "client_review",
      start_date: start.toISOString(),
      end_date: end.toISOString(),
    });
  }

  // Activity log: round delivery is a production-critical event.
  try {
    const { data: scene } = await supabase
      .from("scenes")
      .select("id, name, project_id, projects(name)")
      .eq("id", round.scene_id)
      .maybeSingle();
    const sceneName = (scene as any)?.name ?? null;
    const projectName = (scene as any)?.projects?.name ?? null;
    const projectId = (scene as any)?.project_id ?? null;
    await logActivity({
      action: "round_delivered",
      description: `Delivered Round ${String(round.round_number).padStart(2, "0")}`,
      entityType: "scene_round",
      entityId: roundId,
      projectId,
      projectName,
      sceneId: round.scene_id,
      sceneName,
      roundId,
      roundNumber: round.round_number,
    });
  } catch (err) {
    console.warn("activity log (round_delivered) failed", err);
  }
}