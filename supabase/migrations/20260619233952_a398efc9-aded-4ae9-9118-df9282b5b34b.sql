ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Block non-service access to unsubscribe tokens"
ON public.email_unsubscribe_tokens AS RESTRICTIVE
FOR ALL TO anon, authenticated
USING (false) WITH CHECK (false);

ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Block non-service access to suppressed emails"
ON public.suppressed_emails AS RESTRICTIVE
FOR ALL TO anon, authenticated
USING (false) WITH CHECK (false);