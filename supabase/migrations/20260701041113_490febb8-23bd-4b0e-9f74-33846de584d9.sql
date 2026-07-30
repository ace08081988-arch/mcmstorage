
-- Tutup celah RLS user_storage untuk akun chat_only.
DROP POLICY IF EXISTS "Users can view own storage" ON public.user_storage;
DROP POLICY IF EXISTS "Users can insert own storage" ON public.user_storage;
DROP POLICY IF EXISTS "Users can update own storage" ON public.user_storage;
DROP POLICY IF EXISTS "Users can delete own storage" ON public.user_storage;

CREATE POLICY "Users can view own storage"
  ON public.user_storage FOR SELECT
  USING (auth.uid() = user_id AND NOT public.is_chat_only(auth.uid()));

CREATE POLICY "Users can insert own storage"
  ON public.user_storage FOR INSERT
  WITH CHECK (auth.uid() = user_id AND NOT public.is_chat_only(auth.uid()));

CREATE POLICY "Users can update own storage"
  ON public.user_storage FOR UPDATE
  USING (auth.uid() = user_id AND NOT public.is_chat_only(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND NOT public.is_chat_only(auth.uid()));

CREATE POLICY "Users can delete own storage"
  ON public.user_storage FOR DELETE
  USING (auth.uid() = user_id AND NOT public.is_chat_only(auth.uid()));
