CREATE TABLE public.auto_send_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title_id uuid NOT NULL,
  warehouse_item_id uuid,
  prep_ids uuid[] NOT NULL DEFAULT '{}',
  prep_count integer NOT NULL DEFAULT 0,
  total_grams numeric NOT NULL DEFAULT 0,
  unit_label text,
  outcome text NOT NULL CHECK (outcome IN ('proposed','confirmed','cancelled','mismatched','empty')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.auto_send_audit TO authenticated;
GRANT ALL ON public.auto_send_audit TO service_role;

ALTER TABLE public.auto_send_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auto_send_audit owner select"
  ON public.auto_send_audit FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "auto_send_audit owner insert"
  ON public.auto_send_audit FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "auto_send_audit owner update"
  ON public.auto_send_audit FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX auto_send_audit_user_created_idx
  ON public.auto_send_audit (user_id, created_at DESC);
CREATE INDEX auto_send_audit_title_idx
  ON public.auto_send_audit (title_id);