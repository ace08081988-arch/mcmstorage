
-- Tighten prep-photos storage policies
DROP POLICY IF EXISTS "prep-photos anon insert" ON storage.objects;
DROP POLICY IF EXISTS "prep-photos auth delete" ON storage.objects;

-- INSERT: only when the first path segment is a share_token of an ACTIVE task.
CREATE POLICY "prep-photos guarded insert" ON storage.objects
FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'prep-photos'
  AND EXISTS (
    SELECT 1 FROM public.prep_tasks t
    WHERE t.share_token = (storage.foldername(name))[1]
      AND t.status = 'active'
      AND t.expires_at > now()
  )
);

-- DELETE: only the owner of the task referenced by the path may delete.
CREATE POLICY "prep-photos owner delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'prep-photos'
  AND EXISTS (
    SELECT 1 FROM public.prep_tasks t
    WHERE t.share_token = (storage.foldername(name))[1]
      AND t.owner_user_id = auth.uid()
  )
);
