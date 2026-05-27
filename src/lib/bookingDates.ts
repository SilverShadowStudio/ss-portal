// Mondays-only constraint for v1. Architecturally supports any day for future removal.

export const BOOKING_DAYS_AHEAD_MIN = 7; // First round must start ≥ 7 days from now
export const ROUND_DURATION_DAYS = 7;
export const RESERVATION_HOLD_DAYS = 7; // Reservation lapses 7 days before first round Monday

export function isMonday(date: Date): boolean {
  return date.getDay() === 1;
}

export function getNextMonday(from: Date): Date {
  const d = new Date(from);
  const day = d.getDay();
  const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getEarliestBookableMonday(): Date {
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + BOOKING_DAYS_AHEAD_MIN);
  return getNextMonday(minDate);
}

export function getRoundEndDate(startDate: Date): Date {
  const end = new Date(startDate);
  end.setDate(end.getDate() + ROUND_DURATION_DAYS);
  return end;
}

export function getReservationExpiry(firstRoundStart: Date): Date {
  const expiry = new Date(firstRoundStart);
  expiry.setDate(expiry.getDate() - RESERVATION_HOLD_DAYS);
  return expiry;
}

// Get all Mondays in a date range (for calendar grid)
export function getMondaysInRange(start: Date, end: Date): Date[] {
  const mondays: Date[] = [];
  const current = getNextMonday(start);
  while (current <= end) {
    mondays.push(new Date(current));
    current.setDate(current.getDate() + 7);
  }
  return mondays;
}

// ── Small presentation helpers (shared by the booking modal + basket) ───────

/** "1 Jun" style short date for week-block labels. */
export function formatDayMonth(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Same calendar day? (ignores time) */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
