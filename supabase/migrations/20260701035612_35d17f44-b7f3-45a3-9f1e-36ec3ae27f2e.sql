
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS chat_only boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_chat_only(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT chat_only FROM public.profiles WHERE id = _uid), false);
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email, phone, chat_only)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.email,
    COALESCE(NEW.phone, NEW.raw_user_meta_data ->> 'phone'),
    COALESCE((NEW.raw_user_meta_data ->> 'chat_only')::boolean, false)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DO $mig$
DECLARE
  r record;
  tbl text;
  tables_uid text[] := ARRAY[
    'warehouse_items','warehouse_category_variants','warehouse_item_variants',
    'sales','purchases','customers','suppliers','customer_payments','supplier_payments',
    'debts','debt_payments','ecer_preparations','ecer_titles','ready_packages',
    'request_titles','request_preparations','request_preparation_items',
    'self_prep_items','order_requests','staff_contacts'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_uid LOOP
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=tbl LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, tbl);
    END LOOP;
    EXECUTE format($f$
      CREATE POLICY "storage owner (non chat-only)" ON public.%I
        FOR ALL TO authenticated
        USING (user_id = auth.uid() AND NOT public.is_chat_only(auth.uid()))
        WITH CHECK (user_id = auth.uid() AND NOT public.is_chat_only(auth.uid()))
    $f$, tbl);
  END LOOP;
END $mig$;

-- request_title_items: no user_id — join via title_id → request_titles.user_id
DO $mig$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='request_title_items' LOOP
    EXECUTE format('DROP POLICY %I ON public.request_title_items', r.policyname);
  END LOOP;
END $mig$;
CREATE POLICY "storage owner (non chat-only)" ON public.request_title_items
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.request_titles rt
            WHERE rt.id = request_title_items.title_id
              AND rt.user_id = auth.uid())
    AND NOT public.is_chat_only(auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.request_titles rt
            WHERE rt.id = request_title_items.title_id
              AND rt.user_id = auth.uid())
    AND NOT public.is_chat_only(auth.uid())
  );

-- prep_tasks (owner_user_id)
DROP POLICY IF EXISTS "owner manages prep_tasks" ON public.prep_tasks;
CREATE POLICY "storage owner (non chat-only)" ON public.prep_tasks
  FOR ALL TO authenticated
  USING (owner_user_id = auth.uid() AND NOT public.is_chat_only(auth.uid()))
  WITH CHECK (owner_user_id = auth.uid() AND NOT public.is_chat_only(auth.uid()));

-- prep_task_items (via task_id)
DROP POLICY IF EXISTS "owner manages prep_task_items" ON public.prep_task_items;
CREATE POLICY "storage owner (non chat-only)" ON public.prep_task_items
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.prep_tasks t
            WHERE t.id = prep_task_items.task_id
              AND t.owner_user_id = auth.uid())
    AND NOT public.is_chat_only(auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.prep_tasks t
            WHERE t.id = prep_task_items.task_id
              AND t.owner_user_id = auth.uid())
    AND NOT public.is_chat_only(auth.uid())
  );

-- prep_submissions
DROP POLICY IF EXISTS "owner reads prep_submissions" ON public.prep_submissions;
DROP POLICY IF EXISTS "owner deletes prep_submissions" ON public.prep_submissions;
DROP POLICY IF EXISTS "Block direct inserts on prep_submissions" ON public.prep_submissions;

CREATE POLICY "owner reads prep_submissions" ON public.prep_submissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.prep_tasks t
            WHERE t.id = prep_submissions.task_id
              AND t.owner_user_id = auth.uid())
    AND NOT public.is_chat_only(auth.uid())
  );

CREATE POLICY "owner deletes prep_submissions" ON public.prep_submissions
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.prep_tasks t
            WHERE t.id = prep_submissions.task_id
              AND t.owner_user_id = auth.uid())
    AND NOT public.is_chat_only(auth.uid())
  );

CREATE POLICY "Block direct inserts on prep_submissions" ON public.prep_submissions
  FOR INSERT TO authenticated WITH CHECK (false);

-- order_request_events (user_id, SELECT + INSERT)
DROP POLICY IF EXISTS "Owner read own order events" ON public.order_request_events;
DROP POLICY IF EXISTS "Owner insert own order events" ON public.order_request_events;

CREATE POLICY "Owner read own order events" ON public.order_request_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND NOT public.is_chat_only(auth.uid()));

CREATE POLICY "Owner insert own order events" ON public.order_request_events
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND NOT public.is_chat_only(auth.uid()));
