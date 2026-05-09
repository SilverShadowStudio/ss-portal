
-- Quotation documents
CREATE TABLE public.quotation_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  project_id UUID,
  user_id UUID NOT NULL,
  quotation_number TEXT NOT NULL,
  reference_number TEXT,
  project_name TEXT,
  client_company TEXT,
  client_registration TEXT,
  client_address TEXT,
  client_country TEXT,
  client_name TEXT,
  client_position TEXT,
  client_email TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  currency TEXT NOT NULL DEFAULT 'GBP',
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC,
  vat_rate NUMERIC NOT NULL DEFAULT 20,
  vat_amount NUMERIC,
  amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  issued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.quotation_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all quotation_documents"
  ON public.quotation_documents FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Members view account quotation_documents"
  ON public.quotation_documents FOR SELECT TO authenticated
  USING (
    (account_id IS NOT NULL AND is_account_member(account_id))
    OR EXISTS (SELECT 1 FROM projects p WHERE p.id = quotation_documents.project_id AND is_account_member(p.account_id))
  );

CREATE TRIGGER trg_quotation_documents_updated_at
  BEFORE UPDATE ON public.quotation_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_quotation_documents_account ON public.quotation_documents(account_id);
CREATE INDEX idx_quotation_documents_project ON public.quotation_documents(project_id);

-- Client notifications
CREATE TABLE public.client_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  account_id UUID,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  link_path TEXT,
  entity_type TEXT,
  entity_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.client_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own notifications"
  ON public.client_notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own notifications"
  ON public.client_notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all notifications"
  ON public.client_notifications FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "Admins insert notifications"
  ON public.client_notifications FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE INDEX idx_client_notifications_user ON public.client_notifications(user_id, read_at);
