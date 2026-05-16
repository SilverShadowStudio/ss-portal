import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BrandConfig {
  background_color: string;
  dark_background_color: string;
  dark_surface_primary: string;
  dark_surface_elevated: string;
  gold_color: string;
  text_color: string;
  font_family: string;
  logo_url: string;
}

export const BRAND_DEFAULTS: BrandConfig = {
  background_color: "#EDE8E0",
  dark_background_color: "#131210",
  dark_surface_primary: "#181614",
  dark_surface_elevated: "#1E1C18",
  gold_color: "#B89A6A",
  text_color: "#1A1814",
  font_family: "Montserrat",
  logo_url: "",
};

interface BrandContextValue {
  brand: BrandConfig;
  loading: boolean;
}

const BrandContext = createContext<BrandContextValue>({
  brand: BRAND_DEFAULTS,
  loading: true,
});

function hexToHslTriplet(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "0 0% 100%";
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function applyCssVars(brand: BrandConfig) {
  const root = document.documentElement;
  // Hex forms (for direct `var()` usage in inline styles and tailwind utilities)
  root.style.setProperty("--brand-bg", brand.background_color);
  root.style.setProperty("--brand-gold", brand.gold_color);
  root.style.setProperty("--brand-dark-bg", brand.dark_background_color);
  root.style.setProperty("--brand-dark-surface", brand.dark_surface_primary);
  root.style.setProperty("--brand-dark-elevated", brand.dark_surface_elevated);
  root.style.setProperty("--brand-text", brand.text_color);
  // HSL-triplet forms (bridge for the existing `hsl(var(--token))` system in index.css)
  root.style.setProperty("--brand-bg-hsl", hexToHslTriplet(brand.background_color));
  root.style.setProperty("--brand-gold-hsl", hexToHslTriplet(brand.gold_color));
  root.style.setProperty("--brand-dark-bg-hsl", hexToHslTriplet(brand.dark_background_color));
  root.style.setProperty("--brand-dark-surface-hsl", hexToHslTriplet(brand.dark_surface_primary));
  root.style.setProperty("--brand-dark-elevated-hsl", hexToHslTriplet(brand.dark_surface_elevated));
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<BrandConfig>(BRAND_DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Apply defaults immediately so the page never flashes the wrong colour
    applyCssVars(BRAND_DEFAULTS);

    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "document_design_config")
          .maybeSingle();
        if (cancelled) return;
        if (data?.value) {
          const merged = { ...BRAND_DEFAULTS, ...(data.value as Partial<BrandConfig>) };
          setBrand(merged);
          applyCssVars(merged);
        }
      } catch {
        // keep defaults
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <BrandContext.Provider value={{ brand, loading }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}
