
-- 1. Linked account columns on customers/suppliers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS account_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS account_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS customers_account_user_id_idx ON public.customers(account_user_id) WHERE account_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS suppliers_account_user_id_idx ON public.suppliers(account_user_id) WHERE account_user_id IS NOT NULL;

-- 2. can_chat helper
CREATE OR REPLACE FUNCTION public.can_chat(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND _a <> _b AND (
    EXISTS (SELECT 1 FROM public.customers c WHERE (c.user_id=_a AND c.account_user_id=_b) OR (c.user_id=_b AND c.account_user_id=_a))
    OR EXISTS (SELECT 1 FROM public.suppliers s WHERE (s.user_id=_a AND s.account_user_id=_b) OR (s.user_id=_b AND s.account_user_id=_a))
  )
$$;

-- 3. Conversations
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('dm','order','group')),
  title text,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_request_id uuid REFERENCES public.order_requests(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_order_unique ON public.conversations(order_request_id) WHERE kind='order';
CREATE INDEX IF NOT EXISTS conversations_owner_idx ON public.conversations(owner_user_id);
CREATE INDEX IF NOT EXISTS conversations_last_msg_idx ON public.conversations(last_message_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Conversation members
CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  last_read_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_members_user_idx ON public.conversation_members(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_members TO authenticated;
GRANT ALL ON public.conversation_members TO service_role;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;

-- is_member helper (security definer to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_conversation_member(_conv uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.conversation_members WHERE conversation_id=_conv AND user_id=_user)
$$;

CREATE OR REPLACE FUNCTION public.is_conversation_owner(_conv uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.conversations WHERE id=_conv AND owner_user_id=_user)
$$;

-- 5. Messages
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text,
  attachment_path text,
  attachment_mime text,
  attachment_name text,
  attachment_size integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  CHECK (body IS NOT NULL OR attachment_path IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS messages_conv_created_idx ON public.messages(conversation_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- 6. Push subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies
-- conversations: members can SELECT; INSERT/UPDATE/DELETE via server fn only (deny direct)
CREATE POLICY "conv_select_member" ON public.conversations FOR SELECT TO authenticated
  USING (public.is_conversation_member(id, auth.uid()));
CREATE POLICY "conv_insert_none" ON public.conversations FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "conv_update_owner" ON public.conversations FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "conv_delete_owner" ON public.conversations FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

-- conversation_members: members can SELECT roster
CREATE POLICY "cm_select_member" ON public.conversation_members FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id, auth.uid()));
-- Allow user to update own last_read_at
CREATE POLICY "cm_update_self" ON public.conversation_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- Allow user to leave (delete own row)
CREATE POLICY "cm_delete_self_or_owner" ON public.conversation_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_conversation_owner(conversation_id, auth.uid()));
-- INSERT only via server fn
CREATE POLICY "cm_insert_none" ON public.conversation_members FOR INSERT TO authenticated WITH CHECK (false);

-- messages
CREATE POLICY "msg_select_member" ON public.messages FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY "msg_insert_member" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY "msg_update_sender" ON public.messages FOR UPDATE TO authenticated
  USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());
CREATE POLICY "msg_delete_sender_or_owner" ON public.messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR public.is_conversation_owner(conversation_id, auth.uid()));

-- push_subscriptions
CREATE POLICY "push_own" ON public.push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 8. Triggers: update last_message_at + updated_at
CREATE OR REPLACE FUNCTION public.touch_conversation_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations
    SET last_message_at = NEW.created_at, updated_at = now()
    WHERE id = NEW.conversation_id;
  RETURN NEW;
END $$;
CREATE TRIGGER messages_touch_conversation AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_on_message();

-- 9. RPC: start_dm
CREATE OR REPLACE FUNCTION public.start_dm(_partner uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := auth.uid(); v_owner uuid; v_partner uuid := _partner; v_id uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.can_chat(v_me, v_partner) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  -- Determine owner side (the user who owns the contact record)
  IF EXISTS (SELECT 1 FROM public.customers WHERE user_id=v_me AND account_user_id=v_partner)
     OR EXISTS (SELECT 1 FROM public.suppliers WHERE user_id=v_me AND account_user_id=v_partner) THEN
    v_owner := v_me;
  ELSE
    v_owner := v_partner;
  END IF;
  -- Find existing DM
  SELECT c.id INTO v_id FROM public.conversations c
    WHERE c.kind='dm' AND c.owner_user_id = v_owner
      AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id=v_me)
      AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id=c.id AND m.user_id=v_partner)
    LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.conversations(kind, owner_user_id, created_by) VALUES ('dm', v_owner, v_me) RETURNING id INTO v_id;
  INSERT INTO public.conversation_members(conversation_id, user_id, role) VALUES (v_id, v_owner, 'owner'), (v_id, CASE WHEN v_owner=v_me THEN v_partner ELSE v_me END, 'member');
  RETURN v_id;
END $$;

-- 10. RPC: ensure_order_conversation
CREATE OR REPLACE FUNCTION public.ensure_order_conversation(_order uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_customer uuid; v_account uuid; v_id uuid;
BEGIN
  SELECT o.user_id, o.customer_id INTO v_owner, v_customer FROM public.order_requests o WHERE o.id=_order;
  IF v_owner IS NULL THEN RETURN NULL; END IF;
  IF v_customer IS NOT NULL THEN
    SELECT account_user_id INTO v_account FROM public.customers WHERE id=v_customer;
  END IF;
  IF v_account IS NULL OR v_account = v_owner THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.conversations WHERE order_request_id=_order AND kind='order' LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.conversations(kind, owner_user_id, created_by, order_request_id, title)
    VALUES ('order', v_owner, v_owner, _order, 'Order #' || left(_order::text, 8)) RETURNING id INTO v_id;
    INSERT INTO public.conversation_members(conversation_id, user_id, role)
      VALUES (v_id, v_owner, 'owner'), (v_id, v_account, 'member')
      ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.conversation_members(conversation_id, user_id, role)
      VALUES (v_id, v_owner, 'owner'), (v_id, v_account, 'member')
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_id;
END $$;

-- 11. RPC: create_group
CREATE OR REPLACE FUNCTION public.create_group(_title text, _member_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := auth.uid(); v_id uuid; v_uid uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF coalesce(array_length(_member_ids,1),0) = 0 THEN RAISE EXCEPTION 'no_members'; END IF;
  -- Validate each member is a valid chat contact of me
  FOREACH v_uid IN ARRAY _member_ids LOOP
    IF v_uid <> v_me AND NOT public.can_chat(v_me, v_uid) THEN
      RAISE EXCEPTION 'not_allowed_member:%', v_uid;
    END IF;
  END LOOP;
  INSERT INTO public.conversations(kind, owner_user_id, created_by, title)
    VALUES ('group', v_me, v_me, coalesce(nullif(_title,''), 'Grup baru')) RETURNING id INTO v_id;
  INSERT INTO public.conversation_members(conversation_id, user_id, role) VALUES (v_id, v_me, 'owner');
  FOREACH v_uid IN ARRAY _member_ids LOOP
    IF v_uid <> v_me THEN
      INSERT INTO public.conversation_members(conversation_id, user_id, role) VALUES (v_id, v_uid, 'member')
        ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN v_id;
END $$;

-- 12. RPC: add_group_member, remove_group_member, rename_group
CREATE OR REPLACE FUNCTION public.add_group_member(_conv uuid, _user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_kind text;
BEGIN
  SELECT owner_user_id, kind INTO v_owner, v_kind FROM public.conversations WHERE id=_conv;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_owner <> auth.uid() THEN RAISE EXCEPTION 'not_owner'; END IF;
  IF v_kind <> 'group' THEN RAISE EXCEPTION 'not_group'; END IF;
  IF NOT public.can_chat(v_owner, _user) THEN RAISE EXCEPTION 'not_allowed_member'; END IF;
  INSERT INTO public.conversation_members(conversation_id, user_id, role) VALUES (_conv, _user, 'member')
    ON CONFLICT DO NOTHING;
END $$;

-- 13. Trigger: auto ensure order conversation on order_requests insert
CREATE OR REPLACE FUNCTION public.trg_ensure_order_conv()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ensure_order_conversation(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;
CREATE TRIGGER order_requests_ensure_conv AFTER INSERT ON public.order_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_ensure_order_conv();

-- 14. Trigger: when customer/supplier is newly linked, ensure conv for all their orders
CREATE OR REPLACE FUNCTION public.trg_customer_account_linked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF NEW.account_user_id IS DISTINCT FROM OLD.account_user_id AND NEW.account_user_id IS NOT NULL THEN
    FOR r IN SELECT id FROM public.order_requests WHERE customer_id = NEW.id LOOP
      PERFORM public.ensure_order_conversation(r.id);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customers_linked_ensure_conv AFTER UPDATE OF account_user_id ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.trg_customer_account_linked();

-- 15. Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- 16. RPC: search eligible contacts (returns profiles I can chat with)
CREATE OR REPLACE FUNCTION public.search_chat_contacts(_q text)
RETURNS TABLE(user_id uuid, display_name text, email text, kind text, label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (account.user_id) account.user_id, p.display_name, p.email, account.kind, account.label
  FROM (
    SELECT c.account_user_id AS user_id, 'customer'::text AS kind, c.name AS label
      FROM public.customers c WHERE c.user_id = auth.uid() AND c.account_user_id IS NOT NULL
    UNION ALL
    SELECT s.account_user_id, 'supplier', s.name
      FROM public.suppliers s WHERE s.user_id = auth.uid() AND s.account_user_id IS NOT NULL
    UNION ALL
    -- Reverse: I am the contact of someone else (so they can chat with me; show them as contact too)
    SELECT c.user_id, 'owner', coalesce(p2.display_name, p2.email)
      FROM public.customers c LEFT JOIN public.profiles p2 ON p2.id = c.user_id
      WHERE c.account_user_id = auth.uid()
    UNION ALL
    SELECT s.user_id, 'owner', coalesce(p2.display_name, p2.email)
      FROM public.suppliers s LEFT JOIN public.profiles p2 ON p2.id = s.user_id
      WHERE s.account_user_id = auth.uid()
  ) account
  LEFT JOIN public.profiles p ON p.id = account.user_id
  WHERE account.user_id IS NOT NULL
    AND (_q IS NULL OR _q = '' OR p.display_name ILIKE '%'||_q||'%' OR p.email ILIKE '%'||_q||'%' OR account.label ILIKE '%'||_q||'%')
  ORDER BY account.user_id, account.kind
$$;
