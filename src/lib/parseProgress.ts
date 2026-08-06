// Real progress for invoice parsing.
//
// A parse is one opaque call to Claude per file — there is no server-side
// progress to stream back. So honest progress here means two things:
//
//   1. CALIBRATE, don't invent. Every completed parse records how long it
//      actually took. The estimate is the median of the last 20 real parses on
//      this machine, so the bar reflects how fast this account's invoices
//      genuinely parse rather than a number someone guessed once.
//   2. NEVER CLAIM DONE. A file in flight approaches but never reaches 100%.
//      When it runs past its estimate the bar holds near the top and the
//      caption says so, instead of showing a stuck 100% or a negative ETA.
//
// The first ever drop has no history and uses SEED_MS — it self-corrects from
// the very next file.

const STORAGE_KEY = "ss-portal.overhead-parse-durations";
const HISTORY = 20;

/** Until there's real history. Replaced by measured medians after one parse. */
export const SEED_MS = 14_000;

/** A file in flight is never shown as more than this — only its response
 *  landing takes it to complete. */
export const MAX_INFLIGHT_FRACTION = 0.94;

function readHistory(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);
  } catch {
    return []; // private mode, corrupt value — fall back to the seed
  }
}

/** Record how long a parse actually took, keeping the last HISTORY samples. */
export function recordParseDuration(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  try {
    const next = [...readHistory(), ms].slice(-HISTORY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not being able to remember is not worth interrupting a drop for.
  }
}

/**
 * Expected milliseconds for one parse — the median of real measurements.
 * Median, not mean, so a single 60-second outlier doesn't skew every later
 * estimate upward.
 */
export function expectedParseMs(): number {
  const history = readHistory();
  if (history.length === 0) return SEED_MS;
  const sorted = [...history].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface ProgressInput {
  total: number;
  completed: number;
  /** Start timestamp of each file currently being parsed. */
  inFlightStartedAt: number[];
  /** How many parses run at once. */
  concurrency: number;
  expectedMs: number;
  now: number;
}

export interface ProgressOutput {
  /** 0–1 across the whole drop. */
  fraction: number;
  /** Milliseconds remaining, or null when we're past the estimate and honestly
   *  don't know. */
  remainingMs: number | null;
  /** True once the drop has overrun its estimate. */
  overrunning: boolean;
}

/**
 * Blend finished files with the partial progress of the ones in flight, then
 * turn the work left into wall-clock using how many parses run in parallel.
 */
export function computeProgress({
  total,
  completed,
  inFlightStartedAt,
  concurrency,
  expectedMs,
  now,
}: ProgressInput): ProgressOutput {
  if (total <= 0) return { fraction: 0, remainingMs: null, overrunning: false };

  let inFlightFraction = 0;
  // Work still to do, measured in file-equivalents.
  let workLeft = 0;
  let anyOverrun = false;

  for (const startedAt of inFlightStartedAt) {
    const elapsed = Math.max(0, now - startedAt);
    const raw = elapsed / expectedMs;
    if (raw >= 1) anyOverrun = true;
    const capped = Math.min(raw, MAX_INFLIGHT_FRACTION);
    inFlightFraction += capped;
    workLeft += 1 - capped;
  }

  const queued = Math.max(0, total - completed - inFlightStartedAt.length);
  workLeft += queued;

  const fraction = Math.min(1, (completed + inFlightFraction) / total);

  // Files left to touch at all — that's what bounds how many can run at once.
  const filesLeft = inFlightStartedAt.length + queued;
  const workers = Math.max(1, Math.min(concurrency, filesLeft));
  const remainingMs = anyOverrun ? null : Math.round((workLeft / workers) * expectedMs);

  return { fraction, remainingMs, overrunning: anyOverrun };
}

/** "~1m 20s remaining" / "~8s remaining". */
export function formatRemaining(ms: number | null): string {
  if (ms == null) return "taking longer than usual";
  const s = Math.ceil(ms / 1000);
  if (s <= 0) return "almost there";
  if (s < 60) return `~${s}s remaining`;
  const m = Math.floor(s / 60);
  return `~${m}m ${String(s % 60).padStart(2, "0")}s remaining`;
}
