// Single source of truth for motion in the portal.
// Every transition, framer-motion duration, and Tailwind `duration-*` should
// either import from here directly or use the matching tailwind utility
// (duration-quick / duration-standard / duration-deliberate / duration-signature,
//  ease-default / ease-signature) which is wired to these same tokens.

export const DURATION = {
  instant: 0,
  quick: 180,
  standard: 320,
  deliberate: 560,
  signature: 1200,
} as const;

export const EASING = {
  default: 'cubic-bezier(0.32, 0.72, 0, 1)',
  signature: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

// Framer Motion expects either a named ease (no custom bezier strings) or a
// 4-number cubic-bezier array. These mirror EASING.* for use in transition props.
export const FM_EASE = {
  default: [0.32, 0.72, 0, 1] as [number, number, number, number],
  signature: [0.16, 1, 0.3, 1] as [number, number, number, number],
};

// Build a tween transition object for framer-motion. durationMs is in
// milliseconds for consistency with the rest of the token system; framer-motion
// receives it converted to seconds.
export function fmTween(
  durationMs: number,
  ease: [number, number, number, number] = FM_EASE.default,
) {
  return { type: 'tween' as const, duration: durationMs / 1000, ease };
}

// Stagger settings for lists that enter together.
export const STAGGER_MS = 40;
export const STAGGER_CAP = 8;

// Clamp a list-entry index so a long list still finishes staggering in
// STAGGER_MS * STAGGER_CAP milliseconds. Use as `delay: staggerDelay(i)`.
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_CAP - 1) * STAGGER_MS;
}
