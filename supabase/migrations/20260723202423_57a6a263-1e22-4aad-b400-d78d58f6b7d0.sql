
CREATE TABLE public.wa_message_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  template TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_message_templates TO authenticated;
GRANT ALL ON public.wa_message_templates TO service_role;

ALTER TABLE public.wa_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_full_access_wa_template"
  ON public.wa_message_templates
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.wa_message_templates_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wa_message_templates_updated_at
BEFORE UPDATE ON public.wa_message_templates
FOR EACH ROW EXECUTE FUNCTION public.wa_message_templates_touch_updated_at();
