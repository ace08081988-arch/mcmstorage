
REVOKE EXECUTE ON FUNCTION public.can_chat(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_conversation_owner(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.start_dm(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ensure_order_conversation(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.create_group(text, uuid[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.add_group_member(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.search_chat_contacts(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.touch_conversation_on_message() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.trg_ensure_order_conv() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.trg_customer_account_linked() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.can_chat(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_dm(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_group(text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_group_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_chat_contacts(text) TO authenticated;
