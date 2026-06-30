
DO $$ BEGIN
  CREATE TYPE public.chat_delete_action AS ENUM ('for_me','for_all','for_me_bulk','for_all_bulk','all_mine');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.chat_delete_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid,
  message_ids uuid[],
  actor_user_id uuid NOT NULL DEFAULT auth.uid(),
  action public.chat_delete_action NOT NULL,
  count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_delete_audit_conv_created_idx
  ON public.chat_delete_audit (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_delete_audit_actor_idx
  ON public.chat_delete_audit (actor_user_id, created_at DESC);

GRANT SELECT, INSERT ON public.chat_delete_audit TO authenticated;
GRANT ALL ON public.chat_delete_audit TO service_role;

ALTER TABLE public.chat_delete_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view delete audit in their conversations"
  ON public.chat_delete_audit FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = chat_delete_audit.conversation_id
        AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "Members can insert their own delete audit"
  ON public.chat_delete_audit FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = chat_delete_audit.conversation_id
        AND cm.user_id = auth.uid()
    )
  );
