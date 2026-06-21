CREATE OR REPLACE FUNCTION public.ensure_order_conversation(_order uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_owner uuid; v_customer uuid; v_account uuid; v_id uuid; v_caller uuid := auth.uid(); v_role text := auth.jwt() ->> 'role';
BEGIN
  SELECT o.user_id, o.customer_id INTO v_owner, v_customer FROM public.order_requests o WHERE o.id=_order;
  IF v_owner IS NULL THEN RETURN NULL; END IF;
  IF v_customer IS NOT NULL THEN
    SELECT account_user_id INTO v_account FROM public.customers WHERE id=v_customer;
  END IF;
  IF v_account IS NULL OR v_account = v_owner THEN RETURN NULL; END IF;

  -- Authorization: only the order owner, the linked customer account, or
  -- service_role (used by triggers) may materialize this conversation.
  IF v_role IS DISTINCT FROM 'service_role'
     AND (v_caller IS NULL OR (v_caller <> v_owner AND v_caller <> v_account)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

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
END $function$;