-- =============================================================================
-- Sheets ↔ Google — push sync: Drive notification channels
-- =============================================================================
-- Until now a linked Google Sheet was only ever read on a timer:
-- app_sheet_google_links.next_run_at + interval_minutes (default 15), drained by
-- the runner tick. Somebody typing in Google waited up to a quarter of an hour
-- for Cubes to notice.
--
-- This adds the other half: a Drive files.watch channel per linked spreadsheet.
-- Google POSTs to /api/hooks/google/drive the moment the file changes, and the
-- SAME sync runs — src/lib/sheets/google-sync.ts, unchanged. Polling stays
-- exactly as it was, because push is best-effort: a channel expires (Drive caps
-- a FILES channel at 24 hours, and defaults to one hour), a notification gets
-- dropped, or the deployment has no public HTTPS address at all. The two paths
-- share app_sheet_google_links.lease_until, so they can never sync one sheet
-- twice at once.
--
-- SECURITY SHAPE. The receiving endpoint is public and unauthenticated — that
-- is what a Google push channel is. Everything that makes it safe lives here:
--   * we mint the channel id and a 32-byte token; Google echoes both back;
--   * only the SHA-256 of the token is stored, so a copy of this table is not a
--     forgery kit;
--   * the caller is never allowed to name a team, a sheet or a link. The channel
--     row is the only mapping from "some request arrived" to "this sheet", and
--     app_sheet_drive_channel_claim is the only way to read it.
--
-- Re-runnable and purely additive: create … if not exists, drop policy if
-- exists, create or replace. No existing row or table is modified.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. app_sheet_drive_channels
-- -----------------------------------------------------------------------------
create table if not exists public.app_sheet_drive_channels (
    id              uuid default gen_random_uuid() not null,
    -- ON DELETE SET NULL, not cascade, and that is deliberate: Drive keeps
    -- POSTing at a channel until it is stopped or expires, and channels.stop
    -- needs the channel id AND resource_id. Cascading the row away with the
    -- link would throw both out and leave Google calling a stranger for up to a
    -- day. A null link_id is the signal for "stop this at Google, then retire".
    link_id         uuid,
    -- Likewise: the grant that registered the channel is the only credential
    -- that can stop it. Null means it is unstoppable and can only be waited out.
    connection_id   uuid,
    -- Kept as plain columns, not derived through link_id, so an orphaned row
    -- still knows what it was watching after the link is gone.
    team_id         uuid not null,
    sheet_id        uuid not null,
    spreadsheet_id  text not null,
    -- The id WE mint and send to Drive; it comes back as X-Goog-Channel-ID.
    channel_id      text not null,
    -- Google's opaque id for the watched file. Required by channels.stop.
    resource_id     text,
    resource_uri    text,
    -- SHA-256 hex of the channel token. The token itself is never stored: it
    -- exists in memory for one HTTP call to Google and nowhere else.
    token_hash      text not null,
    -- The webhook URL this channel was registered with. When the deployment
    -- moves (preview → production, or a new tunnel in dev) every channel still
    -- points at the old host, so the address is part of "is this still valid".
    address         text not null,
    -- What Google actually granted, not what we asked for — it clamps.
    expires_at      timestamptz not null,
    status          text not null default 'pending',
    -- Highest X-Goog-Message-Number seen. Google may redeliver and may reorder;
    -- anything at or below this number has already been acted on.
    last_message_number bigint,
    last_resource_state text,
    last_notified_at    timestamptz,
    notify_count        integer not null default 0,
    -- When a notification arrived inside the debounce window. A burst of edits
    -- produces a burst of notifications; the first runs a sync, the rest set
    -- this so the tick picks up the tail instead of syncing per keystroke.
    pending_since       timestamptz,
    last_sync_trigger_at timestamptz,
    -- Registration backoff, so a file Drive keeps refusing is not retried every
    -- tick forever.
    fail_count      integer not null default 0,
    retry_after     timestamptz,
    last_error      text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint app_sheet_drive_channels_pk primary key (id),
    constraint app_sheet_drive_channels_channel_uniq unique (channel_id),
    constraint app_sheet_drive_channels_link_fk
        foreign key (link_id) references public.app_sheet_google_links (id) on delete set null,
    constraint app_sheet_drive_channels_connection_fk
        foreign key (connection_id) references public.app_google_connections (id) on delete set null,
    constraint app_sheet_drive_channels_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_sheet_drive_channels_status_check
        check (status in ('pending', 'active', 'failed', 'stopping', 'stopped', 'expired')),
    constraint app_sheet_drive_channels_channel_check
        check (char_length(channel_id) between 8 and 64),
    constraint app_sheet_drive_channels_token_check
        check (char_length(token_hash) = 64),
    constraint app_sheet_drive_channels_error_check
        check (last_error is null or char_length(last_error) <= 1000)
);

-- One registration in flight per link. Two runner ticks overlapping would
-- otherwise both mint a channel and we would pay for two sets of notifications.
-- Deliberately NOT covering 'active': a renewal registers the replacement while
-- the old channel is still live, which is what makes the handover gapless.
create unique index if not exists app_sheet_drive_channels_pending_uindex
    on public.app_sheet_drive_channels (link_id)
    where status = 'pending' and link_id is not null;

create index if not exists app_sheet_drive_channels_link_index
    on public.app_sheet_drive_channels (link_id) where status in ('pending', 'active');
create index if not exists app_sheet_drive_channels_expiry_index
    on public.app_sheet_drive_channels (expires_at) where status in ('pending', 'active');
create index if not exists app_sheet_drive_channels_pending_index
    on public.app_sheet_drive_channels (pending_since) where pending_since is not null;

drop trigger if exists app_sheet_drive_channels_set_updated_at on public.app_sheet_drive_channels;
create trigger app_sheet_drive_channels_set_updated_at
    before update on public.app_sheet_drive_channels
    for each row execute function public.set_row_updated_at();

alter table public.app_sheet_drive_channels enable row level security;

-- Members read the status of channels for sheets they can already see, so the
-- Sheets UI can say "live sync on" honestly. Nothing readable here is a secret:
-- token_hash is a digest and the channel id is useless without the token.
-- There is no insert/update/delete policy at all — only service_role writes.
drop policy if exists app_sheet_drive_channels_select on public.app_sheet_drive_channels;
create policy app_sheet_drive_channels_select on public.app_sheet_drive_channels
    for select to authenticated
    using (public.app_sheets_can_access(sheet_id));


-- -----------------------------------------------------------------------------
-- 2. app_sheet_drive_channel_claim — the whole webhook decision, atomically
-- -----------------------------------------------------------------------------
-- The receiver hands over exactly what Google put in the headers, plus the
-- SHA-256 of the token it was given, and gets back one verb. Doing it in one
-- statement under a row lock is what makes the duplicate and the debounce
-- honest: two notifications landing on two serverless instances in the same
-- millisecond serialise here, and exactly one of them gets 'sync'.
--
-- On the token comparison: this matches DIGESTS, not the secret. A timing side
-- channel on `=` over a SHA-256 hex string cannot be walked back into a token,
-- because producing a token whose digest shares a chosen prefix means inverting
-- SHA-256. Constant-time comparison would buy nothing here.
--
-- Returned actions:
--   'sync'      a real change; run the sheet sync now.
--   'defer'     a real change inside the debounce window; pending_since is set
--               and the runner tick will flush it.
--   'handshake' the 'sync' resource state Drive sends the instant a channel is
--               registered. It means "the channel works", never "data changed".
--   'gone'      the file was trashed or unshared. Recorded, never synced — the
--               sync would only fail and park the link's schedule.
--   'ignore'    a state we do not act on.
create or replace function public.app_sheet_drive_channel_claim(
    p_channel_id       text,
    p_token_hash       text,
    p_message_number   bigint default null,
    p_state            text default null,
    p_cooldown_seconds integer default 20
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    _row      public.app_sheet_drive_channels;
    _state    text := lower(coalesce(p_state, ''));
    _cooldown integer := greatest(0, least(coalesce(p_cooldown_seconds, 20), 600));
    _action   text;
begin
    if coalesce(p_channel_id, '') = '' or coalesce(p_token_hash, '') = '' then
        return jsonb_build_object('ok', false, 'reason', 'malformed');
    end if;

    select * into _row
      from public.app_sheet_drive_channels
     where channel_id = p_channel_id
     for update;

    if not found then
        return jsonb_build_object('ok', false, 'reason', 'unknown');
    end if;
    if _row.token_hash is distinct from p_token_hash then
        -- Someone has the channel id but not the token. Say nothing useful.
        return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if _row.status not in ('pending', 'active') then
        -- A channel we already retired. Google will stop on its own at expiry.
        return jsonb_build_object('ok', false, 'reason', 'inactive', 'status', _row.status);
    end if;

    -- Redelivery and reordering: Google's message numbers only go up within a
    -- channel, so anything we have already seen is a repeat of settled work.
    if p_message_number is not null
       and _row.last_message_number is not null
       and p_message_number <= _row.last_message_number then
        return jsonb_build_object(
            'ok', false, 'reason', 'duplicate',
            'message_number', p_message_number,
            'last_message_number', _row.last_message_number);
    end if;

    _action := case
        when _state = 'sync' then 'handshake'
        when _state in ('update', 'add', 'change', 'untrash') then 'sync'
        when _state in ('remove', 'trash') then 'gone'
        else 'ignore'
    end;

    if _action = 'sync'
       and _row.last_sync_trigger_at is not null
       and _row.last_sync_trigger_at > now() - make_interval(secs => _cooldown) then
        _action := 'defer';
    end if;

    update public.app_sheet_drive_channels
       set last_message_number  = greatest(coalesce(last_message_number, 0), coalesce(p_message_number, 0)),
           last_resource_state  = coalesce(nullif(_state, ''), last_resource_state),
           last_notified_at     = now(),
           notify_count         = notify_count + 1,
           -- A handshake proves the channel is live; treat it as confirmation
           -- that a still-'pending' registration landed.
           status               = case when status = 'pending' and _state = 'sync' then 'active' else status end,
           last_sync_trigger_at = case when _action = 'sync' then now() else last_sync_trigger_at end,
           pending_since        = case
                                    when _action = 'defer' then coalesce(pending_since, now())
                                    when _action = 'sync'  then null
                                    else pending_since
                                  end
     where id = _row.id;

    return jsonb_build_object(
        'ok', true,
        'action', _action,
        'channel_row_id', _row.id,
        'link_id', _row.link_id,
        'team_id', _row.team_id,
        'sheet_id', _row.sheet_id,
        'spreadsheet_id', _row.spreadsheet_id,
        'state', _state,
        'message_number', p_message_number);
end;
$$;

revoke all on function public.app_sheet_drive_channel_claim(text, text, bigint, text, integer)
    from public, anon, authenticated;
grant execute on function public.app_sheet_drive_channel_claim(text, text, bigint, text, integer)
    to service_role;


-- -----------------------------------------------------------------------------
-- 3. app_sheets_watch_worklist — what the runner tick has to do about channels
-- -----------------------------------------------------------------------------
-- Three jobs in one read, each with its own limit so a backlog of one never
-- starves the others:
--   'watch' a link that should have a live channel and does not (or whose
--           channel expires soon, or points at a host we no longer serve).
--   'stop'  a channel Google should stop calling: its link is gone, its sheet
--           was archived, auto-sync was switched off, or it was superseded by a
--           renewal.
--   'flush' a channel holding a deferred change (pending_since) that the
--           debounce window swallowed.
--
-- p_address is the webhook URL the caller would register today. Passing it in
-- rather than storing it as config keeps the "the deployment moved" test in one
-- place — the code that knows the URL.
create or replace function public.app_sheets_watch_worklist(
    p_limit                integer default 20,
    p_renew_before_seconds integer default 7200,
    p_address              text default null
)
    returns table (
        kind            text,
        link_id         uuid,
        team_id         uuid,
        sheet_id        uuid,
        connection_id   uuid,
        spreadsheet_id  text,
        channel_row_id  uuid,
        channel_id      text,
        resource_id     text,
        expires_at      timestamptz,
        address         text,
        pending_since   timestamptz
    )
    language sql
    stable
    security definer
    set search_path = public
as
$$
    with bounds as (
        select greatest(1, least(coalesce(p_limit, 20), 100)) as lim,
               greatest(60, least(coalesce(p_renew_before_seconds, 7200), 43200)) as renew
    ),
    to_watch as (
        select 'watch'::text as kind, l.id as link_id, l.team_id, l.sheet_id,
               l.connection_id, l.spreadsheet_id,
               null::uuid as channel_row_id, null::text as channel_id,
               null::text as resource_id, null::timestamptz as expires_at,
               null::text as address, null::timestamptz as pending_since,
               coalesce((select max(ch.expires_at) from public.app_sheet_drive_channels ch
                          where ch.link_id = l.id and ch.status = 'active'), l.created_at) as ord
        from public.app_sheet_google_links l
        join public.app_sheets s on s.id = l.sheet_id
        join public.app_google_connections c on c.id = l.connection_id
        cross join bounds b
        where l.auto_sync
          and not s.archived
          and c.enabled
          and c.revoked_at is null
          -- Push is pointless when Cubes never reads from Google.
          and l.direction in ('both', 'pull')
          and not exists (
              select 1 from public.app_sheet_drive_channels ch
               where ch.link_id = l.id
                 and (
                      -- A channel that is live, not about to expire, and aimed
                      -- at the address we would register today.
                      (ch.status = 'active'
                         and ch.expires_at > now() + make_interval(secs => b.renew)
                         and (p_address is null or ch.address is not distinct from p_address))
                      -- A registration already in flight. Ten minutes is far
                      -- longer than the call takes, so a row older than that is
                      -- a crashed attempt and must not block forever.
                   or (ch.status = 'pending' and ch.created_at > now() - interval '10 minutes')
                      -- Backing off after a refusal.
                   or (ch.status = 'failed' and ch.retry_after is not null and ch.retry_after > now())
                 )
          )
        order by ord
        limit (select lim from bounds)
    ),
    to_stop as (
        select 'stop'::text as kind, ch.link_id, ch.team_id, ch.sheet_id,
               ch.connection_id, ch.spreadsheet_id,
               ch.id as channel_row_id, ch.channel_id, ch.resource_id,
               ch.expires_at, ch.address, ch.pending_since,
               ch.expires_at as ord
        from public.app_sheet_drive_channels ch
        where ch.status in ('pending', 'active', 'stopping')
          and ch.resource_id is not null
          and ch.connection_id is not null
          -- An expired channel is already dead at Google; stopping it would
          -- only spend a call to be told 404.
          and ch.expires_at > now()
          and (
                ch.status = 'stopping'
             or ch.link_id is null
             or not exists (
                    select 1
                      from public.app_sheet_google_links l
                      join public.app_sheets s on s.id = l.sheet_id
                     where l.id = ch.link_id
                       and l.auto_sync
                       and not s.archived
                       and l.direction in ('both', 'pull')
                )
          )
        order by ch.expires_at
        limit (select lim from bounds)
    ),
    to_flush as (
        select 'flush'::text as kind, ch.link_id, ch.team_id, ch.sheet_id,
               ch.connection_id, ch.spreadsheet_id,
               ch.id as channel_row_id, ch.channel_id, ch.resource_id,
               ch.expires_at, ch.address, ch.pending_since,
               ch.pending_since as ord
        from public.app_sheet_drive_channels ch
        join public.app_sheet_google_links l on l.id = ch.link_id
        where ch.pending_since is not null
          and ch.status in ('pending', 'active')
          and (l.lease_until is null or l.lease_until < now())
        order by ch.pending_since
        limit (select lim from bounds)
    )
    select kind, link_id, team_id, sheet_id, connection_id, spreadsheet_id,
           channel_row_id, channel_id, resource_id, expires_at, address, pending_since
    from (
        select * from to_watch
        union all select * from to_stop
        union all select * from to_flush
    ) all_work
    order by kind, ord;
$$;

revoke all on function public.app_sheets_watch_worklist(integer, integer, text)
    from public, anon, authenticated;
grant execute on function public.app_sheets_watch_worklist(integer, integer, text)
    to service_role;


-- -----------------------------------------------------------------------------
-- 4. app_sheets_emit_changed — the workflow event
-- -----------------------------------------------------------------------------
-- Emitted after a sync that actually moved rows, so an automation can react to
-- somebody editing the Google Sheet.
--
-- Defensiveness copied verbatim in spirit from
-- the other SQL emitters:
-- the workflow tables may not exist in an install that never enabled workflows,
-- so wf_emit_event is reached through to_regprocedure/to_regclass guards and the
-- whole emit sits in an exception block. A sheet sync must never fail because
-- the alarm is missing.
--
-- wf_emit_event returns null when no enabled workflow listens for the key, which
-- is why this returns a verdict instead of just an id: 'emitted', 'skipped'
-- (nobody listening), 'unavailable' (no event bus) or 'failed'.
create or replace function public.app_sheets_emit_changed(
    p_team_id uuid,
    p_payload jsonb
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _emitter  boolean := to_regprocedure('public.wf_emit_event(uuid, text, jsonb)') is not null;
    _has      boolean := _emitter or to_regclass('public.workflow_events') is not null;
    _payload  jsonb := case when jsonb_typeof(p_payload) = 'object' then p_payload else '{}'::jsonb end;
    _event_id uuid;
begin
    if p_team_id is null then
        return jsonb_build_object('status', 'skipped', 'reason', 'no_team');
    end if;
    if not _has then
        return jsonb_build_object('status', 'unavailable');
    end if;

    begin
        if _emitter then
            execute 'select public.wf_emit_event($1, $2, $3)'
                into _event_id
                using p_team_id, 'sheets.changed', _payload;
        else
            execute 'insert into public.workflow_events (team_id, key, payload)
                     values ($1, $2, $3) returning id'
                into _event_id
                using p_team_id, 'sheets.changed', _payload;
        end if;
    exception when others then
        -- The bus exists but does not take this shape, or the grant is missing.
        -- The sync's job is the rows, not the alarm.
        return jsonb_build_object('status', 'failed');
    end;

    if _event_id is null then
        return jsonb_build_object('status', 'skipped', 'reason', 'no_listener');
    end if;
    return jsonb_build_object('status', 'emitted', 'event_id', _event_id);
end;
$$;

revoke all on function public.app_sheets_emit_changed(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.app_sheets_emit_changed(uuid, jsonb) to service_role;
