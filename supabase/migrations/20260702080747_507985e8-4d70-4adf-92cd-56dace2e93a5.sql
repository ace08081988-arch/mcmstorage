
CREATE TABLE public.apk_download_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant text NOT NULL CHECK (variant IN ('storage','chat')),
  source text NOT NULL DEFAULT 'button' CHECK (source IN ('button','copy_page','copy_file')),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  referrer text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX apk_download_events_variant_created_idx
  ON public.apk_download_events (variant, created_at DESC);

GRANT INSERT ON public.apk_download_events TO anon, authenticated;
GRANT SELECT ON public.apk_download_events TO authenticated;
GRANT ALL ON public.apk_download_events TO service_role;

ALTER TABLE public.apk_download_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can log a download click"
  ON public.apk_download_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "admins can read download events"
  ON public.apk_download_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
