create or replace function public.chat_capabilities_internal(_conversation_id uuid, _user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_is_member boolean;
  v_peer uuid;
  v_peer_count int;
  v_blocked_by_me boolean := false;
  v_blocked_me boolean := false;
  v_can_send boolean := false;
  v_can_call boolean := false;
  v_reason text := 'ok';
  v_version timestamptz;
begin
  if _user_id is null then
    return jsonb_build_object('canRead', false, 'canSend', false, 'canCall', false,
      'reasonCode', 'not_authenticated', 'updatedAt', now());
  end if;

  select c.kind into v_kind from public.conversations c where c.id = _conversation_id;
  if v_kind is null then
    return jsonb_build_object('canRead', false, 'canSend', false, 'canCall', false,
      'reasonCode', 'conversation_not_found', 'updatedAt', now());
  end if;

  select true into v_is_member from public.conversation_members m
    where m.conversation_id = _conversation_id and m.user_id = _user_id limit 1;
  if v_is_member is not true then
    return jsonb_build_object('canRead', false, 'canSend', false, 'canCall', false,
      'reasonCode', 'not_member', 'updatedAt', now());
  end if;

  select count(*) into v_peer_count
    from public.conversation_members m
    where m.conversation_id = _conversation_id and m.user_id <> _user_id;

  if v_kind = 'dm' and v_peer_count = 1 then
    select m.user_id into v_peer from public.conversation_members m
      where m.conversation_id = _conversation_id and m.user_id <> _user_id limit 1;
    select exists(select 1 from public.chat_blocks b
      where b.blocker_user_id = _user_id and b.blocked_user_id = v_peer) into v_blocked_by_me;
    select exists(select 1 from public.chat_blocks b
      where b.blocker_user_id = v_peer and b.blocked_user_id = _user_id) into v_blocked_me;
  end if;

  if v_blocked_by_me then
    v_reason := 'blocked_by_me';
  elsif v_blocked_me then
    v_reason := 'blocked_by_peer';
  elsif v_peer_count = 0 then
    v_reason := 'peer_left';
  else
    v_can_send := true;
    v_can_call := (v_kind = 'dm' and v_peer_count = 1);
  end if;

  select greatest(
    coalesce(max(m.joined_at), to_timestamp(0)),
    coalesce((select max(b.created_at) from public.chat_blocks b
      where (b.blocker_user_id = _user_id and b.blocked_user_id = v_peer)
         or (b.blocker_user_id = v_peer and b.blocked_user_id = _user_id)), to_timestamp(0))
  ) into v_version
  from public.conversation_members m where m.conversation_id = _conversation_id;

  return jsonb_build_object(
    'canRead', true,
    'canSend', v_can_send,
    'canCall', v_can_call,
    'reasonCode', v_reason,
    'peerUserId', v_peer,
    'kind', v_kind,
    'relationVersion', coalesce(v_version, now()),
    'updatedAt', now()
  );
end $$;

revoke all on function public.chat_capabilities_internal(uuid, uuid) from public;
revoke all on function public.chat_capabilities_internal(uuid, uuid) from authenticated;
revoke all on function public.chat_capabilities_internal(uuid, uuid) from anon;
grant execute on function public.chat_capabilities_internal(uuid, uuid) to service_role;

drop function if exists public.chat_conversation_capabilities(uuid, uuid);

create or replace function public.chat_conversation_capabilities(_conversation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.chat_capabilities_internal(_conversation_id, auth.uid());
$$;

revoke all on function public.chat_conversation_capabilities(uuid) from public;
grant execute on function public.chat_conversation_capabilities(uuid) to authenticated, service_role;

create or replace function public.chat_enforce_message_send()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then return new; end if;
  if new.sender_id is distinct from auth.uid() then
    raise exception 'chat_capability:sender_mismatch' using errcode = '42501';
  end if;
  v := public.chat_capabilities_internal(new.conversation_id, auth.uid());
  if coalesce((v->>'canSend')::boolean, false) is not true then
    raise exception 'chat_capability:%', coalesce(v->>'reasonCode', 'denied') using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists chat_enforce_message_send on public.messages;
create trigger chat_enforce_message_send
  before insert on public.messages
  for each row execute function public.chat_enforce_message_send();

create or replace function public.chat_enforce_call_create()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then return new; end if;
  if new.caller_id is distinct from auth.uid() then
    raise exception 'chat_capability:caller_mismatch' using errcode = '42501';
  end if;
  if new.callee_id = new.caller_id then
    raise exception 'chat_capability:self_call' using errcode = '42501';
  end if;
  v := public.chat_capabilities_internal(new.conversation_id, auth.uid());
  if coalesce((v->>'canCall')::boolean, false) is not true then
    raise exception 'chat_capability:%', coalesce(v->>'reasonCode', 'denied') using errcode = '42501';
  end if;
  if new.callee_id is distinct from (v->>'peerUserId')::uuid then
    raise exception 'chat_capability:callee_mismatch' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists chat_enforce_call_create on public.chat_calls;
create trigger chat_enforce_call_create
  before insert on public.chat_calls
  for each row execute function public.chat_enforce_call_create();

alter table public.push_action_nonces add column if not exists result jsonb;