-- =============================================================================
-- Chat: proper channel membership — choose who joins, and manage it later.
-- =============================================================================
-- Channels could be created with only a name + topic, and RLS only lets a user
-- self-join (chat_channel_members_insert = user_id = auth.uid()), so there was
-- no way to add other people — which matters for PRIVATE channels (a non-member
-- can't self-join one). This adds:
--   * create_chat_channel(..., p_private, p_member_ids) — seed the roster.
--   * add_channel_members / remove_channel_member — manage it afterwards.
-- Membership management is gated to a workspace admin OR the channel's creator
-- (self-removal = "leave" is always allowed). Members are passed as users.id
-- (chat_channel_members.user_id) and must be active members of the team.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. create_chat_channel — now seeds a member roster + honours private
-- -----------------------------------------------------------------------------
-- Replace the 4-arg version with a 5-arg one (extra arg defaulted, so the
-- existing 3-named-arg client call still resolves).
drop function if exists public.create_chat_channel(uuid, text, text, boolean);

create or replace function public.create_chat_channel(
    p_team_id    uuid,
    p_name       text,
    p_topic      text default null,
    p_private    boolean default false,
    p_member_ids uuid[] default '{}'::uuid[]
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
    _u    uuid;
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
    values (p_team_id, 'channel', _name, nullif(trim(coalesce(p_topic, '')), ''), coalesce(p_private, false), _uid)
    returning id into _id;

    -- Creator is always a member.
    insert into public.chat_channel_members (channel_id, user_id)
    values (_id, _uid)
    on conflict (channel_id, user_id) do nothing;

    -- Seed the chosen members (only active users of this team).
    foreach _u in array coalesce(p_member_ids, '{}'::uuid[])
    loop
        if _u is not null and _u <> _uid and exists (
            select 1 from public.team_members tm
            where tm.team_id = p_team_id and tm.user_id = _u and tm.active is true
        ) then
            insert into public.chat_channel_members (channel_id, user_id)
            values (_id, _u)
            on conflict (channel_id, user_id) do nothing;
        end if;
    end loop;

    return _id;
end;
$$;

revoke all on function public.create_chat_channel(uuid, text, text, boolean, uuid[]) from public;
grant execute on function public.create_chat_channel(uuid, text, text, boolean, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. add_channel_members — add people to an existing channel
-- -----------------------------------------------------------------------------
create or replace function public.add_channel_members(
    p_channel_id uuid,
    p_user_ids   uuid[]
)
    returns integer
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _ch    public.chat_channels%rowtype;
    _u     uuid;
    _added integer := 0;
begin
    select * into _ch from public.chat_channels where id = p_channel_id;
    if _ch.id is null then
        raise exception 'add_channel_members: channel not found';
    end if;
    if _ch.kind <> 'channel' then
        raise exception 'add_channel_members: cannot add members to a DM';
    end if;
    -- A workspace admin or the channel's creator manages the roster.
    if not (public.is_team_admin(_ch.team_id) or _ch.created_by = auth.uid()) then
        raise exception 'add_channel_members: not permitted';
    end if;

    foreach _u in array coalesce(p_user_ids, '{}'::uuid[])
    loop
        if _u is not null and exists (
            select 1 from public.team_members tm
            where tm.team_id = _ch.team_id and tm.user_id = _u and tm.active is true
        ) then
            insert into public.chat_channel_members (channel_id, user_id)
            values (p_channel_id, _u)
            on conflict (channel_id, user_id) do nothing;
            if found then
                _added := _added + 1;
            end if;
        end if;
    end loop;

    return _added;
end;
$$;

revoke all on function public.add_channel_members(uuid, uuid[]) from public;
grant execute on function public.add_channel_members(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. remove_channel_member — remove one person (or leave, if it's yourself)
-- -----------------------------------------------------------------------------
create or replace function public.remove_channel_member(
    p_channel_id uuid,
    p_user_id    uuid
)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _ch public.chat_channels%rowtype;
begin
    select * into _ch from public.chat_channels where id = p_channel_id;
    if _ch.id is null then
        raise exception 'remove_channel_member: channel not found';
    end if;
    -- Admin/creator can remove anyone; anyone can remove themselves (leave).
    if not (public.is_team_admin(_ch.team_id)
            or _ch.created_by = auth.uid()
            or p_user_id = auth.uid()) then
        raise exception 'remove_channel_member: not permitted';
    end if;
    -- Keep the creator in their own channel unless they're the one leaving.
    if p_user_id = _ch.created_by and auth.uid() <> _ch.created_by then
        raise exception 'remove_channel_member: cannot remove the channel creator';
    end if;

    delete from public.chat_channel_members
    where channel_id = p_channel_id and user_id = p_user_id;
end;
$$;

revoke all on function public.remove_channel_member(uuid, uuid) from public;
grant execute on function public.remove_channel_member(uuid, uuid) to authenticated;
