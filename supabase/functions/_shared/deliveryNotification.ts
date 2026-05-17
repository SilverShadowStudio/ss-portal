// Shared delivery-notification helpers.
//
// Both dropbox-webhook and dropbox-scan-visuals deliver rounds and need to
// enqueue a notification email. The webhook path is currently dormant
// (folder_mappings empty); the scan-visuals path is the active production
// flow. Same logic, one source of truth.
//
// Idempotency is enforced at the DB level by the partial unique index on
// pending_delivery_notifications (scene_round_id) WHERE sent_at IS NULL, so
// repeat calls for the same round are safe — the second insert is rejected
// with a duplicate-key error and we swallow it.

// The supabase param is typed loosely on purpose: each caller imports a
// version of supabase-js that's compatible at runtime but may differ at the
// type level. Behaviourally we only call .from(...), .auth.admin.getUserById,
// and .insert/.select/.eq.
type SupabaseClientLike = any

/**
 * UK quiet-hours gating. Within 09:00-20:00 Europe/London → return now.
 * Otherwise → return the UTC instant matching 09:00 the next eligible
 * UK morning (today if pre-09:00, tomorrow if post-20:00). Handles BST/GMT
 * automatically via Intl.DateTimeFormat with timeZone: 'Europe/London'.
 */
export function computeUkSendAt(now: Date): Date {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>
  const ukHour = parseInt(parts.hour, 10)
  if (ukHour >= 9 && ukHour < 20) return now

  const targetDay = ukHour >= 20
    ? new Date(now.getTime() + 24 * 60 * 60 * 1000)
    : now
  const targetParts = Object.fromEntries(
    fmt.formatToParts(targetDay).map((p) => [p.type, p.value]),
  ) as Record<string, string>
  const targetLocal = `${targetParts.year}-${targetParts.month}-${targetParts.day}T09:00:00`
  for (const offsetH of [0, -1, 1]) {
    const candidate = new Date(Date.parse(`${targetLocal}Z`) - offsetH * 3600 * 1000)
    const candParts = Object.fromEntries(
      fmt.formatToParts(candidate).map((p) => [p.type, p.value]),
    ) as Record<string, string>
    if (
      candParts.year === targetParts.year &&
      candParts.month === targetParts.month &&
      candParts.day === targetParts.day &&
      candParts.hour === "09"
    ) {
      return candidate
    }
  }
  return targetDay
}

/**
 * Insert a pending_delivery_notifications row for a freshly delivered round.
 * Callers should invoke this only when the round actually transitions to
 * delivered (i.e. previously NOT in delivered/client_review/approved). The
 * partial unique index protects against duplicate enqueues anyway.
 */
export async function enqueueDeliveryNotification(
  supabase: SupabaseClientLike,
  args: { sceneRoundId: string; sceneId: string; roundNumber: number },
): Promise<void> {
  const { data: scene } = await supabase
    .from("scenes")
    .select("name, project_id, projects(name, account_id)")
    .eq("id", args.sceneId)
    .maybeSingle()
  const project = (scene as any)?.projects ?? null
  const projectId: string | null = (scene as any)?.project_id ?? null
  const accountId: string | null = project?.account_id ?? null
  if (!accountId) {
    console.warn("[deliveryNotification] no account_id for scene", args.sceneId)
    return
  }

  // Snapshot recipients at enqueue time so the email reflects who was on
  // the account at delivery, not at send time (membership can shift).
  const { data: members } = await supabase
    .from("account_members")
    .select("user_id")
    .eq("account_id", accountId)
  const recipients: string[] = []
  for (const m of members ?? []) {
    const uid = (m as any).user_id as string | null
    if (!uid) continue
    try {
      const { data } = await supabase.auth.admin.getUserById(uid)
      if (data?.user?.email) recipients.push(data.user.email)
    } catch (e) {
      console.warn("[deliveryNotification] getUserById failed", uid, e)
    }
  }

  const sendAt = computeUkSendAt(new Date())
  const payload = {
    project_id: projectId,
    scene_id: args.sceneId,
    round_id: args.sceneRoundId,
    project_name: project?.name ?? null,
    scene_name: (scene as any)?.name ?? null,
    round_number: args.roundNumber,
    recipients,
  }

  const { error: enqueueErr } = await supabase
    .from("pending_delivery_notifications")
    .insert({
      scene_round_id: args.sceneRoundId,
      account_id: accountId,
      send_at: sendAt.toISOString(),
      payload,
    })
  // Duplicate-key error from the partial unique index = round already queued
  // for this delivery. Expected; swallow.
  if (enqueueErr && !String(enqueueErr.message ?? "").includes("duplicate")) {
    console.warn("[deliveryNotification] insert failed", enqueueErr)
  }
}
