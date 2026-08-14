CREATE OR REPLACE FUNCTION public.apk_object_is_published(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.apk_release_meta m
    WHERE m.file_name = _name
      AND m.enabled IS TRUE
      AND (m.publish_at IS NULL OR m.publish_at <= now())
  )
$$;

DROP POLICY IF EXISTS "Public read apk-releases" ON storage.objects;

CREATE POLICY "Public read published apk-releases"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'apk-releases'
  AND public.apk_object_is_published(name)
);

CREATE POLICY "Admin read apk-releases"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'apk-releases'
  AND public.has_role(auth.uid(), 'admin'::app_role)
);
