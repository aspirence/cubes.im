-- ============================================================================
-- Team chat: channels + one-to-one DMs + messages.
--
--  * chat_channels — team-scoped conversations. kind 'channel' (named, visible
--    to the whole team unless is_private) or 'dm' (exactly two people,
--    deduplicated by dm_key). Channel creation is RPC-only and gated to team
--    admins/owners (is_team_admin covers both); DMs are open to any member.
--  * chat_channel_members — join/read-state rows (last_read_at drives unread
--    badges). Public channels are readable without a row; the row appears on
--    first open (mark-read upsert) or explicit join.
--  * chat_messages — the messages. Realtime INSERTs power the live thread.
--
-- RLS: everything funnels through can_access_channel() (SECURITY DEFINER, so
-- member lookups don't recurse into channel policies).
-- ============================================================================

-- ---------------------------------------------------------------- tables ---
create table if not exists public.chat_channels (
    id         uuid                     default gen_random_uuid() not null,
    team_id    uuid                                               not null,
    kind       text                     default 'channel'         not null,
    name       text,
    topic      text,
    is_private boolean                  default false             not null,
    -- 'dm:<uuid-lo>:<uuid-hi>' — dedupes the pair per team.
    dm_key     text,
    created_by uuid                                               not null,
    created_at timestamp with time zone default current_timestamp not null,
    updated_at timestamp with time zone default current_timestamp not null,
    constraint chat_channels_pk primary key (id),
    constraint chat_channels_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint chat_channels_created_by_fk
        foreign key (created_by) references public.users (id),
    constraint chat_channels_kind_check check (kind in ('channel', 'dm')),
    constraint chat_channels_name_check check (char_length(name) <= 60),
    constraint chat_channels_topic_check check (char_length(topic) <= 240),
    constraint chat_channels_name_required check (kind = 'dm' or name is not null)
);

create unique index if not exists chat_channels_dm_key_uindex
    on public.chat_channels (team_id, dm_key) where kind = 'dm';
create unique index if not exists chat_channels_team_name_uindex
    on public.chat_channels (team_id, lower(name)) where kind = 'channel';
create index if not exists chat_channels_team_id_index
    on public.chat_channels (team_id);

create table if not exists public.chat_channel_members (
    id           uuid                     default gen_random_uuid() not null,
    channel_id   uuid                                               not null,
    user_id      uuid                                               not null,
    joined_at    timestamp with time zone default current_timestamp not null,
    last_read_at timestamp with time zone default current_timestamp not null,
    constraint chat_channel_members_pk primary key (id),
    constraint chat_channel_members_channel_fk
        foreign key (channel_id) references public.chat_channels (id) on delete cascade,
    constraint chat_channel_members_user_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint chat_channel_members_unique unique (channel_id, user_id)
);

create index if not exists chat_channel_members_user_index
    on public.chat_channel_members (user_id);
create index if not exists chat_channel_members_channel_index
    on public.chat_channel_members (channel_id);

create table if not exists public.chat_messages (
    id         uuid                     default gen_random_uuid() not null,
    channel_id uuid                                               not null,
    user_id    uuid                                               not null,
    body       text                                               not null,
    created_at timestamp with time zone default current_timestamp not null,
    edited_at  timestamp with time zone,
    constraint chat_messages_pk primary key (id),
    constraint chat_messages_channel_fk
        foreign key (channel_id) references public.chat_channels (id) on delete cascade,
    constraint chat_messages_user_fk
        foreign key (user_id) references public.users (id),
    constraint chat_messages_body_check
        check (char_length(body) between 1 and 4000)
);

create index if not exists chat_messages_channel_created_index
    on public.chat_messages (channel_id, created_at);

-- --------------------------------------------------------------- helper ---
-- Central access rule: public team channels are open to team members; DMs and
-- private channels require a membership row. SECURITY DEFINER so policies on
-- members/messages don't recurse through the channels policy.
create or replace function public.can_access_channel(_channel_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select exists (
        select 1
        from public.chat_channels c
        where c.id = _channel_id
          and (
              (c.kind = 'channel' and c.is_private = false
                  and public.is_team_member(c.team_id))
              or exists (
                  select 1 from public.chat_channel_members m
                  where m.channel_id = c.id and m.user_id = auth.uid())
          )
    );
$$;

-- ------------------------------------------------------------------ RLS ---
alter table public.chat_channels enable row level security;
alter table public.chat_channel_members enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists chat_channels_select on public.chat_channels;
create policy chat_channels_select on public.chat_channels
    for select using (public.can_access_channel(id));
drop policy if exists chat_channels_update on public.chat_channels;
create policy chat_channels_update on public.chat_channels
    for update using (created_by = auth.uid() or public.is_team_admin(team_id))
    with check (created_by = auth.uid() or public.is_team_admin(team_id));
drop policy if exists chat_channels_delete on public.chat_channels;
create policy chat_channels_delete on public.chat_channels
    for delete using (created_by = auth.uid() or public.is_team_admin(team_id));
-- Channel creation is RPC-only (admin gate + DM dedup live there).
revoke insert on public.chat_channels from authenticated;

drop policy if exists chat_channel_members_select on public.chat_channel_members;
create policy chat_channel_members_select on public.chat_channel_members
    for select using (public.can_access_channel(channel_id));
-- Self-join (public channels) / self read-state row. DM rows come from the RPC.
drop policy if exists chat_channel_members_insert on public.chat_channel_members;
create policy chat_channel_members_insert on public.chat_channel_members
    for insert with check (user_id = auth.uid() and public.can_access_channel(channel_id));
drop policy if exists chat_channel_members_update on public.chat_channel_members;
create policy chat_channel_members_update on public.chat_channel_members
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists chat_channel_members_delete on public.chat_channel_members;
create policy chat_channel_members_delete on public.chat_channel_members
    for delete using (
        user_id = auth.uid()
        or public.is_team_admin((select team_id from public.chat_channels c where c.id = channel_id))
    );

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
    for select using (public.can_access_channel(channel_id));
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
    for insert with check (user_id = auth.uid() and public.can_access_channel(channel_id));
drop policy if exists chat_messages_update on public.chat_messages;
create policy chat_messages_update on public.chat_messages
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists chat_messages_delete on public.chat_messages;
create policy chat_messages_delete on public.chat_messages
    for delete using (
        user_id = auth.uid()
        or public.is_team_admin((select team_id from public.chat_channels c where c.id = channel_id))
    );

-- ----------------------------------------------------------------- RPCs ---
-- Create a named channel — team admins/owners only (is_team_admin covers both).
create or replace function public.create_chat_channel(
    p_team_id uuid,
    p_name    text,
    p_topic   text default null,
    p_private boolean default false
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _uid  uuid := auth.uid();
    _name text := left(trim(coalesce(p_name, '')), 60);
    _id   uuid;
begin
    if _uid is null then
        raise exception 'not authenticated';
    end if;
    if not public.is_team_admin(p_team_id) then
        raise exception 'forbidden: only a team admin or owner can create channels';
    end if;
    if _name = '' then
        raise exception 'channel name is required';
    end if;
    if exists (
        select 1 from public.chat_channels
        where team_id = p_team_id and kind = 'channel' and lower(name) = lower(_name)
    ) then
        raise exception 'a channel named "%" already exists', _name;
    end if;

    insert into public.chat_channels (team_id, kind, name, topic, is_private, created_by)
    values (p_team_id, 'channel', _name, nullif(trim(coalesce(p_topic, '')), ''), p_private, _uid)
    returning id into _id;

    insert into public.chat_channel_members (channel_id, user_id)
    values (_id, _uid)
    on conflict (channel_id, user_id) do nothing;

    return _id;
end;
$$;

-- Open (or create) the 1:1 DM between the caller and another team member.
create or replace function public.get_or_create_dm(p_team_id uuid, p_other_user uuid)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _uid uuid := auth.uid();
    _key text;
    _id  uuid;
begin
    if _uid is null then
        raise exception 'not authenticated';
    end if;
    if p_other_user is null or p_other_user = _uid then
        raise exception 'pick another member to message';
    end if;
    if not public.is_team_member(p_team_id) then
        raise exception 'forbidden: not a member of this team';
    end if;
    if not exists (
        select 1 from public.team_members tm
        where tm.team_id = p_team_id and tm.user_id = p_other_user and tm.active is true
    ) then
        raise exception 'that person is not an active member of this team';
    end if;

    _key := 'dm:' || least(_uid::text, p_other_user::text) || ':' ||
            greatest(_uid::text, p_other_user::text);

    select id into _id
    from public.chat_channels
    where team_id = p_team_id and kind = 'dm' and dm_key = _key;
    if _id is not null then
        return _id;
    end if;

    begin
        insert into public.chat_channels (team_id, kind, is_private, dm_key, created_by)
        values (p_team_id, 'dm', true, _key, _uid)
        returning id into _id;
    exception when unique_violation then
        -- Raced another session creating the same DM — reuse theirs.
        select id into _id
        from public.chat_channels
        where team_id = p_team_id and kind = 'dm' and dm_key = _key;
        return _id;
    end;

    insert into public.chat_channel_members (channel_id, user_id)
    values (_id, _uid), (_id, p_other_user)
    on conflict (channel_id, user_id) do nothing;

    return _id;
end;
$$;

-- Sidebar feed: every conversation the caller can see, with the DM partner,
-- the latest message, and an unread count (others' messages after last read).
create or replace function public.list_chat_channels(p_team_id uuid)
    returns table (
        id              uuid,
        kind            text,
        name            text,
        topic           text,
        is_private      boolean,
        other_user_id   uuid,
        other_user_name text,
        other_avatar    text,
        last_body       text,
        last_at         timestamp with time zone,
        last_author     text,
        unread_count    bigint,
        joined          boolean
    )
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select
        c.id,
        c.kind,
        c.name,
        c.topic,
        c.is_private,
        ou.id,
        ou.name,
        ou.avatar_url,
        lm.body,
        lm.created_at,
        la.name,
        coalesce((
            select count(*)
            from public.chat_messages m2
            where m2.channel_id = c.id
              and m2.user_id <> auth.uid()
              and m2.created_at > coalesce(mm.last_read_at, 'epoch'::timestamptz)
        ), 0),
        (mm.id is not null)
    from public.chat_channels c
    left join public.chat_channel_members mm
        on mm.channel_id = c.id and mm.user_id = auth.uid()
    left join lateral (
        select m.body, m.created_at, m.user_id
        from public.chat_messages m
        where m.channel_id = c.id
        order by m.created_at desc
        limit 1
    ) lm on true
    left join public.users la on la.id = lm.user_id
    left join lateral (
        select u.id, u.name, u.avatar_url
        from public.chat_channel_members om
        join public.users u on u.id = om.user_id
        where om.channel_id = c.id and om.user_id <> auth.uid()
        limit 1
    ) ou on c.kind = 'dm'
    where c.team_id = p_team_id
      and public.is_team_member(p_team_id)
      and (
          (c.kind = 'channel' and c.is_private = false)
          or mm.id is not null
      )
    order by coalesce(lm.created_at, c.created_at) desc;
$$;

grant execute on function public.can_access_channel(uuid) to authenticated;
grant execute on function public.create_chat_channel(uuid, text, text, boolean) to authenticated;
grant execute on function public.get_or_create_dm(uuid, uuid) to authenticated;
grant execute on function public.list_chat_channels(uuid) to authenticated;

-- ------------------------------------------------------------- realtime ---
-- Live message delivery (postgres_changes respects RLS).
do $$
begin
    alter publication supabase_realtime add table public.chat_messages;
exception
    when duplicate_object then null;
    when undefined_object then null;
end $$;
