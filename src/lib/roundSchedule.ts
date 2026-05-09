/**
 * Round scheduling spec
 * --------------------
 * For any newly requested round:
 *   • The "order deadline" is the next Friday at 09:00 (local time) from now.
 *     Past today's Friday-9am, we roll to the following Friday.
 *   • Production starts on the Monday at 10:00 immediately following that
 *     Friday-9am deadline.
 *   • Delivery is exactly 7 days and 1 hour after start — i.e. the next
 *     Monday at 11:00.
 *
 * Centralised here so the client modal, the timeline, and any countdown copy
 * all stay in sync.
 */

function setTime(d: Date, h: number, m = 0): Date {
  const out = new Date(d.getTime());
  out.setHours(h, m, 0, 0);
  return out;
}

/** Next Friday at 09:00 strictly after `from` (or today if today is Fri before 09:00). */
export function nextOrderDeadline(from: Date = new Date()): Date {
  // 0=Sun,1=Mon,...,5=Fri,6=Sat
  const day = from.getDay();
  let daysUntilFri = (5 - day + 7) % 7;
  let candidate = setTime(from, 9, 0);
  candidate.setDate(candidate.getDate() + daysUntilFri);
  // If we landed on today's Friday but the 09:00 mark already passed, push to next week.
  if (candidate.getTime() <= from.getTime()) {
    candidate = new Date(candidate.getTime());
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate;
}

/** Monday 10:00 immediately after the order deadline (Friday 09:00). */
export function roundStartDate(from: Date = new Date()): Date {
  const friday = nextOrderDeadline(from);
  const monday = new Date(friday.getTime());
  monday.setDate(monday.getDate() + 3); // Fri -> Mon
  return setTime(monday, 10, 0);
}

/** Delivery = start + 7 days + 1 hour = following Monday at 11:00. */
export function roundDeliveryDate(from: Date = new Date()): Date {
  const start = roundStartDate(from);
  const delivery = new Date(start.getTime());
  delivery.setDate(delivery.getDate() + 7);
  delivery.setHours(delivery.getHours() + 1);
  return delivery;
}

export interface RoundSchedule {
  orderDeadline: Date;
  start: Date;
  delivery: Date;
}

export function computeRoundSchedule(from: Date = new Date()): RoundSchedule {
  const orderDeadline = nextOrderDeadline(from);
  const start = roundStartDate(from);
  const delivery = roundDeliveryDate(from);
  return { orderDeadline, start, delivery };
}