-- =============================================================================
-- Attendance Webhook app — inbound punch ingestion for the HR attendance module.
-- =============================================================================
-- Lets external systems (biometric devices, door controllers, Zapier, other HR
-- tools) POST clock punches into Cubes at /api/webhooks/attendance/<id>. Builds
-- on HR-2 (20261002000000): writes hr_attendance via the same first-in /
-- last-out + shift-break semantics as clock_in()/clock_out(), with
-- source='system'.
--
-- Three tables, mirroring the apps-hub metadata/secrets split (20261011000000):
--   * attendance_webhooks        — org-scoped endpoint metadata + a SHA-256
--     token hash (raw token shown once at mint time, the mcp_tokens precedent)
--     + a fully customizable `config` payload mapping (see below). HR admins
--     read/update/delete via RLS; INSERT is service-role only because the token
--     hash must be minted server-side.
--   * attendance_webhook_secrets — the optional HMAC signing secret. RLS with
--     zero policies + revoked grants: service_role only.
--   * attendance_webhook_events  — per-delivery audit log (payload, resolved
--     employee, outcome). HR admins read; writes are service-role only.
--
-- `config` (jsonb, all keys optional — the route applies defaults):
--   employee_match     'employee_code' | 'work_email' | 'employee_id'
--   employee_field     dot-path into each event for the employee key
--   event_field        dot-path for the punch-type value
--   in_values[]        values of event_field meaning clock-IN  (case-insensitive)
--   out_values[]       values of event_field meaning clock-OUT (case-insensitive)
--   default_direction  'auto' | 'in' | 'out' — used when event_field resolves
--                      to nothing ('auto' = first punch of the day is IN)
--   timestamp_field    dot-path for the punch time (ISO 8601 or unix s/ms)
--   events_field       dot-path to an ARRAY of events for batch payloads
--   timezone           IANA zone used to derive the attendance DATE
--   require_signature  boolean — reject unsigned/badly-signed deliveries
--
-- RPC:
--   * attendance_webhook_punch(_employee_id, _at, _direction, _tz) -> uuid —
--     upserts the (employee, date) hr_attendance row: earliest-in / latest-out
--     merge (device punches can arrive out of order or replayed), work_minutes
--     recomputed minus hr_shift_break_minutes. EXECUTE: service_role only.
--
-- Supabase adaptations (as Phases 1-9 / HR / apps-hub):
--   * gen_random_uuid() lives in `extensions`; function bodies pin
--     search_path = public, extensions.
--   * Default privileges auto-grant ALL on new public tables to authenticated +
--     anon — the revokes below are LOAD-BEARING (see 20261011000000).
--
-- Re-runnable: IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS throughout.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Tables
-- =============================================================================

create table if not exists public.attendance_webhooks (
    id               uuid                     default gen_random_uuid() not null,
    org_id           uuid                                               not null,
    name             text                                               not null,
    enabled          boolean                  default true              not null,
    token_prefix     text                                               not null,
    token_hash       text                                               not null,
    config           jsonb                    default '{}'::jsonb       not null,
    received_count   integer                  default 0                 not null,
    last_received_at timestamp with time zone,
    last_error       text,
    created_by       uuid,
    created_at       timestamp with time zone default current_timestamp not null,
    updated_at       timestamp with time zone default current_timestamp not null,
    constraint attendance_webhooks_pk primary key (id),
    constraint attendance_webhooks_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint attendance_webhooks_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint attendance_webhooks_name_check check (char_length(name) <= 200),
    constraint attendance_webhooks_token_prefix_check
        check (char_length(token_prefix) <= 24),
    constraint attendance_webhooks_config_check check (jsonb_typeof(config) = 'object'),
    constraint attendance_webhooks_last_error_check
        check (last_error is null or char_length(last_error) <= 1000),
    constraint attendance_webhooks_token_hash_uindex unique (token_hash)
);

-- Signing secret apart from metadata so authenticated grants never touch it.
create table if not exists public.attendance_webhook_secrets (
    webhook_id     uuid                                               not null,
    signing_secret text,
    updated_at     timestamp with time zone default current_timestamp not null,
    constraint attendance_webhook_secrets_pk primary key (webhook_id),
    constraint attendance_webhook_secrets_webhook_id_fk
        foreign key (webhook_id) references public.attendance_webhooks (id)
            on delete cascade
);

-- Per-delivery audit log. payload is stored truncated by the route (never the
-- raw body of an unauthenticated request). employee SET NULL so the log
-- survives employee deletion.
create table if not exists public.attendance_webhook_events (
    id           uuid                     default gen_random_uuid() not null,
    webhook_id   uuid                                               not null,
    org_id       uuid                                               not null,
    employee_id  uuid,
    employee_key text,
    direction    text,
    outcome      text                                               not null,
    error        text,
    payload      jsonb,
    received_at  timestamp with time zone default current_timestamp not null,
    constraint attendance_webhook_events_pk primary key (id),
    constraint attendance_webhook_events_webhook_id_fk
        foreign key (webhook_id) references public.attendance_webhooks (id)
            on delete cascade,
    constraint attendance_webhook_events_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint attendance_webhook_events_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete set null,
    constraint attendance_webhook_events_direction_check
        check (direction is null or direction in ('in', 'out')),
    constraint attendance_webhook_events_outcome_check
        check (outcome in ('processed', 'ignored', 'error')),
    constraint attendance_webhook_events_error_check
        check (error is null or char_length(error) <= 1000)
);


-- =============================================================================
-- SECTION 2: Indexes
-- =============================================================================
create index if not exists attendance_webhooks_org_id_index
    on public.attendance_webhooks (org_id);

create index if not exists attendance_webhook_events_webhook_id_received_at_index
    on public.attendance_webhook_events (webhook_id, received_at desc);
create index if not exists attendance_webhook_events_org_id_index
    on public.attendance_webhook_events (org_id);


-- =============================================================================
-- SECTION 3: updated_at touch trigger (metadata edits only — not the route's
--            received_count / last_received_at / last_error bookkeeping, so
--            updated_at keeps meaning "definition last changed").
-- =============================================================================
create or replace function public.set_attendance_webhook_updated_at()
    returns trigger
    language plpgsql
as
$$
begin
    if (to_jsonb(new) - 'received_count' - 'last_received_at' - 'last_error'
                      - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'received_count' - 'last_received_at' - 'last_error'
                      - 'updated_at') then
        new.updated_at := current_timestamp;
    end if;
    return new;
end;
$$;

drop trigger if exists attendance_webhooks_set_updated_at on public.attendance_webhooks;
create trigger attendance_webhooks_set_updated_at
    before update on public.attendance_webhooks
    for each row
    execute function public.set_attendance_webhook_updated_at();


-- =============================================================================
-- SECTION 4: Punch RPC (service_role only)
-- =============================================================================
-- Merges a machine punch into the (employee, date) attendance row. Unlike the
-- self-service clock_in()/clock_out() RPCs, punches can arrive out of order or
-- duplicated (device retries), so the merge is time-based, never arrival-based:
-- clock_in = EARLIEST punch seen, clock_out = LATEST seen, work_minutes
-- recomputed whenever both ends exist. _direction 'auto' means "the payload
-- doesn't say": the day's very first punch becomes clock_in; any later distinct
-- punch min/max-merges into BOTH ends (so an 18:00 exit arriving before the
-- 09:00 entry still yields in=09:00/out=18:00); an exact replay is a no-op.
-- Rows HR explicitly corrected (source='regularized') are left untouched — a
-- device replaying the original bad punch must not undo the correction. The
-- attendance DATE is _at rendered in _tz (an org punching from IST must not
-- roll a 23:30 local punch onto the next UTC day); _tz is sanitized by the
-- receiver (resolveAttendanceWebhookConfig), an unknown zone still raises here.
create or replace function public.attendance_webhook_punch(
    _employee_id uuid,
    _at          timestamp with time zone,
    _direction   text,
    _tz          text default 'UTC'
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _org_id  uuid;
    _date    date;
    _dir     text := _direction;
    _att_id  uuid;
    _in      timestamp with time zone;
    _out     timestamp with time zone;
    _source  text;
    _break   integer;
    _minutes integer;
begin
    if _dir not in ('in', 'out', 'auto') then
        raise exception 'attendance_webhook_punch: invalid direction %', _direction;
    end if;

    select org_id into _org_id
    from public.hr_employees
    where id = _employee_id;

    if _org_id is null then
        raise exception 'attendance_webhook_punch: employee % not found', _employee_id;
    end if;

    _date := (_at at time zone _tz)::date;

    -- Ensure the day row exists, then lock it for the merge.
    insert into public.hr_attendance (employee_id, org_id, date, status, source)
    values (_employee_id, _org_id, _date, 'present', 'system')
    on conflict (employee_id, date) do nothing;

    select id, clock_in, clock_out, source into _att_id, _in, _out, _source
    from public.hr_attendance
    where employee_id = _employee_id and date = _date
    for update;

    -- HR corrected this day by hand; machine punches must not reopen it.
    if _source = 'regularized' then
        return _att_id;
    end if;

    if _dir = 'auto' then
        if _in is null and _out is null then
            _in := _at;
        elsif _at is distinct from _in and _at is distinct from _out then
            -- Two or more distinct punches: earliest → in, latest → out.
            -- _out first — it needs the PRE-merge _in as the other candidate.
            _out := greatest(coalesce(_out, _in), _at);
            _in  := least(coalesce(_in, _at), _at);
        end if; -- exact replay of a recorded punch: no-op
    elsif _dir = 'in' then
        _in := least(coalesce(_in, _at), _at);
    else
        _out := greatest(coalesce(_out, _at), _at);
    end if;

    if _in is not null and _out is not null and _out >= _in then
        _break   := coalesce(public.hr_shift_break_minutes(_employee_id, _date), 0);
        _minutes := greatest(0, round(extract(epoch from (_out - _in)) / 60.0)::integer - _break);
    else
        _minutes := null;
    end if;

    update public.hr_attendance
        set clock_in     = _in,
            clock_out    = _out,
            status       = 'present',
            work_minutes = _minutes,
            source       = 'system'
        where id = _att_id;

    return _att_id;
end;
$$;

-- Atomic delivery bookkeeping. supabase-js cannot express column-relative
-- updates, and a read-modify-write from the route loses counts when two
-- deliveries overlap — so the increment lives here.
create or replace function public.attendance_webhook_touch(
    _webhook_id uuid,
    _events     integer,
    _error      text default null
)
    returns void
    language sql
    security definer
    set search_path = public, extensions
as
$$
    update public.attendance_webhooks
        set received_count   = received_count + greatest(_events, 0),
            last_received_at = now(),
            last_error       = left(_error, 1000)
        where id = _webhook_id;
$$;


-- =============================================================================
-- SECTION 5: Row Level Security
-- =============================================================================
alter table public.attendance_webhooks        enable row level security;
alter table public.attendance_webhook_secrets enable row level security;
alter table public.attendance_webhook_events  enable row level security;

-- attendance_webhooks: HR admins read/update/delete. NO insert policy — rows
-- are minted by the management route (service_role) because the token hash is
-- generated server-side.
drop policy if exists attendance_webhooks_select on public.attendance_webhooks;
create policy attendance_webhooks_select on public.attendance_webhooks
    for select to authenticated
    using (public.is_hr_admin(org_id));

drop policy if exists attendance_webhooks_update on public.attendance_webhooks;
create policy attendance_webhooks_update on public.attendance_webhooks
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists attendance_webhooks_delete on public.attendance_webhooks;
create policy attendance_webhooks_delete on public.attendance_webhooks
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- attendance_webhook_secrets: NO authenticated policies on purpose (RLS enabled
-- with zero policies + revoked grants = service_role only).

-- attendance_webhook_events: HR admins read; no authenticated writes.
drop policy if exists attendance_webhook_events_select on public.attendance_webhook_events;
create policy attendance_webhook_events_select on public.attendance_webhook_events
    for select to authenticated
    using (public.is_hr_admin(org_id));


-- =============================================================================
-- SECTION 6: Grants
-- =============================================================================
-- Strip the auto-granted default privileges first (load-bearing — see the
-- apps-hub migration), then grant back exactly what each role needs.
revoke all on public.attendance_webhooks        from authenticated, anon;
revoke all on public.attendance_webhook_secrets from authenticated, anon;
revoke all on public.attendance_webhook_events  from authenticated, anon;

grant select, update, delete on public.attendance_webhooks       to authenticated;
grant select                 on public.attendance_webhook_events to authenticated;

grant all on public.attendance_webhooks        to service_role;
grant all on public.attendance_webhook_secrets to service_role;
grant all on public.attendance_webhook_events  to service_role;

-- Punch/touch RPCs: machine path only — never callable with a user session.
revoke execute on function public.attendance_webhook_punch(uuid, timestamptz, text, text)
    from public, anon, authenticated;
grant execute on function public.attendance_webhook_punch(uuid, timestamptz, text, text)
    to service_role;
revoke execute on function public.attendance_webhook_touch(uuid, integer, text)
    from public, anon, authenticated;
grant execute on function public.attendance_webhook_touch(uuid, integer, text)
    to service_role;

-- =============================================================================
-- END Attendance Webhook
-- =============================================================================
