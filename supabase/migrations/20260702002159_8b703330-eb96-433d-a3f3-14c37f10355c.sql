
UPDATE public.profiles p
SET chat_only = true, updated_at = now()
FROM auth.users u
WHERE u.id = p.id
  AND p.chat_only = false
  AND (u.raw_user_meta_data ->> 'chat_only')::boolean = true;
