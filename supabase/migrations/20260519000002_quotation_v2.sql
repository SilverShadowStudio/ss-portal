-- Quotation v2.0 — Quotations as Orders under the Master Services Agreement.
--
-- The Services Agreement v3.0 (SSS-CA-PROJECT-v3.0) absorbed all standing
-- terms. The Quotation shrinks to a one-page Order: scope, price, schedule,
-- and any order-specific deviations. The long-form artefacts created from
-- `quotation_documents` are NOT migrated — they remain valid historical
-- records and the legacy code path keeps reading them as before.
--
-- Naming note: the singular `quotations` table already exists in the schema
-- but is unused by the application code (no `.from("quotations")` calls
-- anywhere). Rather than drop it (a deletion the rule book discourages)
-- this migration introduces `quotation_orders` as the v2 surface. The name
-- mirrors the brief's framing — every accepted Quotation is an Order under
-- the Master Services Agreement.
--
-- Awaiting Fred's confirmation before applying. See pull-request description
-- for the alternative option (drop+recreate `quotations` as the v2 table).

CREATE TABLE IF NOT EXISTS quotation_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,

  -- Identification
  quotation_reference TEXT NOT NULL,
  date_issued DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE NOT NULL,

  -- Project block (project_name is the typographic anchor on both surfaces)
  project_name TEXT NOT NULL,
  project_address TEXT,
  project_type TEXT,

  -- Brief — single short paragraph, max ~480 chars, enforced at insert time
  -- by the application layer and by the CHECK below.
  brief TEXT NOT NULL CHECK (char_length(brief) <= 480),

  -- Fee — monetary values stored as minor units (pence / cents) to dodge
  -- floating point. Net/VAT/gross are precomputed at insert time so the
  -- PDF render and acceptance flow never have to re-derive them.
  currency TEXT NOT NULL DEFAULT 'GBP',
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 20.00,
  net_total_minor INTEGER NOT NULL,
  vat_total_minor INTEGER NOT NULL,
  gross_total_minor INTEGER NOT NULL,

  -- Schedule
  estimated_start_date DATE,
  estimated_delivery_date DATE,
  schedule_notes TEXT,

  -- Rounds — per Services Agreement clause 5, default is 2; this column
  -- supports per-Order override (within sanity limits enforced by CHECK).
  permitted_rounds INTEGER NOT NULL DEFAULT 2
    CHECK (permitted_rounds BETWEEN 1 AND 6),

  -- Order-specific deviations from the standard Agreement terms. Render is
  -- skipped entirely when this column is NULL. Most Quotations leave it
  -- blank.
  order_specific_notes TEXT,

  -- Agreement gating — references the specific signed Agreement that
  -- governs this Order. The application layer must verify the referenced
  -- row has status='signed' and a supported version BEFORE inserting.
  governing_agreement_id UUID NOT NULL REFERENCES agreements(id),

  -- State machine: draft → sent → accepted (terminal), with expired and
  -- withdrawn as alternative terminals.
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'expired', 'withdrawn')),

  -- Lifecycle timestamps & acceptance metadata
  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES auth.users(id),
  accepted_by_name TEXT,
  accepted_by_position TEXT,
  accepted_ip INET,
  accepted_user_agent TEXT,

  -- Storage path of the stamped PDF (regenerated on acceptance).
  stamped_pdf_storage_path TEXT,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),

  UNIQUE (account_id, quotation_reference)
);

CREATE TABLE IF NOT EXISTS quotation_order_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_order_id UUID NOT NULL REFERENCES quotation_orders(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotation_orders_account ON quotation_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_quotation_orders_status ON quotation_orders(status);
CREATE INDEX IF NOT EXISTS idx_quotation_orders_agreement ON quotation_orders(governing_agreement_id);
CREATE INDEX IF NOT EXISTS idx_quotation_orders_account_status ON quotation_orders(account_id, status);
CREATE INDEX IF NOT EXISTS idx_quotation_order_line_items_order
  ON quotation_order_line_items(quotation_order_id, display_order);

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE quotation_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_order_line_items ENABLE ROW LEVEL SECURITY;

-- Admin (super_admin or admin role) — full read/write on both tables.
CREATE POLICY "quotation_orders_admin_all"
  ON quotation_orders FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "quotation_order_line_items_admin_all"
  ON quotation_order_line_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('admin', 'super_admin')
    )
  );

-- Client read — only sees Quotations attached to their account, and only
-- once the Quotation has been sent (drafts are admin-only). Accepted
-- Quotations remain readable indefinitely as historical records.
CREATE POLICY "quotation_orders_client_read"
  ON quotation_orders FOR SELECT
  USING (
    status IN ('sent', 'accepted', 'expired', 'withdrawn')
    AND EXISTS (
      SELECT 1 FROM account_members am
      WHERE am.account_id = quotation_orders.account_id
        AND am.user_id = auth.uid()
    )
  );

CREATE POLICY "quotation_order_line_items_client_read"
  ON quotation_order_line_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM quotation_orders qo
      JOIN account_members am ON am.account_id = qo.account_id
      WHERE qo.id = quotation_order_line_items.quotation_order_id
        AND qo.status IN ('sent', 'accepted', 'expired', 'withdrawn')
        AND am.user_id = auth.uid()
    )
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION touch_quotation_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quotation_orders_updated_at ON quotation_orders;
CREATE TRIGGER trg_quotation_orders_updated_at
  BEFORE UPDATE ON quotation_orders
  FOR EACH ROW EXECUTE FUNCTION touch_quotation_orders_updated_at();
