import { useEffect, useRef, useState } from "react";

/**
 * Per-id timers for a "grace" window — e.g. keep a just-actioned row visible
 * for a few minutes so a mistake can be reverted, then auto-remove it.
 * Timers are cleared on unmount.
 */
export function useGraceTimers() {
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => () => { for (const id in timers.current) clearTimeout(timers.current[id]); }, []);
  const schedule = (id: string, ms: number, fn: () => void) => {
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => { delete timers.current[id]; fn(); }, ms);
  };
  const cancel = (id: string) => { clearTimeout(timers.current[id]); delete timers.current[id]; };
  return { schedule, cancel };
}

export const GRACE_MS = 5 * 60 * 1000;

/** Re-renders once a second while `active` (for live countdowns); returns now(ms). */
export function useNowTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** ms → "M:SS" */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
