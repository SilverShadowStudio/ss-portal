// IMPORTANT: This file is duplicated and MUST stay byte-identical across:
//   - src/lib/clientMemberColours.ts                    (frontend: swatches, rendering)
//   - supabase/functions/_shared/clientMemberColours.ts (edge functions: colour assignment)
// Frontend and edge-function copies must match. Mirrors the LOGO_URL
// duplication pattern documented in CLAUDE.md — change both together.

// Client-Invitee pen colour palette — ordered by typical invitation sequence.
// Each colour reads on both warm/dark and cream/light scene backgrounds.
export const CLIENT_INVITEE_PIN_COLOURS = [
  "#5B7C99", // cool blue
  "#7A8C6E", // sage green
  "#C97B63", // warm coral
  "#8B6B9E", // deep purple
  "#D4A56A", // soft amber
  "#5E8F8F", // teal
  "#B89499", // dusty rose
  "#6B7480", // slate
] as const;

// Client-Manager pen colour is the brand gold accent.
export const CLIENT_MANAGER_PIN_COLOUR = "#B89A6A";

/**
 * Pick the next palette colour not already used by a member of the account.
 * `taken` is the list of pin_colour values currently assigned in the account.
 * If all eight are taken, wrap around (real-world client teams are 2-4 people).
 */
export function nextInviteeColour(
  taken: Array<string | null | undefined>,
): string {
  const used = new Set(
    taken.filter(Boolean).map((c) => (c as string).toUpperCase()),
  );
  for (const colour of CLIENT_INVITEE_PIN_COLOURS) {
    if (!used.has(colour.toUpperCase())) return colour;
  }
  return CLIENT_INVITEE_PIN_COLOURS[
    used.size % CLIENT_INVITEE_PIN_COLOURS.length
  ];
}
