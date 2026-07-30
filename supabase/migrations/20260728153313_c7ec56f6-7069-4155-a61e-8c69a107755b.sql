CREATE TABLE public.chat_party_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  alias_key text NOT NULL,
  alias_label text NOT NULL,
  party_key text NOT NULL,
  party_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, alias_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_party_links TO authenticated;
GRANT ALL ON public.chat_party_links TO service_role;

ALTER TABLE public.chat_party_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own chat party links"
ON public.chat_party_links FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_chat_party_links_updated_at
BEFORE UPDATE ON public.chat_party_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();