import { ImgHTMLAttributes, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Image wrapper that shows a skeleton placeholder until the image has
 * finished loading (or errored). Uses a module-level cache so that images
 * already preloaded via `preloadImages` render instantly without flashing
 * the skeleton.
 */

const loadedSrcs = new Set<string>();

export function markImageLoaded(src: string) {
  if (src) loadedSrcs.add(src);
}

export function isImageLoaded(src: string | null | undefined) {
  return !!src && loadedSrcs.has(src);
}

interface SmartImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src?: string | null;
  /** Class applied to the wrapper element (where the skeleton lives). */
  wrapperClassName?: string;
  /** Optional fallback content when src is falsy. */
  fallback?: React.ReactNode;
}

export function SmartImage({
  src,
  alt = "",
  className,
  wrapperClassName,
  fallback,
  onLoad,
  ...rest
}: SmartImageProps) {
  const [loaded, setLoaded] = useState(() => isImageLoaded(src));

  useEffect(() => {
    setLoaded(isImageLoaded(src));
  }, [src]);

  if (!src) {
    return (
      <div className={cn("relative h-full w-full", wrapperClassName)}>
        {fallback ?? <Skeleton className="h-full w-full" />}
      </div>
    );
  }

  return (
    <div className={cn("relative h-full w-full", wrapperClassName)}>
      {!loaded && <Skeleton className="absolute inset-0 h-full w-full" />}
      <img
        {...rest}
        src={src}
        alt={alt}
        decoding="async"
        loading="lazy"
        onLoad={(e) => {
          markImageLoaded(src);
          setLoaded(true);
          onLoad?.(e);
        }}
        onError={() => setLoaded(true)}
        className={cn(
          "transition-opacity duration-200",
          loaded ? "opacity-100" : "opacity-0",
          className,
        )}
        draggable={false}
      />
    </div>
  );
}

/**
 * Fire-and-forget preloader. Kicks off a fresh `Image()` request for each
 * URL it hasn't already seen and records successes in the shared cache so
 * `<SmartImage>` mounts skip the skeleton entirely.
 */
export function preloadImages(urls: Array<string | null | undefined>) {
  const seen = new Set<string>();
  for (const u of urls) {
    if (!u || seen.has(u) || loadedSrcs.has(u)) continue;
    seen.add(u);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => loadedSrcs.add(u);
    img.src = u;
  }
}