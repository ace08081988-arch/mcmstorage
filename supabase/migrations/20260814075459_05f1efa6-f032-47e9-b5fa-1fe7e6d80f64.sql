
create table if not exists public.chat_blocks (
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint chat_blocks_not_self check (blocker_user_id <> blocked_user_id)
);
grant select, insert, delete on public.chat_blocks to authenticated;
grant all on public.chat_blocks to service_role;
alter table public.chat_blocks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='chat_blocks' and policyname='chat_blocks select involved') then
    create policy "chat_blocks select involved" on public.chat_blocks for select to authenticated
      using (blocker_user_id = auth.uid() or blocked_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='chat_blocks' and policyname='chat_blocks insert own') then
    create policy "chat_blocks insert own" on public.chat_blocks for insert to authenticated
      with check (blocker_user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='chat_blocks' and policyname='chat_blocks delete own') then
    create policy "chat_blocks delete own" on public.chat_blocks for delete to authenticated
      using (blocker_user_id = auth.uid());
  end if;
end $$;

create table if not exists public.push_action_nonces (
  nonce text primary key,
  user_id uuid not null,
  action text not null,
  used_at timestamptz not null default now(),
  expires_at timestamptz not null
);
grant all on public.push_action_nonces to service_role;
alter table public.push_action_nonces enable row level security;
create index if not exists push_action_nonces_expires_idx on public.push_action_nonces (expires_at);

create or replace function public.chat_conversation_capabilities(_conversation_id uuid, _user_id uuid default auth.uid())
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

  select count(*), min(m.user_id) into v_peer_count, v_peer
    from public.conversation_members m
    where m.conversation_id = _conversation_id and m.user_id <> _user_id;

  if v_peer is not null then
    select exists(select 1 from public.chat_blocks b
      where b.blocker_user_id = _user_id and b.blocked_user_id = v_peer) into v_blocked_by_me;
    select exists(select 1 from public.chat_blocks b
      where b.blocker_user_id = v_peer and b.blocked_user_id = _user_id) into v_blocked_me;
  end if;

  if v_blocked_by_me then
    v_reason := 'blocked_by_me';
  elsif v_blocked_me then
    v_reason := 'blocked_by_peer';
  elsif v_kind = 'dm' and v_peer_count = 0 then
    -- Peserta lain keluar dari percakapan. Riwayat tetap terbaca.
    v_reason := 'peer_left';
  else
    v_can_send := true;
    v_can_call := (v_kind = 'dm' and v_peer_count = 1);
    if not v_can_call and v_can_send then v_reason := 'ok'; end if;
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

revoke all on function public.chat_conversation_capabilities(uuid, uuid) from public;
grant execute on function public.chat_conversation_capabilities(uuid, uuid) to authenticated, service_role;
