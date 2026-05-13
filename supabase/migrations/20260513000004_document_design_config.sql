-- Seed default document design configuration
INSERT INTO public.app_settings (key, value)
VALUES (
  'document_design_config',
  '{"background_color":"#EDE8E0","warm_black":"#1A1814","warm_grey":"#8A8070","gold":"#B89A6A","body_font":"Times-Roman","heading_font":"Helvetica-Bold","meta_font":"Helvetica","logo_width":180,"margin_left":72,"margin_right":72,"margin_top":64,"margin_bottom":80}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
