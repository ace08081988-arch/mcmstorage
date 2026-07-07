ALTER TABLE public.self_prep_items DROP CONSTRAINT IF EXISTS self_prep_items_sold_payment_method_check;
ALTER TABLE public.self_prep_items
  ADD CONSTRAINT self_prep_items_sold_payment_method_check
  CHECK (sold_payment_method IS NULL OR sold_payment_method IN ('kas','hutang','partial'));
