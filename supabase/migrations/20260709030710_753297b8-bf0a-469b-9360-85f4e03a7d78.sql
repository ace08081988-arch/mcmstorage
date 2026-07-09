-- C10: hardening upload bucket ecer/prep di level RLS.
-- storage.buckets tidak bisa di-UPDATE dari SQL (bucket_sql_blocked),
-- jadi kita enforce via policy WITH CHECK yang memeriksa metadata size+mime.
-- metadata di-set oleh storage sebelum baris tersedia untuk RLS INSERT.

CREATE OR REPLACE FUNCTION public.storage_upload_within_limits(
  _metadata jsonb,
  _max_bytes bigint DEFAULT 15728640
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((_metadata->>'size')::bigint, 0) <= _max_bytes
    AND COALESCE(_metadata->>'mimetype','') IN (
      'image/jpeg','image/png','image/webp','image/heic','image/heif',
      'image/gif','video/mp4','video/quicktime','video/webm'
    )
$$;

GRANT EXECUTE ON FUNCTION public.storage_upload_within_limits(jsonb, bigint) TO anon, authenticated;

-- Rewrite worker + owner insert policies for ecer-photos.
DROP POLICY IF EXISTS "ecer-photos worker insert" ON storage.objects;
CREATE POLICY "ecer-photos worker insert"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'ecer-photos'
  AND public.prep_worker_upload_allowed(
        ((storage.foldername(name))[1])::uuid,
        (storage.foldername(name))[2]
      )
  AND public.storage_upload_within_limits(metadata)
);

DROP POLICY IF EXISTS "ecer-photos owner insert" ON storage.objects;
CREATE POLICY "ecer-photos owner insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ecer-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND public.storage_upload_within_limits(metadata)
);

-- Rewrite prep-photos guarded insert (worker) with same limits.
DROP POLICY IF EXISTS "prep-photos guarded insert" ON storage.objects;
CREATE POLICY "prep-photos guarded insert"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'prep-photos'
  AND public.prep_upload_allowed((storage.foldername(name))[1])
  AND public.storage_upload_within_limits(metadata)
);