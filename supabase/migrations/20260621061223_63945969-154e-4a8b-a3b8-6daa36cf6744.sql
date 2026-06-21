DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid='realtime.messages'::regclass) THEN
    EXECUTE 'DROP POLICY IF EXISTS "deny_all_broadcast_select" ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS "deny_all_broadcast_insert" ON realtime.messages';
    EXECUTE $p$CREATE POLICY "deny_all_broadcast_select" ON realtime.messages FOR SELECT TO authenticated, anon USING (false)$p$;
    EXECUTE $p$CREATE POLICY "deny_all_broadcast_insert" ON realtime.messages FOR INSERT TO authenticated, anon WITH CHECK (false)$p$;
  END IF;
END $$;