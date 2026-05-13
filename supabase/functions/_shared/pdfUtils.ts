// Shared PDF layout utilities for edge functions that generate PDFs.
// Design config is loaded from app_settings.document_design_config at runtime.

export interface DocumentDesignConfig {
  background_color: string
  warm_black: string
  warm_grey: string
  gold: string
  body_font: string
  heading_font: string
  meta_font: string
  logo_width: number
  margin_left: number
  margin_right: number
  margin_top: number
  margin_bottom: number
}

export const DESIGN_DEFAULTS: DocumentDesignConfig = {
  background_color: '#EDE8E0',
  warm_black: '#1A1814',
  warm_grey: '#8A8070',
  gold: '#B89A6A',
  body_font: 'Times-Roman',
  heading_font: 'Helvetica-Bold',
  meta_font: 'Helvetica',
  logo_width: 180,
  margin_left: 72,
  margin_right: 72,
  margin_top: 64,
  margin_bottom: 80,
}

export async function loadDesignConfig(
  admin: { from: (table: string) => any },
): Promise<DocumentDesignConfig> {
  try {
    const { data } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'document_design_config')
      .maybeSingle()
    if (data?.value) return { ...DESIGN_DEFAULTS, ...(data.value as Partial<DocumentDesignConfig>) }
  } catch { /* fall through */ }
  return { ...DESIGN_DEFAULTS }
}
