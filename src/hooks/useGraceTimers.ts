import { useEffect, useRef } from "react";

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
