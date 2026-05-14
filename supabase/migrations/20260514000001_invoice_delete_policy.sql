CREATE POLICY "Admins can delete invoices" ON invoices FOR DELETE USING (is_admin());
