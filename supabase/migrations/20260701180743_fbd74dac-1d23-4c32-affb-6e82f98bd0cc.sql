
CREATE TABLE public.statuses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  media_path TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image','video','text')),
  caption TEXT,
  bg_color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE INDEX statuses_expires_idx ON public.statuses (expires_at DESC);
CREATE INDEX statuses_user_idx ON public.statuses (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.statuses TO authenticated;
GRANT ALL ON public.statuses TO service_role;
ALTER TABLE public.statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read active statuses" ON public.statuses
  FOR SELECT TO authenticated
  USING (expires_at > now() OR user_id = auth.uid());
CREATE POLICY "owner insert status" ON public.statuses
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner update status" ON public.statuses
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "owner delete status" ON public.statuses
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.status_likes (
  status_id UUID NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (status_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.status_likes TO authenticated;
GRANT ALL ON public.status_likes TO service_role;
ALTER TABLE public.status_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read likes" ON public.status_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "self like" ON public.status_likes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "self unlike" ON public.status_likes FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.status_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  status_id UUID NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX status_comments_status_idx ON public.status_comments (status_id, created_at ASC);
GRANT SELECT, INSERT, DELETE ON public.status_comments TO authenticated;
GRANT ALL ON public.status_comments TO service_role;
ALTER TABLE public.status_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read comments" ON public.status_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "self comment" ON public.status_comments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "self delete comment" ON public.status_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.statuses s WHERE s.id = status_id AND s.user_id = auth.uid()));

CREATE POLICY "statuses read auth" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'statuses');
CREATE POLICY "statuses insert self" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'statuses' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "statuses delete self" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'statuses' AND (storage.foldername(name))[1] = auth.uid()::text);
