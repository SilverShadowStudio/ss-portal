import { describe, expect, it } from "vitest";
import {
  computeProgress,
  formatRemaining,
  MAX_INFLIGHT_FRACTION,
} from "@/lib/parseProgress";

const EXPECTED = 10_000; // 10s per parse, for round numbers

describe("computeProgress", () => {
  // The bug this replaces: one file, ETA only computed on completion, so the
  // bar sat at 0% and said "finishing…" for the entire parse.
  it("moves during a single file's parse", () => {
    const t0 = 1_000_000;
    const at3s = computeProgress({
      total: 1, completed: 0, inFlightStartedAt: [t0],
      concurrency: 2, expectedMs: EXPECTED, now: t0 + 3_000,
    });
    expect(at3s.fraction).toBeCloseTo(0.3, 5);
    expect(at3s.remainingMs).toBe(7_000);
    expect(at3s.overrunning).toBe(false);
  });

  it("never claims a file in flight is finished", () => {
    const t0 = 1_000_000;
    const nearlyThere = computeProgress({
      total: 1, completed: 0, inFlightStartedAt: [t0],
      concurrency: 2, expectedMs: EXPECTED, now: t0 + 9_900,
    });
    expect(nearlyThere.fraction).toBeLessThanOrEqual(MAX_INFLIGHT_FRACTION);
    expect(nearlyThere.fraction).toBeLessThan(1);
  });

  it("admits it doesn't know once past the estimate, instead of lying", () => {
    const t0 = 1_000_000;
    const overrun = computeProgress({
      total: 1, completed: 0, inFlightStartedAt: [t0],
      concurrency: 2, expectedMs: EXPECTED, now: t0 + 25_000,
    });
    expect(overrun.overrunning).toBe(true);
    expect(overrun.remainingMs).toBeNull();
    // Still capped — it must not read as complete while the call is open.
    expect(overrun.fraction).toBeCloseTo(MAX_INFLIGHT_FRACTION, 5);
  });

  it("reaches exactly 1 only when every file is done", () => {
    const done = computeProgress({
      total: 3, completed: 3, inFlightStartedAt: [],
      concurrency: 2, expectedMs: EXPECTED, now: 0,
    });
    expect(done.fraction).toBe(1);
    expect(done.remainingMs).toBe(0);
  });

  it("counts finished files plus partial progress on the ones in flight", () => {
    const t0 = 1_000_000;
    const p = computeProgress({
      total: 4, completed: 2, inFlightStartedAt: [t0, t0],
      concurrency: 2, expectedMs: EXPECTED, now: t0 + 5_000,
    });
    // 2 done + two files half way = 3 of 4
    expect(p.fraction).toBeCloseTo(0.75, 5);
  });

  it("divides remaining work by how many parses actually run at once", () => {
    const t0 = 1_000_000;
    // 4 files queued, none started, concurrency 2 → two rounds of 10s.
    const p = computeProgress({
      total: 4, completed: 0, inFlightStartedAt: [],
      concurrency: 2, expectedMs: EXPECTED, now: t0,
    });
    expect(p.remainingMs).toBe(20_000);
  });

  it("doesn't assume more workers than files left", () => {
    const t0 = 1_000_000;
    // One file left, concurrency 2 — it can't finish in half the time.
    const p = computeProgress({
      total: 5, completed: 4, inFlightStartedAt: [t0],
      concurrency: 2, expectedMs: EXPECTED, now: t0,
    });
    expect(p.remainingMs).toBe(10_000);
  });

  it("handles an empty drop without dividing by zero", () => {
    const p = computeProgress({
      total: 0, completed: 0, inFlightStartedAt: [],
      concurrency: 2, expectedMs: EXPECTED, now: 0,
    });
    expect(p.fraction).toBe(0);
    expect(p.remainingMs).toBeNull();
  });
});

describe("formatRemaining", () => {
  it("says seconds under a minute", () => {
    expect(formatRemaining(7_000)).toBe("~7s remaining");
  });

  it("says minutes and seconds above one", () => {
    expect(formatRemaining(80_000)).toBe("~1m 20s remaining");
  });

  it("is honest when the estimate has been blown", () => {
    expect(formatRemaining(null)).toBe("taking longer than usual");
  });

  it("doesn't say '0s remaining'", () => {
    expect(formatRemaining(0)).toBe("almost there");
  });
});
