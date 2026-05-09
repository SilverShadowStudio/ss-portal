import { useCallback, useEffect, useRef, useState } from "react";

interface ZoomScaleProps {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  width?: number; // track width in px
}

/**
 * Discreet, FCP-style horizontal zoom scale with a small dot handle.
 * Drives a continuous numeric value via pointer drag (no step snapping).
 *
 * - Pointer events for unified mouse/touch/pen handling
 * - rAF-throttled updates → silky drag, no layout thrash
 * - Logarithmic mapping so the perceived zoom rate feels even at all scales
 */
export function ZoomScale({ value, min, max, onChange, width = 140 }: ZoomScaleProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const pendingValueRef = useRef<number | null>(null);
  const [hover, setHover] = useState(false);

  // Logarithmic <-> linear mappings keep zoom feel consistent across the range.
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  const valueToFraction = (v: number) =>
    Math.max(0, Math.min(1, (Math.log(v) - logMin) / (logMax - logMin)));
  const fractionToValue = (f: number) =>
    Math.exp(logMin + Math.max(0, Math.min(1, f)) * (logMax - logMin));

  const fraction = valueToFraction(value);

  const flush = useCallback(() => {
    rafRef.current = null;
    if (pendingValueRef.current !== null) {
      onChange(pendingValueRef.current);
      pendingValueRef.current = null;
    }
  }, [onChange]);

  const updateFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const f = (clientX - rect.left) / rect.width;
    const next = fractionToValue(f);
    pendingValueRef.current = next;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flush);
    }
  }, [flush]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    updateFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    updateFromClientX(e.clientX);
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (pendingValueRef.current !== null) {
      onChange(pendingValueRef.current);
      pendingValueRef.current = null;
    }
  };

  // Keyboard accessibility: ←/→ adjust by ~3% of log range, Home/End to bounds.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const stepFrac = 0.03;
    let nextF = fraction;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") nextF -= stepFrac;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") nextF += stepFrac;
    else if (e.key === "Home") nextF = 0;
    else if (e.key === "End") nextF = 1;
    else return;
    e.preventDefault();
    onChange(fractionToValue(nextF));
  };

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div
      className="flex items-center gap-2 select-none"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="text-[9px] font-bold tracking-[0.18em] text-muted-foreground/50">−</span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Timeline zoom"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className="relative h-5 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded"
        style={{ width }}
      >
        {/* Track */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-border" />
        {/* Filled portion */}
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-px bg-primary/60"
          style={{ width: `${fraction * 100}%` }}
        />
        {/* Handle */}
        <div
          className={`absolute top-1/2 h-2.5 w-2.5 rounded-full border border-primary/70 bg-primary shadow-sm transition-transform ${
            hover || draggingRef.current ? "scale-110" : ""
          }`}
          style={{
            left: `${fraction * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      </div>
      <span className="text-[9px] font-bold tracking-[0.18em] text-muted-foreground/50">+</span>
    </div>
  );
}
