
CREATE TABLE public.ecer_send_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title_id uuid,
  prep_ids uuid[] NOT NULL DEFAULT '{}',
  prep_count int NOT NULL DEFAULT 0,
  customer_id uuid,
  party_name text,
  party_contact text,
  channel text NOT NULL DEFAULT 'wa' CHECK (channel IN ('wa','chat','copy','other')),
  outcome text NOT NULL DEFAULT 'sent' CHECK (outcome IN ('sent','copied','failed','cancelled')),
  total_amount numeric,
  paid_amount numeric,
  payment_method text,
  note text,
  caption_preview text,
  photo_count int NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ecer_send_events TO authenticated;
GRANT ALL ON public.ecer_send_events TO service_role;

ALTER TABLE public.ecer_send_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own ecer_send_events"
  ON public.ecer_send_events
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_ecer_send_events_user_title_created
  ON public.ecer_send_events (user_id, title_id, created_at DESC);
