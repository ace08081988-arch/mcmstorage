ALTER TABLE public.request_titles
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS request_titles_active_idx
  ON public.request_titles (user_id, position)
  WHERE archived_at IS NULL;