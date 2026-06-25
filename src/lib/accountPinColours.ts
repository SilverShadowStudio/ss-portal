// Fixed, per-account pin colour order.
//
// Unlike CLIENT_INVITEE_PIN_COLOURS (a palette walked at invite time and
// persisted to account_members.pin_colour), these colours are assigned purely
// by member ORDER at render time — so every viewer sees the same colour for the
// same member, and NO database write is required. The order key is
// account_members.created_at ASC (immutable row-insert time, present for every
// member, identical for all viewers). The account owner/Manager row is created
// first, so it deterministically takes slot 1.
//
//   1st member = fluo green · 2nd = fluo blue · 3rd = fluo red · 4th+ = extended
//
// White pin initials are kept (see PinMarker); the brightest values carry a thin
// dark text outline there for legibility.
export const ACCOUNT_PIN_COLOURS = [
  "#00E676", // 1 · fluo green
  "#2979FF", // 2 · fluo blue
  "#FF1744", // 3 · fluo red
  "#FF9100", // 4 · fluo orange
  "#D500F9", // 5 · fluo violet
  "#00E5FF", // 6 · fluo cyan
  "#FFEA00", // 7 · fluo yellow
  "#FF4081", // 8 · fluo pink
] as const;

// Fallback for authors with no account membership (studio/admin users) or
// ids that cannot be resolved — the existing brand gold.
export const ACCOUNT_PIN_FALLBACK_COLOUR = "#B89A6A";

/** Colour for the member at a given zero-based account position. */
export function accountPinColourByIndex(index: number): string {
  if (index < 0) return ACCOUNT_PIN_FALLBACK_COLOUR;
  return ACCOUNT_PIN_COLOURS[index % ACCOUNT_PIN_COLOURS.length];
}

import { supabase } from "@/integrations/supabase/client";

/**
 * Build a deterministic `user_id → colour` map for the account that the given
 * author ids belong to.
 *
 * Resolves the account from any author's membership, then orders ALL of that
 * account's members by created_at and assigns the fixed palette by position.
 * Returns an empty map when no account membership is found (e.g. only
 * studio/admin authors) — callers fall back to ACCOUNT_PIN_FALLBACK_COLOUR.
 * Read-only: performs no writes.
 */
export async function fetchAccountPinColourMap(
  authorIds: Array<string | null | undefined>,
): Promise<Record<string, string>> {
  const ids = Array.from(new Set(authorIds.filter(Boolean))) as string[];
  if (ids.length === 0) return {};

  const { data: anyMember } = await supabase
    .from("account_members")
    .select("account_id")
    .in("user_id", ids)
    .limit(1)
    .maybeSingle();
  const accountId = (anyMember as { account_id?: string } | null)?.account_id;
  if (!accountId) return {};

  const { data: members } = await supabase
    .from("account_members")
    .select("user_id, created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true });

  const map: Record<string, string> = {};
  (members ?? []).forEach((m: { user_id: string }, i: number) => {
    map[m.user_id] = accountPinColourByIndex(i);
  });
  return map;
}
