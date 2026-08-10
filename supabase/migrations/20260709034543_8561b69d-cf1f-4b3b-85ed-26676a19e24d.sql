-- M18: assert trigger `trg_apply_sale` still exists at migration time.
-- Prevents silent regression where refundSale would not restore stock.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_apply_sale'
      AND tgrelid = 'public.sales'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_apply_sale trigger missing on public.sales — POS stock/refund invariant broken';
  END IF;
END $$;

-- Add supporting composite index for M7 explicit filter path (defensive; no-op if exists).
CREATE INDEX IF NOT EXISTS order_request_events_user_created_idx
  ON public.order_request_events (user_id, created_at DESC);