
-- 1) Extend order_requests to support manually-typed cart lines
ALTER TABLE public.order_requests
  ALTER COLUMN item_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS item_name text,
  ADD COLUMN IF NOT EXISTS cart_group_id uuid,
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL;

ALTER TABLE public.order_requests
  DROP CONSTRAINT IF EXISTS order_requests_item_ref_check;
ALTER TABLE public.order_requests
  ADD CONSTRAINT order_requests_item_ref_check
  CHECK (item_id IS NOT NULL OR (item_name IS NOT NULL AND btrim(item_name) <> ''));

CREATE INDEX IF NOT EXISTS order_requests_cart_group_idx
  ON public.order_requests (cart_group_id)
  WHERE cart_group_id IS NOT NULL;

-- 2) Secure RPC to create a cart from within a conversation.
--    Runs as SECURITY DEFINER so a chat-only customer can trigger it;
--    rows are written on behalf of the conversation owner (storage owner).
CREATE OR REPLACE FUNCTION public.create_chat_cart(
  p_conversation_id uuid,
  p_lines jsonb,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_group uuid := gen_random_uuid();
  v_line jsonb;
  v_name text;
  v_qty numeric;
  v_price numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Caller must be a member of the conversation
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = p_conversation_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of this conversation';
  END IF;

  SELECT owner_user_id INTO v_owner
  FROM public.conversations WHERE id = p_conversation_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Cart must have at least one line';
  END IF;

  IF jsonb_array_length(p_lines) > 50 THEN
    RAISE EXCEPTION 'Cart has too many lines (max 50)';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_name := btrim(coalesce(v_line->>'name',''));
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    v_price := NULLIF(v_line->>'price','')::numeric;

    IF v_name = '' THEN RAISE EXCEPTION 'Line name required'; END IF;
    IF length(v_name) > 200 THEN RAISE EXCEPTION 'Line name too long'; END IF;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Line qty must be > 0'; END IF;

    INSERT INTO public.order_requests
      (user_id, item_id, item_name, qty, qty_mode, price_per_unit,
       note, status, cart_group_id, conversation_id)
    VALUES
      (v_owner, NULL, v_name, v_qty, 'base', v_price,
       NULLIF(btrim(coalesce(p_note,'')), ''), 'menunggu', v_group, p_conversation_id);
  END LOOP;

  RETURN v_group;
END;
$$;

REVOKE ALL ON FUNCTION public.create_chat_cart(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_chat_cart(uuid, jsonb, text) TO authenticated;
