-- Restore anon EXECUTE on helpers that storage RLS policies evaluate as the caller (anon).
-- Without these, /storage/v1/object inserts/selects on prep-photos & ecer-photos buckets
-- fail with "permission denied for function" when the worker portal uploads a photo.
GRANT EXECUTE ON FUNCTION public.prep_upload_allowed(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prep_worker_upload_allowed(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prep_pin_locked_until(text) TO anon, authenticated;