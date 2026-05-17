import ssIcon from "@/assets/ss-icon.png";
import { cn } from "@/lib/utils";

interface BrandLoaderProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<BrandLoaderProps["size"]>, string> = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-10 w-10",
};

/**
 * Brand loading indicator — pulsing Silvershadow SS icon.
 * Single source of truth for in-flight / loading states across the portal.
 * Replaces every Loader2 + animate-spin div spinner. LoginSplash keeps its
 * own bespoke entry animation and is intentionally excluded.
 */
export function BrandLoader({ size = "md", className }: BrandLoaderProps) {
  return (
    <img
      src={ssIcon}
      alt=""
      aria-hidden
      className={cn(
        SIZE_CLASSES[size],
        "shrink-0 select-none brightness-0 dark:invert animate-brand-pulse",
        className,
      )}
      draggable={false}
    />
  );
}
