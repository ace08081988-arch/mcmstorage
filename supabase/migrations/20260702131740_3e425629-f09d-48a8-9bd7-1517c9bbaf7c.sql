-- Status privacy: public (everyone) or friends-only
CREATE TYPE public.status_visibility AS ENUM ('public', 'friends');

ALTER TABLE public.statuses
  ADD COLUMN visibility public.status_visibility NOT NULL DEFAULT 'public';

ALTER TABLE public.profiles
  ADD COLUMN default_status_visibility public.status_visibility NOT NULL DEFAULT 'public';

-- Security-definer helper to test accepted friendship in either direction
CREATE OR REPLACE FUNCTION public.are_friends(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND _a = _b OR EXISTS (
    SELECT 1 FROM public.friend_requests fr
    WHERE fr.status = 'accepted'
      AND (
        (fr.from_user = _a AND fr.to_user = _b)
        OR (fr.from_user = _b AND fr.to_user = _a)
      )
  )
$$;

GRANT EXECUTE ON FUNCTION public.are_friends(uuid, uuid) TO authenticated, service_role;

-- Tighten statuses SELECT to honor visibility
DROP POLICY IF EXISTS "auth read active statuses" ON public.statuses;
CREATE POLICY "auth read active statuses" ON public.statuses
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      expires_at > now()
      AND (
        visibility = 'public'
        OR public.are_friends(auth.uid(), user_id)
      )
    )
  );

-- Likes visible only when the parent status is visible to the reader
DROP POLICY IF EXISTS "auth read likes" ON public.status_likes;
CREATE POLICY "auth read likes" ON public.status_likes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.statuses s
      WHERE s.id = status_id
        AND (
          s.user_id = auth.uid()
          OR s.visibility = 'public'
          OR public.are_friends(auth.uid(), s.user_id)
        )
    )
  );

-- Comments visible only when the parent status is visible to the reader
DROP POLICY IF EXISTS "auth read comments" ON public.status_comments;
CREATE POLICY "auth read comments" ON public.status_comments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.statuses s
      WHERE s.id = status_id
        AND (
          s.user_id = auth.uid()
          OR s.visibility = 'public'
          OR public.are_friends(auth.uid(), s.user_id)
        )
    )
  );

-- Storage bucket: only allow reading a status media file if the caller can
-- read a corresponding status row (self, public, or friends).
DROP POLICY IF EXISTS "statuses read auth" ON storage.objects;
CREATE POLICY "statuses read auth" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'statuses'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM public.statuses s
        WHERE s.media_path = name
          AND (
            s.visibility = 'public'
            OR public.are_friends(auth.uid(), s.user_id)
          )
      )
    )
  );