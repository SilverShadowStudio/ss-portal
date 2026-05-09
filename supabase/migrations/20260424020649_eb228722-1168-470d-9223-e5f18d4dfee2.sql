
-- ============================================================
-- Asset annotation pins + per-pin chat
-- ============================================================

CREATE TABLE public.asset_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL,
  scene_round_id uuid NOT NULL,
  -- Normalized 0..1 coordinates within the displayed image's intrinsic box.
  x numeric NOT NULL,
  y numeric NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX asset_pins_asset_idx ON public.asset_pins (asset_id);
CREATE INDEX asset_pins_round_idx ON public.asset_pins (scene_round_id);

ALTER TABLE public.asset_pins ENABLE ROW LEVEL SECURITY;

-- Helper: a pin "belongs to" the client whose project owns the underlying scene.
-- We check via the round_assets → scene_rounds → scenes → projects chain.
CREATE POLICY "Clients can view pins on their assets"
  ON public.asset_pins FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM round_assets ra
        JOIN scene_rounds sr ON sr.id = ra.scene_round_id
        JOIN scenes s        ON s.id  = sr.scene_id
        JOIN projects p      ON p.id  = s.project_id
       WHERE ra.id = asset_pins.asset_id
         AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Clients can create pins on their assets"
  ON public.asset_pins FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1
        FROM round_assets ra
        JOIN scene_rounds sr ON sr.id = ra.scene_round_id
        JOIN scenes s        ON s.id  = sr.scene_id
        JOIN projects p      ON p.id  = s.project_id
       WHERE ra.id = asset_pins.asset_id
         AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Clients can resolve their own pins"
  ON public.asset_pins FOR UPDATE
  USING (auth.uid() = created_by);

CREATE POLICY "Admins can view all pins"
  ON public.asset_pins FOR SELECT
  USING (is_admin());

CREATE POLICY "Admins can create pins"
  ON public.asset_pins FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update pins"
  ON public.asset_pins FOR UPDATE
  USING (is_admin());

CREATE POLICY "Admins can delete pins"
  ON public.asset_pins FOR DELETE
  USING (is_admin());

-- ============================================================
-- Pin messages
-- ============================================================

CREATE TABLE public.asset_pin_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pin_id uuid NOT NULL REFERENCES public.asset_pins(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  body text,
  -- Attachments: array of { path, name, mime, size }
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX asset_pin_messages_pin_idx
  ON public.asset_pin_messages (pin_id, created_at);

ALTER TABLE public.asset_pin_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can view messages on accessible pins"
  ON public.asset_pin_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM asset_pins ap
        JOIN round_assets ra ON ra.id = ap.asset_id
        JOIN scene_rounds sr ON sr.id = ra.scene_round_id
        JOIN scenes s        ON s.id  = sr.scene_id
        JOIN projects p      ON p.id  = s.project_id
       WHERE ap.id = asset_pin_messages.pin_id
         AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Clients can post messages on accessible pins"
  ON public.asset_pin_messages FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
        FROM asset_pins ap
        JOIN round_assets ra ON ra.id = ap.asset_id
        JOIN scene_rounds sr ON sr.id = ra.scene_round_id
        JOIN scenes s        ON s.id  = sr.scene_id
        JOIN projects p      ON p.id  = s.project_id
       WHERE ap.id = asset_pin_messages.pin_id
         AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all pin messages"
  ON public.asset_pin_messages FOR SELECT
  USING (is_admin());

CREATE POLICY "Admins can post pin messages"
  ON public.asset_pin_messages FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Admins can delete pin messages"
  ON public.asset_pin_messages FOR DELETE
  USING (is_admin());

-- ============================================================
-- Storage bucket for pin chat attachments
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('pin-attachments', 'pin-attachments', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone authenticated can read pin attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'pin-attachments');

CREATE POLICY "Users can upload to their own pin folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'pin-attachments'
    AND (auth.uid()::text = (storage.foldername(name))[1])
  );

CREATE POLICY "Users can delete their own pin uploads"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'pin-attachments'
    AND (auth.uid()::text = (storage.foldername(name))[1])
  );

CREATE POLICY "Admins can manage all pin attachments"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'pin-attachments' AND is_admin())
  WITH CHECK (bucket_id = 'pin-attachments' AND is_admin());
