/** True when the error is a "this row already exists" unique-constraint clash. */
export function isDuplicateError(raw?: string | null): boolean {
  const m = (raw || "").toLowerCase();
  return m.includes("duplicate key") || m.includes("unique constraint") || m.includes("unique_idx") || m.includes("already exists");
}

/**
 * Turn raw Postgres/PostgREST error text into something a human can act on.
 * Falls back to the original message when we don't recognise it.
 */
export function friendlyDbError(raw?: string | null): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("duplicate key") || m.includes("unique constraint") || m.includes("unique_idx") || m.includes("already exists")) {
    return "This looks like it's already recorded (same supplier and invoice number). Skip it — or change the invoice number if it's genuinely a different bill.";
  }
  if (m.includes("invalid invoice type")) {
    return "That invoice type isn't accepted yet — this is a portal bug, not your data.";
  }
  if (m.includes("row-level security") || m.includes("permission denied")) {
    return "You don't have permission to save this here.";
  }
  return raw || "Something went wrong — please try again.";
}
