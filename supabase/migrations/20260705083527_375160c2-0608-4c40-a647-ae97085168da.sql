
CREATE TABLE public.prep_link_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.prep_tasks(id) ON DELETE SET NULL,
  title_id uuid REFERENCES public.request_titles(id) ON DELETE SET NULL,
  title_name text NOT NULL,
  worker_name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp','copy_message','copy_link_pin','download_png','download_pdf')),
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prep_link_deliveries_owner ON public.prep_link_deliveries(owner_user_id, sent_at DESC);
CREATE INDEX idx_prep_link_deliveries_title ON public.prep_link_deliveries(title_id, sent_at DESC);
CREATE INDEX idx_prep_link_deliveries_task ON public.prep_link_deliveries(task_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prep_link_deliveries TO authenticated;
GRANT ALL ON public.prep_link_deliveries TO service_role;

ALTER TABLE public.prep_link_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner manages own deliveries"
  ON public.prep_link_deliveries
  FOR ALL
  TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());
