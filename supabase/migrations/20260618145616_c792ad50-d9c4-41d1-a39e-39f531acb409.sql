
CREATE TABLE public.order_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.order_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.order_request_events TO authenticated;
GRANT ALL ON public.order_request_events TO service_role;

ALTER TABLE public.order_request_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner read own order events" ON public.order_request_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Owner insert own order events" ON public.order_request_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.log_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_request_events(order_id, user_id, from_status, to_status, note)
    VALUES (NEW.id, NEW.user_id, NULL, NEW.status, 'Pesanan dibuat');
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_request_events(order_id, user_id, from_status, to_status, note)
    VALUES (NEW.id, NEW.user_id, OLD.status, NEW.status, NULL);
    RETURN NEW;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_order_request_log
  AFTER INSERT OR UPDATE ON public.order_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_order_status_change();
