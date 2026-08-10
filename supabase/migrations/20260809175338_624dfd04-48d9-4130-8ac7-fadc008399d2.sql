DROP FUNCTION IF EXISTS public.prep_submit(text, text, uuid, text, text, double precision, double precision, text, numeric);
DROP FUNCTION IF EXISTS public.prep_submit(text, text, uuid, text, text, double precision, double precision, text, numeric, timestamptz);
DROP FUNCTION IF EXISTS public.request_submit_via_task(text, text, uuid, jsonb, text, text, double precision, double precision, text, uuid);
DROP FUNCTION IF EXISTS public.send_request_prep_to_customer(uuid, uuid, text, numeric, text, text);