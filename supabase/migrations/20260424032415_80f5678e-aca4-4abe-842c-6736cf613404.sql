CREATE POLICY "Clients can delete their own pins"
  ON public.asset_pins
  FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Clients can delete messages on pins they own"
  ON public.asset_pin_messages
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.asset_pins ap
      WHERE ap.id = asset_pin_messages.pin_id
        AND ap.created_by = auth.uid()
    )
  );