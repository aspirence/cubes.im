-- =============================================================================
-- Chat v2 — Slack-parity backend: threads, pins, saved, group DMs, search,
--            live sidebar, and notify/unread fixes
-- =============================================================================
-- Buzz/Slack-parity upgrade of the chat schema (builds on 20261053 chat core,
-- 20261065 membership, 20261089 attachments, 20261095 reactions, 20261104
-- notifications). Adds:
--
--   * THREADS — chat_messages.parent_id (one level deep, Slack semantics: a
--     reply to a reply is re-rooted to the thread root by trigger). Top-level
--     lists exclude replies; unread counts and channel previews ignore them;
--     thread replies notify THREAD PARTICIPANTS instead of the whole channel.
--   * PINS — pinned_at / pinned_by on messages + set_message_pinned RPC (any
--     channel member can pin/unpin, like Slack; direct UPDATE stays own-only).
--   * SAVED — chat_saved_messages (per-user bookmarks, "Saved items").
--   * GROUP DMs — chat_channels.kind gains 'group'; create_group_dm RPC seeds
--     caller + 2..8 other active members; list_chat_channels aggregates the
--     member names for the row label.
--   * SEARCH — search_chat_messages RPC (ILIKE + pg_trgm gin index), scoped by
--     can_access_channel per row.
--   * MUTE — chat_channel_members.muted_at (per-member quiet switch). Muted
--     members keep reading but receive no chat_message notifications; the
--     sidebar list reports a `muted` flag.
--   * ARCHIVE — chat_channels.archived_at + set_channel_archived RPC (team
--     admin or channel creator, named channels only). Archived channels are
--     read-only in the UI and drop out of the sidebar for non-members; the
--     sidebar list reports an `archived` flag for joined members.
--   * LIVE SIDEBAR — chat_channels + chat_channel_members join the realtime
--     publication so new conversations / membership / read-state stream.
--   * FIXES — edited_at is now set by a SERVER trigger on body change (was
--     client-set); notify snippet falls back to "📎 Attachment" for body-less
--     messages; never-joined public channels report 0 unread (was: entire
--     history); chat_channels.updated_at finally has its trigger; missing
--     chat_messages(user_id) index.
-- =============================================================================

-- =============================================================================
-- SECTION 1: Columns + constraints
-- =============================================================================

-- 1.1 Threads.
alter table public.chat_messages
    add column if not exists parent_id uuid;

do $$
begin
    alter table public.chat_messages
        add constraint chat_messages_parent_fk
            foreign key (parent_id) references public.chat_messages (id)
            on delete cascade;
exception
    when duplicate_object then null;
end $$;

-- 1.2 Pins.
alter table public.chat_messages
    add column if not exists pinned_at timestamp with time zone,
    add column if not exists pinned_by uuid;

do $$
begin
    alter table public.chat_messages
        add constraint chat_messages_pinned_by_fk
            foreign key (pinned_by) references public.users (id)
            on delete set null;
exception
    when duplicate_object then null;
end $$;

-- 1.3 Group DMs: widen kind; name stays optional for dm AND group.
alter table public.chat_channels
    drop constraint if exists chat_channels_kind_check;
alter table public.chat_channels
    add constraint chat_channels_kind_check
        check (kind in ('channel', 'dm', 'group'));

alter table public.chat_channels
    drop constraint if exists chat_channels_name_required;
alter table public.chat_channels
    add constraint chat_channels_name_required
        check (kind in ('dm', 'group') or name is not null);

-- 1.4 Indexes.
create index if not exists chat_messages_parent_idx
    on public.chat_messages (parent_id, created_at)
    where parent_id is not null;
create index if not exists chat_messages_pinned_idx
    on public.chat_messages (channel_id, pinned_at)
    where pinned_at is not null;
create index if not exists chat_messages_user_idx
    on public.chat_messages (user_id);

-- Trigram search over message bodies (ILIKE '%q%' uses the gin index).
create extension if not exists pg_trgm with schema extensions;
create index if not exists chat_messages_body_trgm_idx
    on public.chat_messages using gin (body extensions.gin_trgm_ops);

-- 1.5 Saved items.
create table if not exists public.chat_saved_messages (
    id         uuid                     default gen_random_uuid() not null,
    user_id    uuid                                               not null,
    message_id uuid                                               not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint chat_saved_messages_pk primary key (id),
    constraint chat_saved_messages_user_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint chat_saved_messages_message_fk
        foreign key (message_id) references public.chat_messages (id) on delete cascade,
    constraint chat_saved_messages_uindex unique (user_id, message_id)
);
create index if not exists chat_saved_messages_user_idx
    on public.chat_saved_messages (user_id, created_at desc);

alter table public.chat_saved_messages enable row level security;

drop policy if exists chat_saved_messages_select on public.chat_saved_messages;
create policy chat_saved_messages_select on public.chat_saved_messages
    for select to authenticated
    using (user_id = auth.uid());

drop policy if exists chat_saved_messages_insert on public.chat_saved_messages;
create policy chat_saved_messages_insert on public.chat_saved_messages
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and exists (
            select 1 from public.chat_messages m
            where m.id = message_id
              and public.can_access_channel(m.channel_id)
        )
    );

drop policy if exists chat_saved_messages_delete on public.chat_saved_messages;
create policy chat_saved_messages_delete on public.chat_saved_messages
    for delete to authenticated
    using (user_id = auth.uid());

grant select, insert, delete on public.chat_saved_messages to authenticated;
grant all on public.chat_saved_messages to service_role;
revoke all on public.chat_saved_messages from anon;

-- 1.6 Mute — a member's own quiet switch for one conversation. RLS already
--     restricts chat_channel_members UPDATE/INSERT to the caller's own row.
alter table public.chat_channel_members
    add column if not exists muted_at timestamp with time zone;

-- 1.7 Archive — Slack-style soft close for named channels. Members keep their
--     history (read-only UI); set/cleared only via set_channel_archived (3.5).
alter table public.chat_channels
    add column if not exists archived_at timestamp with time zone;

-- =============================================================================
-- SECTION 2: Triggers
-- =============================================================================

-- 2.1 Thread integrity: parent must exist in the SAME channel; replying to a
--     reply re-roots onto the thread root (Slack keeps threads one level deep).
--     On UPDATE the structural columns are immutable: parent_id never moves,
--     and the pin columns only move through set_message_pinned (which raises
--     the transaction-local flag below). Parent validation is insert-only.
create or replace function public.chat_validate_thread_parent()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _parent public.chat_messages;
begin
    if tg_op = 'UPDATE' then
        new.parent_id := old.parent_id;
        if coalesce(current_setting('chat.allow_pin_update', true), '') <> '1' then
            new.pinned_at := old.pinned_at;
            new.pinned_by := old.pinned_by;
        end if;
        return new;
    end if;
    if new.parent_id is null then
        return new;
    end if;
    select * into _parent from public.chat_messages where id = new.parent_id;
    if _parent.id is null then
        raise exception 'thread parent not found';
    end if;
    if _parent.channel_id <> new.channel_id then
        raise exception 'thread parent belongs to another conversation';
    end if;
    if _parent.parent_id is not null then
        new.parent_id := _parent.parent_id;
    end if;
    return new;
end;
$$;

drop trigger if exists chat_messages_thread_parent_trg on public.chat_messages;
create trigger chat_messages_thread_parent_trg
    before insert or update on public.chat_messages
    for each row execute function public.chat_validate_thread_parent();

-- 2.2 Server-side edited_at: stamped only when the body actually changes, so
--     pin/unpin updates don't mark a message "(edited)".
create or replace function public.chat_stamp_edited()
    returns trigger
    language plpgsql
as
$$
begin
    if new.body is distinct from old.body then
        new.edited_at := current_timestamp;
    end if;
    return new;
end;
$$;

drop trigger if exists chat_messages_stamp_edited_trg on public.chat_messages;
create trigger chat_messages_stamp_edited_trg
    before update on public.chat_messages
    for each row execute function public.chat_stamp_edited();

-- 2.3 chat_channels.updated_at was declared and never maintained.
drop trigger if exists chat_channels_set_updated_at on public.chat_channels;
create trigger chat_channels_set_updated_at
    before update on public.chat_channels
    for each row execute function public.set_row_updated_at();

-- 2.4 Notify rewrite: attachment-only fallback snippet, group-DM wording, and
--     THREAD replies notify thread participants only (root author + repliers),
--     not the whole channel. Members who MUTED the conversation (their
--     membership row has muted_at) are skipped in both branches.
create or replace function public.chat_messages_notify()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    ch        public.chat_channels;
    v_sender  text;
    v_flat    text;
    v_snippet text;
    v_msg     text;
    v_url     text;
    v_count   integer;
    r record;
begin
    select * into ch from public.chat_channels where id = new.channel_id;
    if ch.id is null then
        return new;
    end if;
    -- Belt and braces: the not-archived trigger (2.7) already blocks inserts,
    -- but if anything slips through, at least don't notify about it.
    if ch.archived_at is not null then
        return new;
    end if;

    select name into v_sender from public.users where id = new.user_id;
    v_sender := coalesce(v_sender, 'Someone');

    -- Single-line, trimmed snippet; body-less (attachment) messages get a
    -- readable fallback instead of "Alice: ".
    v_flat := btrim(regexp_replace(new.body, '\s+', ' ', 'g'));
    v_snippet := left(v_flat, 90);
    if char_length(v_flat) > 90 then
        v_snippet := v_snippet || '…';
    end if;
    if v_snippet = '' then
        v_snippet := '📎 Attachment';
    end if;

    v_url := '/chat/' || new.channel_id::text;

    if new.parent_id is not null then
        -- Thread reply → participants of that thread only, and only those
        -- STILL in the channel (people who left must not keep getting pinged).
        -- Threads get their own url identity ('?thread=<root>') so their
        -- notifications coalesce/clear separately from the channel's.
        v_url := '/chat/' || new.channel_id::text || '?thread=' || new.parent_id::text;
        v_msg := v_sender || ' replied in a thread: ' || v_snippet;
        for r in
            select distinct t.user_id
            from public.chat_messages t
            where (t.id = new.parent_id or t.parent_id = new.parent_id)
              and t.user_id <> new.user_id
              and exists (
                  select 1
                  from public.chat_channel_members cm
                  where cm.channel_id = new.channel_id
                    and cm.user_id = t.user_id
                    and cm.muted_at is null
              )
        loop
            update public.user_notifications
               set message = v_msg, created_at = current_timestamp, read = false
             where user_id = r.user_id
               and type = 'chat_message'
               and url = v_url
               and read = false;
            get diagnostics v_count = row_count;
            if v_count = 0 then
                perform public.create_notification(
                    r.user_id, v_msg, 'chat_message', v_url, ch.team_id, null, null);
            end if;
        end loop;
        return new;
    end if;

    if ch.kind = 'dm' then
        v_msg := v_sender || ': ' || v_snippet;
    elsif ch.kind = 'group' then
        v_msg := v_sender || ' in a group message: ' || v_snippet;
    else
        v_msg := v_sender || ' in #' || coalesce(ch.name, 'channel') || ': ' || v_snippet;
    end if;

    for r in
        select user_id
        from public.chat_channel_members
        where channel_id = new.channel_id
          and user_id <> new.user_id
          and muted_at is null
    loop
        update public.user_notifications
           set message = v_msg, created_at = current_timestamp, read = false
         where user_id = r.user_id
           and type = 'chat_message'
           and url = v_url
           and read = false;
        get diagnostics v_count = row_count;
        if v_count = 0 then
            perform public.create_notification(
                r.user_id, v_msg, 'chat_message', v_url, ch.team_id, null, null);
        end if;
    end loop;

    return new;
end;
$$;

-- 2.5 Opening a conversation now clears BOTH notification identities: the
--     channel's plain '/chat/<id>' AND its threads' '/chat/<id>?thread=<root>'
--     (introduced in 2.4 above). Only a FORWARD move of the read pointer
--     clears — "mark unread" rewinds it and must leave notifications alone.
--     INSERT (first join) still clears unconditionally. Trigger unchanged
--     (20261104).
create or replace function public.chat_read_clear_notifications()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
begin
    if tg_op = 'UPDATE'
        and coalesce(new.last_read_at, '-infinity'::timestamptz)
            <= coalesce(old.last_read_at, '-infinity'::timestamptz) then
        return new;
    end if;
    update public.user_notifications
       set read = true
     where user_id = new.user_id
       and type = 'chat_message'
       and (
           url = '/chat/' || new.channel_id::text
           or url like '/chat/' || new.channel_id::text || '?%'
       )
       and read = false;
    return new;
end;
$$;

-- 2.6 Lock the UPDATE surface: clients may only change body/attachments.
--     parent_id / pinned_at / pinned_by / channel_id / user_id are off-limits
--     to direct updates; SECURITY DEFINER RPCs (set_message_pinned) still work.
revoke update on public.chat_messages from authenticated;
grant update (body, attachments) on public.chat_messages to authenticated;

--     Same for chat_channels: clients may only rename / retopic. archived_at /
--     kind / is_private / team_id / dm_key / created_by only move through the
--     SECURITY DEFINER RPCs (set_channel_archived, create_group_dm, …).
revoke update on public.chat_channels from authenticated;
grant update (name, topic) on public.chat_channels to authenticated;

-- 2.7 Archived channels are read-only ON THE SERVER, not just in the UI: new
--     messages and reactions bounce with a clear error. Branches on the firing
--     table (same pattern as app_crm_track_attach); reactions resolve their
--     channel through the target message.
create or replace function public.chat_assert_not_archived()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _channel_id uuid;
begin
    if tg_table_name = 'chat_message_reactions' then
        select m.channel_id into _channel_id
        from public.chat_messages m
        where m.id = new.message_id;
    else
        _channel_id := new.channel_id;
    end if;
    if exists (
        select 1
        from public.chat_channels c
        where c.id = _channel_id
          and c.archived_at is not null
    ) then
        raise exception 'this channel is archived';
    end if;
    return new;
end;
$$;

drop trigger if exists chat_messages_not_archived_trg on public.chat_messages;
create trigger chat_messages_not_archived_trg
    before insert on public.chat_messages
    for each row execute function public.chat_assert_not_archived();

drop trigger if exists chat_message_reactions_not_archived_trg on public.chat_message_reactions;
create trigger chat_message_reactions_not_archived_trg
    before insert on public.chat_message_reactions
    for each row execute function public.chat_assert_not_archived();

-- =============================================================================
-- SECTION 3: RPCs
-- =============================================================================

-- 3.1 Pin/unpin — any member with channel access (Slack semantics). Direct
--     UPDATE on chat_messages stays own-rows-only; this RPC is the only path
--     that lets you pin someone else's message.
create or replace function public.set_message_pinned(
    p_message_id uuid,
    p_pinned     boolean
)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _msg public.chat_messages;
begin
    select * into _msg from public.chat_messages where id = p_message_id;
    if _msg.id is null then
        raise exception 'message not found';
    end if;
    if not public.can_access_channel(_msg.channel_id) then
        raise exception 'forbidden: no access to this conversation';
    end if;
    if exists (
        select 1
        from public.chat_channels c
        where c.id = _msg.channel_id
          and c.archived_at is not null
    ) then
        raise exception 'this channel is archived';
    end if;
    -- Transaction-local flag: lets chat_validate_thread_parent (which freezes
    -- the pin columns on UPDATE) recognize this sanctioned pin move.
    perform set_config('chat.allow_pin_update', '1', true);
    update public.chat_messages
       set pinned_at = case when p_pinned then current_timestamp end,
           pinned_by = case when p_pinned then auth.uid() end
     where id = p_message_id;
end;
$$;

-- 3.2 Group DM — caller + 2..8 other ACTIVE, non-guest members. Private, no
--     name (the roster is the label). No dedup key: Slack also allows several
--     group conversations over the same roster.
create or replace function public.create_group_dm(
    p_team_id    uuid,
    p_member_ids uuid[]
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _ids uuid[];
    _cid uuid;
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'forbidden: not a member of this team';
    end if;

    select array_agg(distinct tm.user_id) into _ids
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.active is true
      and tm.member_type <> 'guest'
      and tm.user_id = any (p_member_ids)
      and tm.user_id <> auth.uid();

    if coalesce(array_length(_ids, 1), 0) < 2 then
        raise exception 'a group message needs you and at least 2 other members';
    end if;
    if array_length(_ids, 1) > 8 then
        raise exception 'a group message holds at most 9 people';
    end if;

    insert into public.chat_channels (team_id, kind, name, is_private, created_by)
    values (p_team_id, 'group', null, true, auth.uid())
    returning id into _cid;

    insert into public.chat_channel_members (channel_id, user_id)
    select _cid, uid from unnest(array_append(_ids, auth.uid())) as uid;

    return _cid;
end;
$$;

-- 3.3 Search — scoped per row by can_access_channel; ILIKE rides the trigram
--     index. Callers get message + conversation + author context for the
--     result list.
create or replace function public.search_chat_messages(
    p_team_id uuid,
    p_query   text,
    p_limit   integer default 30
)
    returns table (
        message_id    uuid,
        channel_id    uuid,
        channel_kind  text,
        channel_name  text,
        parent_id     uuid,
        body          text,
        created_at    timestamp with time zone,
        author_id     uuid,
        author_name   text,
        author_avatar text
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
declare
    _q text;
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'forbidden: not a member of this team';
    end if;
    _q := btrim(coalesce(p_query, ''));
    if char_length(_q) < 2 then
        return;
    end if;
    -- Escape ILIKE metacharacters (backslash first!) so a user searching for
    -- a literal %, _ or \ matches it instead of everything.
    _q := replace(replace(replace(_q, '\', '\\'), '%', '\%'), '_', '\_');

    return query
    select
        m.id,
        m.channel_id,
        c.kind,
        c.name,
        m.parent_id,
        m.body,
        m.created_at,
        u.id,
        u.name,
        u.avatar_url
    from public.chat_messages m
    join public.chat_channels c on c.id = m.channel_id
    join public.users u on u.id = m.user_id
    where c.team_id = p_team_id
      and m.body ilike '%' || _q || '%' escape '\'
      and public.can_access_channel(m.channel_id)
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- 3.4 list_chat_channels — return shape changes (group rosters + member
--     count + muted/archived flags), so drop-and-recreate. Fixes on the way
--     through:
--       * unread_count ignores THREAD REPLIES (they live in the thread view);
--       * a public channel you never joined reports 0 unread (was: its whole
--         history);
--       * the preview line (last_body/last_at/last_author) is top-level only;
--       * kind='group' rows aggregate the other members' names + count;
--       * ARCHIVED channels are excluded entirely, except for joined members
--         (their rows return archived = true so the UI can go read-only).
drop function if exists public.list_chat_channels(uuid);
create function public.list_chat_channels(p_team_id uuid)
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
        joined          boolean,
        member_count    bigint,
        member_names    text,
        muted           boolean,
        archived        boolean
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
        case
            when mm.id is null then 0
            else coalesce((
                select count(*)
                from public.chat_messages m2
                where m2.channel_id = c.id
                  and m2.user_id <> auth.uid()
                  and m2.parent_id is null
                  and m2.created_at > mm.last_read_at
            ), 0)
        end,
        (mm.id is not null),
        coalesce(mc.n, 0),
        gm.names,
        (mm.muted_at is not null),
        (c.archived_at is not null)
    from public.chat_channels c
    left join public.chat_channel_members mm
        on mm.channel_id = c.id and mm.user_id = auth.uid()
    left join lateral (
        select m.body, m.created_at, m.user_id
        from public.chat_messages m
        where m.channel_id = c.id
          and m.parent_id is null
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
    left join lateral (
        select count(*) as n
        from public.chat_channel_members am
        where am.channel_id = c.id
    ) mc on true
    left join lateral (
        select string_agg(u.name, ', ' order by u.name) as names
        from public.chat_channel_members om
        join public.users u on u.id = om.user_id
        where om.channel_id = c.id and om.user_id <> auth.uid()
    ) gm on c.kind = 'group'
    where c.team_id = p_team_id
      and public.is_team_member(p_team_id)
      and (
          (c.kind = 'channel' and c.is_private = false)
          or mm.id is not null
      )
      and (c.archived_at is null or mm.id is not null)
    order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- 3.5 Archive / unarchive a named channel — team admin or the channel creator.
--     DMs and groups can't be archived (leave/close them instead). The UI goes
--     read-only for archived channels; list_chat_channels hides them from
--     non-members (see 3.4).
create or replace function public.set_channel_archived(
    p_channel_id uuid,
    p_archived   boolean
)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _ch public.chat_channels;
begin
    select * into _ch from public.chat_channels where id = p_channel_id;
    if _ch.id is null then
        raise exception 'channel not found';
    end if;
    if _ch.kind <> 'channel' then
        raise exception 'only named channels can be archived';
    end if;
    if not (public.is_team_admin(_ch.team_id) or _ch.created_by = auth.uid()) then
        raise exception 'forbidden: only a team admin or the channel creator can archive';
    end if;
    update public.chat_channels
       set archived_at = case when p_archived then current_timestamp end
     where id = p_channel_id;
end;
$$;

grant execute on function public.set_message_pinned(uuid, boolean)    to authenticated;
grant execute on function public.create_group_dm(uuid, uuid[])        to authenticated;
grant execute on function public.search_chat_messages(uuid, text, integer) to authenticated;
grant execute on function public.list_chat_channels(uuid)             to authenticated;
grant execute on function public.set_channel_archived(uuid, boolean)  to authenticated;

-- =============================================================================
-- SECTION 4: Realtime — live sidebar (new conversations, membership,
-- read-state). chat_messages / chat_message_reactions are already published.
-- =============================================================================

do $$
begin
    alter publication supabase_realtime add table public.chat_channels;
exception
    when duplicate_object then null;
    when undefined_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.chat_channel_members;
exception
    when duplicate_object then null;
    when undefined_object then null;
end $$;
