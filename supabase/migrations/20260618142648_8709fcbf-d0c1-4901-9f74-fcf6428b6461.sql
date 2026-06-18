DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchases','sales','suppliers','supplier_payments','warehouse_items']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'own '||t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', 'own '||t, t);
  END LOOP;
END $$;