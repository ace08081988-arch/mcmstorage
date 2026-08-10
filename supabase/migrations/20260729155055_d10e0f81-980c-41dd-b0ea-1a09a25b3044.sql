CREATE TABLE public.debt_adjust_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  actor_name text,
  conversation_id uuid,
  party_name text,
  kind text NOT NULL,
  action text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  balance_before numeric,
  balance_after numeric,
  detail jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.debt_adjust_audit TO authenticated;
GRANT ALL ON public.debt_adjust_audit TO service_role;

ALTER TABLE public.debt_adjust_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own debt audit" ON public.debt_adjust_audit
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_debt_adjust_audit_user_created
  ON public.debt_adjust_audit (user_id, created_at DESC);
CREATE INDEX idx_debt_adjust_audit_conv
  ON public.debt_adjust_audit (conversation_id, created_at DESC);