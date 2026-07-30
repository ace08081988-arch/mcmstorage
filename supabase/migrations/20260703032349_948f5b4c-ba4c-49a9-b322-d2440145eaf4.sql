
CREATE TABLE public.chat_lists (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#22c55e',
  icon text NOT NULL DEFAULT 'tag',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_lists TO authenticated;
GRANT ALL ON public.chat_lists TO service_role;

ALTER TABLE public.chat_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own chat lists"
ON public.chat_lists
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX chat_lists_user_id_sort_idx ON public.chat_lists (user_id, sort_order);

CREATE TABLE public.chat_list_members (
  list_id uuid NOT NULL REFERENCES public.chat_lists(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, conversation_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_list_members TO authenticated;
GRANT ALL ON public.chat_list_members TO service_role;

ALTER TABLE public.chat_list_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own chat list members"
ON public.chat_list_members
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.chat_lists l
    WHERE l.id = chat_list_members.list_id AND l.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.chat_lists l
    WHERE l.id = chat_list_members.list_id AND l.user_id = auth.uid()
  )
);

CREATE INDEX chat_list_members_conv_idx ON public.chat_list_members (conversation_id);

CREATE OR REPLACE FUNCTION public.chat_lists_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_lists_set_updated_at
BEFORE UPDATE ON public.chat_lists
FOR EACH ROW EXECUTE FUNCTION public.chat_lists_touch_updated_at();
