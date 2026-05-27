-- British Airways-mode booking: 'reserved' rounds are committed by the client
-- but not yet paid; they auto-expire. Once payment confirms (Commit 2),
-- reserved → pending. Expired holds become 'cancelled' (Part 8 sweep).
-- Amendments approved by Fred: 'cancelled' added to the CHECK alongside
-- 'reserved'; created_by audit column added in this same migration.

-- 1) Extend the status CHECK to include 'reserved' and 'cancelled'.
ALTER TABLE public.scene_rounds DROP CONSTRAINT IF EXISTS scene_rounds_status_check;
ALTER TABLE public.scene_rounds ADD CONSTRAINT scene_rounds_status_check
  CHECK (status IN ('draft', 'reserved', 'pending', 'in_production', 'delivered', 'approved', 'client_review', 'awaiting_review', 'cancelled'));

-- 2) Reservation expiry — when the unpaid hold lapses.
ALTER TABLE public.scene_rounds
  ADD COLUMN IF NOT EXISTS reservation_expires_at TIMESTAMPTZ;

-- 3) Round-fee snapshot (receipt/audit when prices change later).
ALTER TABLE public.scene_rounds
  ADD COLUMN IF NOT EXISTS round_fee NUMERIC(10,2);

-- 4) Booking-level grouping so a multi-round booking is tracked as one
--    transaction (Commit 2 payment operates per booking_group_id).
ALTER TABLE public.scene_rounds
  ADD COLUMN IF NOT EXISTS booking_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_scene_rounds_booking_group ON public.scene_rounds(booking_group_id);

-- 5) Who booked (audit — enables "who reserved this").
ALTER TABLE public.scene_rounds
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- 6) Index for the reservation-expiry sweep.
CREATE INDEX IF NOT EXISTS idx_scene_rounds_reservation_expiry
  ON public.scene_rounds(reservation_expires_at)
  WHERE status = 'reserved';
