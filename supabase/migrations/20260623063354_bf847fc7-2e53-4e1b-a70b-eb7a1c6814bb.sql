
CREATE TABLE public.security_hook_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hook_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  presented_auth_hash TEXT,
  headers JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.security_hook_audit TO authenticated;
GRANT ALL ON public.security_hook_audit TO service_role;
ALTER TABLE public.security_hook_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view security hook audit"
  ON public.security_hook_audit FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX security_hook_audit_created_at_idx
  ON public.security_hook_audit (created_at DESC);
