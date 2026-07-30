
REVOKE ALL ON FUNCTION public.send_request_prep_to_customer(uuid, uuid, text, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_request_prep_to_customer(uuid, uuid, text, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_request_prep_to_customer(uuid, uuid, text, numeric, text, text) TO authenticated;
