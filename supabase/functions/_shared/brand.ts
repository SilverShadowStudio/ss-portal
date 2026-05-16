// Single source of truth for brand colours in edge functions.
// Reads app_settings.document_design_config once, caches in module scope
// for the lifetime of the cold-start instance.

export interface BrandConfig {
  background_color: string
  dark_background_color: string
  dark_surface_primary: string
  dark_surface_elevated: string
  gold_color: string
  text_color: string
  font_family: string
  logo_url: string
}

export const BRAND_DEFAULTS: BrandConfig = {
  background_color: '#EDE8E0',
  dark_background_color: '#131210',
  dark_surface_primary: '#181614',
  dark_surface_elevated: '#1E1C18',
  gold_color: '#B89A6A',
  text_color: '#1A1814',
  font_family: 'Montserrat',
  logo_url: '',
}

let cached: BrandConfig | null = null

export async function loadBrand(
  admin: { from: (table: string) => any },
): Promise<BrandConfig> {
  if (cached) return cached
  try {
    const { data } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'document_design_config')
      .maybeSingle()
    const merged = { ...BRAND_DEFAULTS, ...(data?.value as Partial<BrandConfig> | undefined ?? {}) }
    cached = merged
    return merged
  } catch {
    return { ...BRAND_DEFAULTS }
  }
}

// Convert "#RRGGBB" to [r, g, b] for jsPDF setFillColor().
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [255, 255, 255]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

// Paint a full-page rect with the given hex colour at (0,0).
// Call once after `new jsPDF(...)` and again immediately after every `pdf.addPage()`.
export function paintPageBackground(pdf: any, hex: string): void {
  const [r, g, b] = hexToRgb(hex)
  const pageWidth = pdf.internal.pageSize.getWidth() as number
  const pageHeight = pdf.internal.pageSize.getHeight() as number
  pdf.setFillColor(r, g, b)
  pdf.rect(0, 0, pageWidth, pageHeight, 'F')
}
