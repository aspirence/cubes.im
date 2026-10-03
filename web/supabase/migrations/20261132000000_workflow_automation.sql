-- =============================================================================
-- Workflows, Pabbly-style: filters that skip, webhook triggers, sample data,
-- routers, delays, an outbound HTTP step, retries/replay/retention and an
-- event bus.
-- =============================================================================
-- Phase C left the engine linear: one condition that halted the whole run, no
-- way in from the outside, no branching, no waiting, no second attempt. This
-- migration turns it into something a person can actually automate with, in
-- the order of docs/AUTOMATION_CLIENT.md Part 2:
--
--  2.1 condition steps gain {mode, match, rules[]}: a false 'filter' skips the
--      step and the run carries on, a false 'stop' ends the run as it does
--      today. Old single-rule configs keep working untouched.
--  2.2 workflow_webhooks + workflow_webhook_events: an opaque per-workflow URL
--      (POST /api/hooks/[token]) with capture mode, an optional HMAC and a
--      dedupe ledger.
--  2.3 workflows.trigger_sample + workflow_steps.sample_output: the payloads
--      the builder's field picker is drawn from.
--  2.4 A 'router' step (one level, at most five routes) plus branch_key /
--      parent_step_id on workflow_steps, so the executor can skip the branches
--      that were not taken.
--  2.5 A 'delay' step: the run parks in 'waiting_delay' with resume_at, and
--      wf_claim_resumable (called from the runner's tick) wakes it.
--  2.6 team_http_allowlist: the hosts an 'http' step of that team may call.
--      The guard itself is in Node (src/lib/workflows/http-step.ts) because
--      only Node can resolve a hostname and refuse a private address.
--  2.7 workflow_step_runs.attempt + workflow_runs.next_attempt_at (retries),
--      trigger_payload + replay_of (replay), expires_at (retention) and
--      task_count (only app/http steps cost a task, exactly as Pabbly counts).
--  2.8 workflow_events + workflow_event_deliveries: SECURITY DEFINER emitters
--      write an event, the tick starts one run per matching workflow, and the
--      unique (event_id, workflow_id) makes that exactly once.
--
-- advance_workflow_run is copied from 20261128000000 and extended; every
-- existing branch behaves exactly as before. Re-runnable and purely additive.

-- =============================================================================
-- SECTION 0: Columns and CHECK constraints
-- =============================================================================

-- 'webhook' joins manual/schedule/event as a way in.
alter table public.workflows drop constraint if exists workflows_trigger_type_check;
alter table public.workflows add constraint workflows_trigger_type_check
    check (trigger_type in ('manual', 'schedule', 'event', 'webhook'));

-- The payload the builder's field picker is drawn from: the last captured
-- webhook event, a pasted sample, or a schedule's {fired_at}.
alter table public.workflows add column if not exists trigger_sample jsonb;

-- 'router' branches, 'delay' waits, 'http' calls out, 'format' reshapes text.
alter table public.workflow_steps drop constraint if exists workflow_steps_step_type_check;
alter table public.workflow_steps add constraint workflow_steps_step_type_check
    check (step_type in ('agent', 'condition', 'action', 'app', 'human', 'ai',
                         'router', 'delay', 'http', 'format'));

-- A step that belongs to one branch of a router. parent_step_id is the router;
-- branch_key is which of its routes this step is under. Both null = a normal
-- top-level step, which is every step that exists today.
alter table public.workflow_steps add column if not exists parent_step_id uuid;
alter table public.workflow_steps add column if not exists branch_key text;
alter table public.workflow_steps add column if not exists sample_output jsonb;
do $$
begin
    alter table public.workflow_steps add constraint workflow_steps_parent_step_id_fk
        foreign key (parent_step_id) references public.workflow_steps (id) on delete cascade;
exception
    when duplicate_object then null;
end $$;
alter table public.workflow_steps drop constraint if exists workflow_steps_branch_check;
alter table public.workflow_steps add constraint workflow_steps_branch_check
    check (branch_key is null or (parent_step_id is not null and char_length(branch_key) between 1 and 60));
create index if not exists workflow_steps_parent_step_id_index
    on public.workflow_steps (parent_step_id) where parent_step_id is not null;

-- 'waiting_delay' = parked on a delay step until resume_at passes.
alter table public.workflow_runs drop constraint if exists workflow_runs_status_check;
alter table public.workflow_runs add constraint workflow_runs_status_check
    check (status in ('running', 'waiting_human', 'waiting_app', 'waiting_delay',
                      'success', 'error', 'stopped'));

alter table public.workflow_runs add column if not exists resume_at timestamp with time zone;
alter table public.workflow_runs add column if not exists next_attempt_at timestamp with time zone;
-- The raw body the run was started from, kept apart from trigger_snapshot (the
-- engine's own metadata) because replay must resend exactly what arrived.
alter table public.workflow_runs add column if not exists trigger_payload jsonb;
alter table public.workflow_runs add column if not exists replay_of uuid;
do $$
begin
    alter table public.workflow_runs add constraint workflow_runs_replay_of_fk
        foreign key (replay_of) references public.workflow_runs (id) on delete set null;
exception
    when duplicate_object then null;
end $$;
-- Run history is swept by wf_sweep_runs from inside the tick; step runs cascade.
alter table public.workflow_runs add column if not exists expires_at timestamp with time zone
    not null default (now() + interval '30 days');
-- Only app and http steps cost a task. Logic steps (filter, router, delay,
-- format) are free, which is both Pabbly's pricing promise and a design
-- constraint: a free step must be cheap enough to run in-process.
alter table public.workflow_runs add column if not exists task_count integer not null default 0;

create index if not exists workflow_runs_resume_at_index
    on public.workflow_runs (resume_at) where status = 'waiting_delay';
create index if not exists workflow_runs_expires_at_index
    on public.workflow_runs (expires_at);

-- Which attempt of this step produced this row. 1 for everything that ran
-- before retries existed.
alter table public.workflow_step_runs add column if not exists attempt integer not null default 1;
alter table public.workflow_step_runs drop constraint if exists workflow_step_runs_attempt_check;
alter table public.workflow_step_runs add constraint workflow_step_runs_attempt_check
    check (attempt between 1 and 10);

-- =============================================================================
-- SECTION 1: Webhook triggers (2.2)
-- =============================================================================

-- One inbound URL per workflow. The token is the whole secret in the URL, so
-- it is 32 random bytes rendered base64url — unguessable, and nothing about
-- the workspace is encoded in it (Zapier encodes the owner's id and then has
-- to re-key on transfer; we never have to).
create table if not exists public.workflow_webhooks (
    id             uuid                     default gen_random_uuid() not null,
    workflow_id    uuid                                               not null,
    team_id        uuid                                               not null,
    token          text
        default translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_')
        not null,
    -- Optional HMAC-SHA256 of the raw body, compared against x-cubes-signature.
    -- Service-role only: it never leaves the server (see the grants below).
    signing_secret text,
    -- true = store the request and do NOT run the workflow. This is the
    -- builder's "waiting for a request…" state: the first request becomes the
    -- trigger sample the field picker is built from.
    capture_mode   boolean                  default true              not null,
    -- Dot-path into the payload whose value must be unique, e.g. "data.id".
    dedupe_path    text,
    enabled        boolean                  default true              not null,
    last_event_at  timestamp with time zone,
    created_by     uuid,
    created_at     timestamp with time zone default current_timestamp not null,
    updated_at     timestamp with time zone default current_timestamp not null,
    constraint workflow_webhooks_pk primary key (id),
    constraint workflow_webhooks_workflow_id_unique unique (workflow_id),
    constraint workflow_webhooks_token_unique unique (token),
    constraint workflow_webhooks_workflow_id_fk foreign key (workflow_id)
        references public.workflows (id) on delete cascade,
    constraint workflow_webhooks_team_id_fk foreign key (team_id)
        references public.teams (id) on delete cascade,
    constraint workflow_webhooks_created_by_fk foreign key (created_by)
        references public.users (id) on delete set null,
    constraint workflow_webhooks_token_check check (char_length(token) between 16 and 128),
    constraint workflow_webhooks_dedupe_path_check
        check (dedupe_path is null or dedupe_path ~ '^[A-Za-z0-9_][A-Za-z0-9_.]{0,200}$')
);
create index if not exists workflow_webhooks_team_id_index
    on public.workflow_webhooks (team_id);

-- The capture buffer, the replay source and the dedupe ledger in one table.
create table if not exists public.workflow_webhook_events (
    id          uuid                     default gen_random_uuid() not null,
    webhook_id  uuid                                               not null,
    team_id     uuid                                               not null,
    headers     jsonb                    default '{}'::jsonb       not null,
    payload     jsonb                    default '{}'::jsonb       not null,
    dedupe_key  text,
    run_id      uuid,
    status      text                                               not null,
    error       text,
    received_at timestamp with time zone default current_timestamp not null,
    constraint workflow_webhook_events_pk primary key (id),
    constraint workflow_webhook_events_webhook_id_fk foreign key (webhook_id)
        references public.workflow_webhooks (id) on delete cascade,
    constraint workflow_webhook_events_team_id_fk foreign key (team_id)
        references public.teams (id) on delete cascade,
    constraint workflow_webhook_events_run_id_fk foreign key (run_id)
        references public.workflow_runs (id) on delete set null,
    constraint workflow_webhook_events_status_check
        check (status in ('captured', 'queued', 'ran', 'duplicate', 'error')),
    constraint workflow_webhook_events_error_check
        check (error is null or char_length(error) <= 1000)
);
create index if not exists workflow_webhook_events_webhook_id_index
    on public.workflow_webhook_events (webhook_id, received_at desc);
-- Partial unique: only events that carry a dedupe key are deduped, so a
-- webhook without dedupe_path can receive the same body a thousand times.
create unique index if not exists workflow_webhook_events_dedupe_unique
    on public.workflow_webhook_events (webhook_id, dedupe_key) where dedupe_key is not null;

drop trigger if exists workflow_webhooks_updated_at on public.workflow_webhooks;
create trigger workflow_webhooks_updated_at
    before update on public.workflow_webhooks
    for each row execute function public.set_row_updated_at();

-- =============================================================================
-- SECTION 2: The per-team HTTP allowlist (2.6)
-- =============================================================================

-- An http step may only call a host an admin of that team has put here. The
-- SSRF guard (private / loopback / link-local addresses) is enforced in Node,
-- where the hostname can actually be resolved; this table is the policy half.
create table if not exists public.team_http_allowlist (
    team_id    uuid                                               not null,
    host       text                                               not null,
    note       text,
    created_by uuid,
    created_at timestamp with time zone default current_timestamp not null,
    constraint team_http_allowlist_pk primary key (team_id, host),
    constraint team_http_allowlist_team_id_fk foreign key (team_id)
        references public.teams (id) on delete cascade,
    constraint team_http_allowlist_created_by_fk foreign key (created_by)
        references public.users (id) on delete set null,
    -- Lowercase hostnames only: no scheme, no port, no path, no wildcard. A
    -- subdomain is allowed through by suffix match in the guard, so "acme.com"
    -- covers "api.acme.com" but never "notacme.com".
    constraint team_http_allowlist_host_check
        check (host = lower(host) and host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
               and char_length(host) <= 253),
    constraint team_http_allowlist_note_check check (note is null or char_length(note) <= 300)
);

-- =============================================================================
-- SECTION 3: The event bus (2.8)
-- =============================================================================

-- What the Client app, Sheets and CRM emit. Rows are written by SECURITY
-- DEFINER emitters (wf_emit_event) and consumed by the tick, oldest first.
create table if not exists public.workflow_events (
    id          uuid                     default gen_random_uuid() not null,
    team_id     uuid                                               not null,
    key         text                                               not null,
    payload     jsonb                    default '{}'::jsonb       not null,
    consumed_at timestamp with time zone,
    created_at  timestamp with time zone default current_timestamp not null,
    constraint workflow_events_pk primary key (id),
    constraint workflow_events_team_id_fk foreign key (team_id)
        references public.teams (id) on delete cascade,
    constraint workflow_events_key_check check (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
    constraint workflow_events_payload_check check (jsonb_typeof(payload) = 'object')
);
-- The dispatcher's working set: unconsumed events, oldest first.
create index if not exists workflow_events_pending_index
    on public.workflow_events (created_at) where consumed_at is null;
create index if not exists workflow_events_team_key_index
    on public.workflow_events (team_id, key, created_at desc);

-- One row per (event, workflow): the unique constraint is what makes dispatch
-- exactly-once even if two ticks overlap.
create table if not exists public.workflow_event_deliveries (
    event_id    uuid                                               not null,
    workflow_id uuid                                               not null,
    run_id      uuid,
    created_at  timestamp with time zone default current_timestamp not null,
    constraint workflow_event_deliveries_pk primary key (event_id, workflow_id),
    constraint workflow_event_deliveries_event_id_fk foreign key (event_id)
        references public.workflow_events (id) on delete cascade,
    constraint workflow_event_deliveries_workflow_id_fk foreign key (workflow_id)
        references public.workflows (id) on delete cascade,
    constraint workflow_event_deliveries_run_id_fk foreign key (run_id)
        references public.workflow_runs (id) on delete set null
);

-- =============================================================================
-- SECTION 4: Condition rules — filters that skip (2.1)
-- =============================================================================

-- One {left, op, right} comparison. left/right are interpolated against the
-- run context first, so both sides may be tokens. The numeric branch is the
-- one wf_eval_condition has always used (finite decimals only, so 'NaN' and
-- 'Infinity' stay text); the string ops are new.
create or replace function public.wf_eval_rule(_context jsonb, _rule jsonb)
    returns boolean language plpgsql immutable as
$$
declare
    _op    text := coalesce(_rule ->> 'op', '=');
    _left  text := public.wf_interpolate(coalesce(_rule ->> 'left', ''), _context);
    _right text := public.wf_interpolate(coalesce(_rule ->> 'right', ''), _context);
    _num_re constant text := '^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$';
    _isnum boolean;
    _ln    numeric;
    _rn    numeric;
begin
    -- Emptiness is about the left side alone; it must be decided before the
    -- numeric branch, or "is_empty" against a blank right side would compare
    -- '' to '' as text and accidentally work for the wrong reason.
    if _op = 'is_empty' then
        return coalesce(_left, '') = '';
    elsif _op = 'is_not_empty' then
        return coalesce(_left, '') <> '';
    elsif _op = 'contains' then
        return position(lower(_right) in lower(coalesce(_left, ''))) > 0;
    elsif _op = 'not_contains' then
        return position(lower(_right) in lower(coalesce(_left, ''))) = 0;
    elsif _op = 'starts_with' then
        return lower(coalesce(_left, '')) like lower(_right) || '%';
    elsif _op = 'ends_with' then
        return lower(coalesce(_left, '')) like '%' || lower(_right);
    end if;

    _isnum := (_left ~ _num_re) and (_right ~ _num_re);
    if _isnum then
        _ln := _left::numeric;
        _rn := _right::numeric;
        return case _op
            when '=' then _ln = _rn when '!=' then _ln <> _rn
            when '>' then _ln > _rn when '>=' then _ln >= _rn
            when '<' then _ln < _rn when '<=' then _ln <= _rn
            else false end;
    else
        return case _op
            when '=' then _left = _right
            when '!=' then _left <> _right
            else false end;
    end if;
end;
$$;

-- match = 'all' (AND) or 'any' (OR) over rules[]. No rules at all means "let
-- everything through", which is what an empty filter should obviously do.
create or replace function public.wf_match_rules(_context jsonb, _match text, _rules jsonb)
    returns boolean language plpgsql immutable as
$$
declare
    _rule jsonb;
    _any  boolean := false;
    _n    integer := 0;
begin
    if _rules is null or jsonb_typeof(_rules) <> 'array' or jsonb_array_length(_rules) = 0 then
        return true;
    end if;
    for _rule in select * from jsonb_array_elements(_rules)
    loop
        _n := _n + 1;
        if public.wf_eval_rule(_context, _rule) then
            _any := true;
        elsif coalesce(_match, 'all') <> 'any' then
            return false;
        end if;
    end loop;
    if coalesce(_match, 'all') = 'any' then
        return _any;
    end if;
    return true;
end;
$$;

-- The condition step's config, in both shapes:
--   new: {mode, match: 'all'|'any', rules: [{left, op, right}, ...]}
--   old: {left, op, right}                       (one rule, mode 'stop')
-- Same signature and same answer for every config that existed before, so the
-- rows already in workflow_steps keep evaluating exactly as they did.
create or replace function public.wf_eval_condition(_context jsonb, _cfg jsonb)
    returns boolean language plpgsql immutable as
$$
begin
    if _cfg is null or jsonb_typeof(_cfg) <> 'object' then
        return false;
    end if;
    if jsonb_typeof(_cfg -> 'rules') = 'array' then
        return public.wf_match_rules(_context, _cfg ->> 'match', _cfg -> 'rules');
    end if;
    return public.wf_eval_rule(_context, _cfg);
end;
$$;

-- =============================================================================
-- SECTION 5: Small helpers the executor needs
-- =============================================================================

-- A format step's one operation, over an already-interpolated text value.
-- Pure, in-SQL and therefore free (it never costs a task).
create or replace function public.wf_format_value(_op text, _value text, _cfg jsonb)
    returns jsonb language plpgsql immutable as
$$
declare
    _v text := coalesce(_value, '');
    _n numeric;
begin
    case coalesce(_op, 'trim')
        when 'uppercase'   then return to_jsonb(upper(_v));
        when 'lowercase'   then return to_jsonb(lower(_v));
        when 'trim'        then return to_jsonb(btrim(_v));
        when 'title'       then return to_jsonb(initcap(_v));
        when 'replace'     then return to_jsonb(replace(_v, coalesce(_cfg ->> 'find', ''),
                                                             coalesce(_cfg ->> 'with', '')));
        when 'split'       then return to_jsonb(split_part(_v,
                                    coalesce(nullif(_cfg ->> 'separator', ''), ','),
                                    greatest(coalesce((_cfg ->> 'index')::integer, 1), 1)));
        when 'default'     then return to_jsonb(case when _v = '' then coalesce(_cfg ->> 'fallback', '') else _v end);
        when 'number'      then
            if _v !~ '^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$' then
                raise exception 'format: "%" is not a number', left(_v, 60);
            end if;
            _n := _v::numeric;
            if (_cfg ->> 'decimals') ~ '^\d+$' then
                _n := round(_n, least((_cfg ->> 'decimals')::integer, 10));
            end if;
            return to_jsonb(_n);
        when 'date_format' then
            return to_jsonb(to_char(
                _v::timestamptz at time zone public.recurrence_timezone(_cfg ->> 'timezone'),
                coalesce(nullif(_cfg ->> 'format', ''), 'YYYY-MM-DD')));
        else
            raise exception 'format: unknown operation "%"', coalesce(_op, '(null)');
    end case;
end;
$$;

-- How long a delay step waits, as an interval, from a config of either shape:
--   {for: {minutes|hours|days: n}}   or   {until: '<timestamp or token>'}
-- Capped at 30 days; a negative or unparseable wait is zero, i.e. no wait.
create or replace function public.wf_delay_until(_context jsonb, _cfg jsonb)
    returns timestamptz language plpgsql stable as
$$
declare
    _for   jsonb := _cfg -> 'for';
    _until text;
    _mins  numeric := 0;
    _at    timestamptz;
begin
    if jsonb_typeof(_for) = 'object' then
        _mins := coalesce((_for ->> 'minutes')::numeric, 0)
               + coalesce((_for ->> 'hours')::numeric, 0) * 60
               + coalesce((_for ->> 'days')::numeric, 0) * 1440;
        _at := now() + make_interval(mins => least(greatest(_mins, 0), 43200)::integer);
        return _at;
    end if;

    _until := btrim(public.wf_interpolate(coalesce(_cfg ->> 'until', ''), _context));
    if _until = '' then
        raise exception 'delay step has neither a duration nor an "until" time';
    end if;
    begin
        _at := _until::timestamptz;
    exception when others then
        raise exception 'delay: "%" is not a time I can read', left(_until, 60);
    end;
    -- A time already in the past means "carry on now", not "fail".
    if _at <= now() then
        return now();
    end if;
    return least(_at, now() + interval '30 days');
end;
$$;

-- =============================================================================
-- SECTION 6: The executor
-- =============================================================================
-- Copied from 20261128000000 and extended. Unchanged: agent, action
-- (notify_user / create_task), the app park, the human/ai raise, the
-- per-step exception handler and the final 'success'. New: branch skipping,
-- filter mode, router, delay, http (parks like app), format, and task_count.

create or replace function public.advance_workflow_run(p_run_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _run     public.workflow_runs;
    _team_id uuid;
    _org_id  uuid;
    _step    public.workflow_steps;
    _sr_id   uuid;
    _ctx     jsonb;
    _output  jsonb;
    _agent   public.agents;
    _skill   jsonb;
    _passed  boolean;
    _cfg     jsonb;
    _action  text;
    _msg     text;
    _uid     uuid;
    _new_id  uuid;
    _actor   uuid;
    _mode    text;
    _parent  text;
    _route   text;
    _routes  jsonb;
    _r       jsonb;
    _hit     text;
    _has_fb  boolean;
    _resume  timestamptz;
begin
    select * into _run from public.workflow_runs where id = p_run_id for update;
    if not found or _run.status <> 'running' then
        return;
    end if;
    _team_id := _run.team_id;

    -- The run's acting member, pinned on the first pass. "Run now" arrives with
    -- a session; the passes that follow an app step (wf_resume_app_step, run by
    -- the service-role runner) and every scheduled run have none, and steps that
    -- authorize a person would otherwise fail with "no authenticated user".
    if auth.uid() is not null and _run.actor_user_id is null then
        update public.workflow_runs set actor_user_id = auth.uid() where id = _run.id;
        _run.actor_user_id := auth.uid();
    end if;
    select organization_id into _org_id from public.teams where id = _team_id;
    _ctx := _run.context;
    -- jsonb_set cannot create a missing intermediate key, so guarantee the
    -- `steps` container exists before merging any steps.<key> output into it.
    if not (_ctx ? 'steps') then
        _ctx := _ctx || jsonb_build_object('steps', '{}'::jsonb);
    end if;
    -- The trigger's own payload is addressable as {{trigger.…}} from the first
    -- step onward — that is the whole point of capturing a webhook body.
    if _run.trigger_payload is not null and not (_ctx ? 'trigger') then
        _ctx := _ctx || jsonb_build_object('trigger', _run.trigger_payload);
        update public.workflow_runs set context = _ctx where id = _run.id;
    end if;

    for _step in
        select * from public.workflow_steps
         where workflow_id = _run.workflow_id
           and enabled
           and position > _run.current_position
         order by position, id
    loop
        -- Branch skipping (2.4). A step under a router runs only when that
        -- router picked its branch. A router that never ran — because the run
        -- started past it, or it ended the run — leaves every child skipped.
        if _step.parent_step_id is not null then
            select step_key into _parent from public.workflow_steps where id = _step.parent_step_id;
            _route := _ctx #>> array['_routes', coalesce(_parent, '')];
            if _route is null or _route is distinct from _step.branch_key then
                insert into public.workflow_step_runs
                    (run_id, step_id, step_key, step_type, status, input, output, finished_at)
                values (_run.id, _step.id, _step.step_key, _step.step_type, 'skipped',
                        _step.config,
                        jsonb_build_object('skipped', true, 'reason', 'branch_not_taken'),
                        clock_timestamp());
                update public.workflow_runs set current_position = _step.position where id = _run.id;
                continue;
            end if;
        end if;

        insert into public.workflow_step_runs (run_id, step_id, step_key, step_type, status)
        values (_run.id, _step.id, _step.step_key, _step.step_type, 'running')
        returning id into _sr_id;

        update public.workflow_step_runs set input = _step.config where id = _sr_id;

        begin
            _cfg := _step.config;
            _output := '{}'::jsonb;

            if _step.step_type = 'agent' then
                select * into _agent from public.agents
                 where id = (_cfg ->> 'agent_id')::uuid and team_id = _team_id;
                if not found then
                    raise exception 'agent not found or not in this team';
                end if;
                for _skill in select * from jsonb_array_elements(_agent.skills)
                loop
                    _output := _output || jsonb_build_object(
                        _skill ->> 'skill',
                        public.wf_run_skill(
                            _skill ->> 'skill', _team_id, _org_id,
                            coalesce(_skill -> 'params', '{}'::jsonb)));
                end loop;

            elsif _step.step_type = 'condition' then
                _passed := public.wf_eval_condition(_ctx, _cfg);
                _mode := coalesce(nullif(_cfg ->> 'mode', ''), 'stop');
                _output := jsonb_build_object('passed', _passed);
                if not _passed and _mode = 'filter' then
                    -- A filter skips ITS OWN step and the run carries on. This
                    -- is the Pabbly behaviour: the gate belongs to the branch
                    -- under it, not to the whole automation.
                    _output := _output || jsonb_build_object('skipped', true);
                    update public.workflow_step_runs
                       set status = 'skipped', output = _output, finished_at = clock_timestamp()
                     where id = _sr_id;
                    _ctx := jsonb_set(_ctx, array['steps', _step.step_key], _output, true);
                    update public.workflow_runs
                       set context = _ctx, current_position = _step.position
                     where id = _run.id;
                    continue;
                elsif not _passed then
                    -- Linear stop: the run completes successfully, gated here.
                    update public.workflow_step_runs
                       set status = 'success', output = _output, finished_at = clock_timestamp()
                     where id = _sr_id;
                    _ctx := jsonb_set(_ctx, array['steps', _step.step_key], _output, true);
                    _ctx := _ctx || jsonb_build_object(
                        '_stopped_at', _step.step_key, '_stop_reason', 'condition');
                    update public.workflow_runs
                       set status = 'success', context = _ctx,
                           current_position = _step.position, finished_at = now()
                     where id = _run.id;
                    return;
                end if;

            elsif _step.step_type = 'router' then
                -- One level only: a router inside a branch would need a step
                -- graph, and v1 deliberately keeps a flat ordered list.
                if _step.parent_step_id is not null then
                    raise exception 'a router cannot sit inside another router''s branch';
                end if;
                _routes := _cfg -> 'routes';
                if jsonb_typeof(_routes) <> 'array' or jsonb_array_length(_routes) = 0 then
                    raise exception 'router step has no routes';
                end if;
                if jsonb_array_length(_routes) > 5 then
                    raise exception 'a router can have at most 5 routes';
                end if;
                _hit := null;
                _has_fb := false;
                for _r in select * from jsonb_array_elements(_routes)
                loop
                    if coalesce(_r ->> 'key', '') = '' then
                        raise exception 'every route needs a key';
                    end if;
                    if _r ->> 'key' = 'fallback' then
                        _has_fb := true;
                    end if;
                    if _hit is null and _r ->> 'key' <> 'fallback'
                       and public.wf_match_rules(_ctx, _r ->> 'match', _r -> 'rules') then
                        _hit := _r ->> 'key';
                    end if;
                end loop;
                if _hit is null and _has_fb then
                    _hit := 'fallback';
                end if;
                if _hit is null then
                    -- Nothing matched and there is no fallback: the run is over,
                    -- and successfully so — nothing went wrong, the data simply
                    -- did not belong in any branch.
                    _output := jsonb_build_object('route', null, 'matched', false);
                    update public.workflow_step_runs
                       set status = 'success', output = _output, finished_at = clock_timestamp()
                     where id = _sr_id;
                    _ctx := jsonb_set(_ctx, array['steps', _step.step_key], _output, true);
                    _ctx := _ctx || jsonb_build_object(
                        '_stopped_at', _step.step_key, '_stop_reason', 'no_route');
                    update public.workflow_runs
                       set status = 'success', context = _ctx,
                           current_position = _step.position, finished_at = now()
                     where id = _run.id;
                    return;
                end if;
                if not (_ctx ? '_routes') then
                    _ctx := _ctx || jsonb_build_object('_routes', '{}'::jsonb);
                end if;
                _ctx := jsonb_set(_ctx,
                    array['_routes', _step.step_key], to_jsonb(_hit), true);
                _output := jsonb_build_object('route', _hit, 'matched', true);

            elsif _step.step_type = 'delay' then
                _resume := public.wf_delay_until(_ctx, _cfg);
                if _resume <= now() then
                    -- Nothing to wait for; record it and carry straight on
                    -- rather than parking for zero seconds.
                    _output := jsonb_build_object('waited_seconds', 0, 'resumed_at', now());
                else
                    _ctx := _ctx || jsonb_build_object(
                        '_waiting_step_run', _sr_id, '_waiting_position', _step.position);
                    update public.workflow_runs
                       set status = 'waiting_delay', context = _ctx, resume_at = _resume
                     where id = _run.id;
                    return;
                end if;

            elsif _step.step_type = 'format' then
                _output := jsonb_build_object('value', public.wf_format_value(
                    _cfg ->> 'op',
                    public.wf_interpolate(coalesce(_cfg ->> 'value', ''), _ctx),
                    _cfg));

            elsif _step.step_type = 'action' then
                _action := _cfg ->> 'action';
                if _action = 'notify_user' then
                    _uid := (_cfg ->> 'user_id')::uuid;
                    -- The recipient must be an active member of the run's team,
                    -- else a workflow could deliver interpolated org/HR data to an
                    -- outsider who has no RLS access to it.
                    if _uid is null or not exists (
                        select 1 from public.team_members tm
                        where tm.team_id = _team_id and tm.user_id = _uid
                          and coalesce(tm.active, true) = true
                    ) then
                        raise exception 'notify_user: recipient is not an active member of this team';
                    end if;
                    _msg := public.wf_interpolate(
                        coalesce(nullif(trim(_cfg ->> 'message'), ''),
                                 'Workflow notification'), _ctx);
                    perform public.create_notification(
                        p_user_id => _uid, p_message => _msg,
                        p_type => 'info', p_url => nullif(_cfg ->> 'url', ''),
                        p_team_id => _team_id);
                    _output := jsonb_build_object('notified', _uid);
                elsif _action = 'create_task' then
                    -- create_task RPC is itself is_project_team_member-gated on
                    -- auth.uid(), so cross-tenant creation raises inside it.
                    -- With no session (scheduled run, or a run the Node runner
                    -- resumed after an app step) the run acts as the member who
                    -- started it, else as the workflow's creator: the claim is
                    -- set only around this one call, so create_task's own checks
                    -- still decide, and the run can never do more than that
                    -- person could. Without such a person the step fails loudly.
                    if auth.uid() is not null then
                        _new_id := public.create_task(
                            public.wf_interpolate(coalesce(_cfg ->> 'name', 'Task'), _ctx),
                            (_cfg ->> 'project_id')::uuid);
                    else
                        _actor := coalesce(
                            _run.actor_user_id,
                            (select w.created_by from public.workflows w where w.id = _run.workflow_id));
                        if _actor is null then
                            raise exception 'create_task: this workflow has no owner to create the task as';
                        end if;
                        if not exists (
                            select 1 from public.team_members tm
                             where tm.team_id = _team_id and tm.user_id = _actor
                               and coalesce(tm.active, true) = true
                        ) then
                            raise exception 'create_task: the workflow owner is no longer a member of this team';
                        end if;
                        perform set_config('request.jwt.claim.sub', _actor::text, true);
                        _new_id := public.create_task(
                            public.wf_interpolate(coalesce(_cfg ->> 'name', 'Task'), _ctx),
                            (_cfg ->> 'project_id')::uuid);
                        perform set_config('request.jwt.claim.sub', '', true);
                    end if;
                    _output := jsonb_build_object('task_id', _new_id);
                else
                    -- 'add_comment' was removed: a raw SECURITY DEFINER insert into
                    -- task_comments bypassed is_task_member and allowed cross-tenant
                    -- writes. Re-add only via a gated RPC + a registry entry.
                    raise exception 'unknown action %', coalesce(_action, '(null)');
                end if;

            elsif _step.step_type in ('app', 'http') then
                -- App and http steps need the network, which SQL cannot reach,
                -- so the run parks here: the step run stays 'running' (its
                -- input is the step config), current_position stays at the
                -- previous step, and the Node runner resumes it through
                -- wf_resume_app_step.
                if _step.step_type = 'app' and coalesce(_cfg ->> 'action', '') = '' then
                    raise exception 'app step has no action chosen';
                end if;
                if _step.step_type = 'http' and coalesce(_cfg ->> 'url', '') = '' then
                    raise exception 'http step has no URL';
                end if;
                _ctx := _ctx || jsonb_build_object(
                    '_waiting_step_run', _sr_id, '_waiting_position', _step.position);
                update public.workflow_runs
                   set status = 'waiting_app', context = _ctx
                 where id = _run.id;
                return;

            else
                -- human / ai: valid enum, not yet implemented.
                raise exception 'step type "%" is not yet supported', _step.step_type;
            end if;

            -- Success: merge output into context.steps.<key> and advance.
            _ctx := jsonb_set(_ctx, array['steps', _step.step_key], _output, true);
            update public.workflow_step_runs
               set status = 'success', output = _output, finished_at = clock_timestamp()
             where id = _sr_id;
            update public.workflow_runs
               set context = _ctx, current_position = _step.position
             where id = _run.id;

        exception when others then
            update public.workflow_step_runs
               set status = 'error', error = sqlerrm, finished_at = clock_timestamp()
             where id = _sr_id;
            update public.workflow_runs
               set status = 'error', error = sqlerrm, finished_at = now()
             where id = _run.id;
            return;
        end;
    end loop;

    -- All steps done.
    update public.workflow_runs
       set status = 'success', context = _ctx, finished_at = now()
     where id = _run.id;
end;
$$;

-- =============================================================================
-- SECTION 7: Resuming a parked app/http step, now with retries (2.7)
-- =============================================================================

-- Copied from 20261128000000 and extended: on error, a step whose config
-- carries {retry: {max, backoff}} is re-parked with attempt + 1 and a
-- next_attempt_at the claim respects, instead of failing the run. The run only
-- fails once the attempts are used up. task_count counts every hand-back,
-- successful or not, because every hand-back is one real call to a third party.
create or replace function public.wf_resume_app_step(
    p_run_id      uuid,
    p_step_run_id uuid,
    p_output      jsonb,
    p_error       text
)
    returns text
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _run    public.workflow_runs;
    _sr     public.workflow_step_runs;
    _pos    integer;
    _ctx    jsonb;
    _output jsonb := case when jsonb_typeof(p_output) = 'object' then p_output else '{}'::jsonb end;
    _err    text := left(nullif(trim(coalesce(p_error, '')), ''), 1000);
    _max    integer;
    _back   text;
    _wait   integer;
begin
    select * into _run from public.workflow_runs where id = p_run_id for update;
    if not found then
        return null;
    end if;
    if _run.status <> 'waiting_app'
       or (_run.context ->> '_waiting_step_run') is distinct from p_step_run_id::text then
        return _run.status;
    end if;

    select * into _sr from public.workflow_step_runs
     where id = p_step_run_id and run_id = p_run_id;
    if not found then
        return _run.status;
    end if;

    -- Every hand-back is one executed task, retries included.
    update public.workflow_runs set task_count = task_count + 1 where id = _run.id;

    if _err is not null then
        _max := least(greatest(coalesce((_sr.input -> 'retry' ->> 'max')::integer, 1), 1), 5);
        if _sr.attempt < _max then
            -- Re-park: the step run stays 'running' with its attempt bumped and
            -- the last error kept, and the claim leaves it alone until
            -- next_attempt_at. Fixed backoff waits a minute (the tick's own
            -- resolution); exponential doubles, capped at half an hour.
            _back := coalesce(_sr.input -> 'retry' ->> 'backoff', 'fixed');
            _wait := case when _back = 'exponential'
                          then least(60 * (2 ^ (_sr.attempt - 1))::integer, 1800)
                          else 60 end;
            update public.workflow_step_runs
               set attempt = _sr.attempt + 1, error = _err, started_at = clock_timestamp()
             where id = _sr.id;
            update public.workflow_runs
               set next_attempt_at = now() + make_interval(secs => _wait), lease_until = null
             where id = _run.id;
            return 'waiting_app';
        end if;
    end if;

    -- The position was recorded when the run parked, so a step deleted from the
    -- workflow while the run waited still resumes at the right place.
    _pos := coalesce((_run.context ->> '_waiting_position')::integer,
                     (select position from public.workflow_steps where id = _sr.step_id),
                     _run.current_position);
    _ctx := _run.context - '_waiting_step_run' - '_waiting_position';
    if not (_ctx ? 'steps') then
        _ctx := _ctx || jsonb_build_object('steps', '{}'::jsonb);
    end if;

    if _err is not null then
        update public.workflow_step_runs
           set status = 'error', error = _err, finished_at = clock_timestamp()
         where id = _sr.id;
        update public.workflow_runs
           set status = 'error', error = _err, context = _ctx,
               lease_until = null, next_attempt_at = null, finished_at = now()
         where id = _run.id;
        return 'error';
    end if;

    update public.workflow_step_runs
       set status = 'success', output = _output, error = null, finished_at = clock_timestamp()
     where id = _sr.id;
    _ctx := jsonb_set(_ctx, array['steps', _sr.step_key], _output, true);
    update public.workflow_runs
       set status = 'running', context = _ctx, current_position = _pos,
           lease_until = null, next_attempt_at = null
     where id = _run.id;

    perform public.advance_workflow_run(_run.id);
    return (select status from public.workflow_runs where id = _run.id);
end;
$$;

-- Copied from 20261128000000 and extended: the claim now skips a run waiting
-- out a retry backoff, and hands the runner the step type, the attempt number
-- and the run context — the context because app/http params are interpolated
-- in Node against it, which is what makes {{steps.x.y}} work in a step's
-- params at all. The OUT columns changed, so the old function is dropped.
drop function if exists public.wf_claim_app_runs(integer, uuid);
create or replace function public.wf_claim_app_runs(p_limit integer default 10, p_run_id uuid default null)
    returns table (
        run_id       uuid,
        step_run_id  uuid,
        team_id      uuid,
        workflow_id  uuid,
        step_key     text,
        step_type    text,
        config       jsonb,
        context      jsonb,
        attempt      integer,
        trigger_kind text
    )
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _run public.workflow_runs;
    _sr  public.workflow_step_runs;
begin
    for _run in
        select * from public.workflow_runs r
         where r.status = 'waiting_app'
           and (p_run_id is null or r.id = p_run_id)
           and (r.lease_until is null or r.lease_until < now())
           and (r.next_attempt_at is null or r.next_attempt_at <= now())
         order by r.started_at
         limit greatest(coalesce(p_limit, 10), 1)
         for update skip locked
    loop
        select * into _sr from public.workflow_step_runs s
         where s.id = nullif(_run.context ->> '_waiting_step_run', '')::uuid
           and s.run_id = _run.id
           and s.status = 'running';
        if not found then
            update public.workflow_runs
               set status = 'error', error = 'The app step this run was waiting on is gone.',
                   lease_until = null, finished_at = now()
             where id = _run.id;
            continue;
        end if;

        update public.workflow_runs set lease_until = now() + interval '15 minutes' where id = _run.id;

        run_id       := _run.id;
        step_run_id  := _sr.id;
        team_id      := _run.team_id;
        workflow_id  := _run.workflow_id;
        step_key     := _sr.step_key;
        step_type    := _sr.step_type;
        config       := _sr.input;
        context      := _run.context;
        attempt      := _sr.attempt;
        trigger_kind := coalesce(nullif(_run.trigger_snapshot ->> 'trigger', ''), 'manual');
        return next;
    end loop;
end;
$$;

-- =============================================================================
-- SECTION 8: Waking delayed runs (2.5)
-- =============================================================================

-- The tick's other sweep. Each resumable run is its own sub-transaction so one
-- broken workflow never blocks the rest, and FOR UPDATE SKIP LOCKED keeps two
-- overlapping ticks from waking the same run twice.
create or replace function public.wf_claim_resumable(p_limit integer default 20)
    returns setof uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _run public.workflow_runs;
    _sr  public.workflow_step_runs;
    _ctx jsonb;
    _pos integer;
    _out jsonb;
begin
    for _run in
        select * from public.workflow_runs r
         where r.status = 'waiting_delay'
           and r.resume_at is not null
           and r.resume_at <= now()
         order by r.resume_at
         limit greatest(coalesce(p_limit, 20), 1)
         for update skip locked
    loop
        begin
            select * into _sr from public.workflow_step_runs s
             where s.id = nullif(_run.context ->> '_waiting_step_run', '')::uuid
               and s.run_id = _run.id
               and s.status = 'running';
            if not found then
                update public.workflow_runs
                   set status = 'error', error = 'The delay step this run was waiting on is gone.',
                       resume_at = null, finished_at = now()
                 where id = _run.id;
                continue;
            end if;

            _out := jsonb_build_object(
                'resumed_at', now(),
                'waited_seconds', greatest(round(extract(epoch from (now() - _sr.started_at)))::bigint, 0));
            update public.workflow_step_runs
               set status = 'success', output = _out, finished_at = clock_timestamp()
             where id = _sr.id;

            _pos := coalesce((_run.context ->> '_waiting_position')::integer, _run.current_position);
            _ctx := _run.context - '_waiting_step_run' - '_waiting_position';
            if not (_ctx ? 'steps') then
                _ctx := _ctx || jsonb_build_object('steps', '{}'::jsonb);
            end if;
            _ctx := jsonb_set(_ctx, array['steps', _sr.step_key], _out, true);

            update public.workflow_runs
               set status = 'running', context = _ctx, current_position = _pos, resume_at = null
             where id = _run.id;

            perform public.advance_workflow_run(_run.id);
            return next _run.id;
        exception when others then
            update public.workflow_runs
               set status = 'error', error = left(sqlerrm, 1000), resume_at = null, finished_at = now()
             where id = _run.id;
            raise notice 'wf_claim_resumable: run % failed (% — %)', _run.id, sqlstate, sqlerrm;
        end;
    end loop;
end;
$$;

-- =============================================================================
-- SECTION 9: Starting runs from outside (webhook, event, replay)
-- =============================================================================

-- start_workflow_run_system's richer sibling: it also records the raw trigger
-- payload (so a replay can resend exactly what arrived) and what this run is a
-- replay of. Deliberately does NOT check `enabled` — whether a disabled
-- workflow may run is the caller's policy (the webhook route and the event
-- dispatcher both refuse; a replay by an admin does not). service_role only.
create or replace function public.wf_start_run(
    p_workflow_id uuid,
    p_trigger     jsonb default '{}'::jsonb,
    p_payload     jsonb default null,
    p_replay_of   uuid  default null
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _wf     public.workflows;
    _run_id uuid;
begin
    select * into _wf from public.workflows where id = p_workflow_id;
    if not found then
        raise exception 'workflow not found';
    end if;

    insert into public.workflow_runs
        (workflow_id, team_id, status, trigger_snapshot, trigger_payload, replay_of)
    values (_wf.id, _wf.team_id, 'running', coalesce(p_trigger, '{}'::jsonb),
            case when jsonb_typeof(p_payload) = 'object' then p_payload else null end,
            p_replay_of)
    returning id into _run_id;

    update public.workflows
       set run_count = run_count + 1, last_run_at = now()
     where id = _wf.id;

    perform public.advance_workflow_run(_run_id);
    return _run_id;
end;
$$;

-- =============================================================================
-- SECTION 10: The event bus (2.8)
-- =============================================================================

-- What an emitter calls. SECURITY DEFINER with no membership check and no
-- grant to authenticated/anon: the only callers are other SECURITY DEFINER
-- functions (the Client app's RPCs, the Sheets sync) and the service role,
-- all of which have already decided the caller may act for this team.
create or replace function public.wf_emit_event(
    p_team_id uuid,
    p_key     text,
    p_payload jsonb default '{}'::jsonb
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _id uuid;
begin
    if p_team_id is null or coalesce(p_key, '') = '' then
        return null;
    end if;
    -- An event nobody listens for is not worth a row: this keeps the Client
    -- app's every-request emit from filling the table in a workspace with no
    -- event workflows at all.
    if not exists (
        select 1 from public.workflows w
         where w.team_id = p_team_id and w.enabled and w.trigger_type = 'event'
           and coalesce(w.trigger_config ->> 'event_key', '') = p_key
    ) then
        return null;
    end if;
    insert into public.workflow_events (team_id, key, payload)
    values (p_team_id, p_key,
            case when jsonb_typeof(p_payload) = 'object' then p_payload else '{}'::jsonb end)
    returning id into _id;
    return _id;
end;
$$;

-- The tick's event sweep: oldest event first, one run per matching enabled
-- workflow. The unique (event_id, workflow_id) is what makes it exactly once —
-- two overlapping ticks race on the insert and the loser simply moves on.
create or replace function public.wf_dispatch_events(p_limit integer default 50)
    returns setof uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _ev     public.workflow_events;
    _wf     public.workflows;
    _run_id uuid;
    _taken  integer;
begin
    for _ev in
        select * from public.workflow_events e
         where e.consumed_at is null
         order by e.created_at
         limit greatest(coalesce(p_limit, 50), 1)
         for update skip locked
    loop
        for _wf in
            select * from public.workflows w
             where w.team_id = _ev.team_id
               and w.enabled
               and w.trigger_type = 'event'
               and coalesce(w.trigger_config ->> 'event_key', '') = _ev.key
             order by w.created_at
        loop
            begin
                insert into public.workflow_event_deliveries (event_id, workflow_id)
                values (_ev.id, _wf.id)
                on conflict (event_id, workflow_id) do nothing;
                get diagnostics _taken = row_count;
                if _taken = 0 then
                    continue;
                end if;

                _run_id := public.wf_start_run(
                    _wf.id,
                    jsonb_build_object('trigger', 'event', 'event_key', _ev.key,
                                       'event_id', _ev.id, 'fired_at', _ev.created_at),
                    _ev.payload, null);
                update public.workflow_event_deliveries
                   set run_id = _run_id
                 where event_id = _ev.id and workflow_id = _wf.id;
                return next _run_id;
            exception when others then
                raise notice 'wf_dispatch_events: workflow % skipped for event % (% — %)',
                    _wf.id, _ev.id, sqlstate, sqlerrm;
            end;
        end loop;
        update public.workflow_events set consumed_at = now() where id = _ev.id;
    end loop;
end;
$$;

-- =============================================================================
-- SECTION 11: Retention (2.7)
-- =============================================================================

-- Run history is not free: step runs, contexts and captured payloads all pile
-- up. The sweep runs inside the tick, deletes in bounded batches so it never
-- holds a long lock, and leaves anything still in flight alone.
create or replace function public.wf_sweep_runs(p_limit integer default 500)
    returns integer
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _runs   integer := 0;
    _events integer := 0;
begin
    with doomed as (
        select id from public.workflow_runs
         where expires_at < now()
           and status in ('success', 'error', 'stopped')
         order by expires_at
         limit greatest(coalesce(p_limit, 500), 1)
    )
    delete from public.workflow_runs r using doomed d where r.id = d.id;
    get diagnostics _runs = row_count;

    -- Consumed events and the webhook capture buffer age out on the same
    -- 30-day clock as the runs they belong to.
    with doomed as (
        select id from public.workflow_events
         where consumed_at is not null and created_at < now() - interval '30 days'
         limit greatest(coalesce(p_limit, 500), 1)
    )
    delete from public.workflow_events e using doomed d where e.id = d.id;
    get diagnostics _events = row_count;

    with doomed as (
        select id from public.workflow_webhook_events
         where received_at < now() - interval '30 days'
         limit greatest(coalesce(p_limit, 500), 1)
    )
    delete from public.workflow_webhook_events w using doomed d where w.id = d.id;

    return _runs + _events;
end;
$$;

-- =============================================================================
-- SECTION 12: RLS + grants
-- =============================================================================
alter table public.workflow_webhooks       enable row level security;
alter table public.workflow_webhook_events enable row level security;
alter table public.team_http_allowlist     enable row level security;
alter table public.workflow_events         enable row level security;
alter table public.workflow_event_deliveries enable row level security;

-- Webhooks: members see that one exists and what has arrived; only admins
-- create or change one. The token and signing secret are columns on a row an
-- admin can already read, so they are protected by admin-only writes and by
-- the route never echoing the secret back.
drop policy if exists workflow_webhooks_select on public.workflow_webhooks;
create policy workflow_webhooks_select on public.workflow_webhooks for select to authenticated
    using (public.is_team_admin(team_id));
drop policy if exists workflow_webhooks_write on public.workflow_webhooks;
create policy workflow_webhooks_write on public.workflow_webhooks for all to authenticated
    using (public.is_team_admin(team_id)) with check (public.is_team_admin(team_id));

drop policy if exists workflow_webhook_events_select on public.workflow_webhook_events;
create policy workflow_webhook_events_select on public.workflow_webhook_events for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists team_http_allowlist_select on public.team_http_allowlist;
create policy team_http_allowlist_select on public.team_http_allowlist for select to authenticated
    using (public.is_team_member(team_id));
drop policy if exists team_http_allowlist_write on public.team_http_allowlist;
create policy team_http_allowlist_write on public.team_http_allowlist for all to authenticated
    using (public.is_team_admin(team_id)) with check (public.is_team_admin(team_id));

drop policy if exists workflow_events_select on public.workflow_events;
create policy workflow_events_select on public.workflow_events for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists workflow_event_deliveries_select on public.workflow_event_deliveries;
create policy workflow_event_deliveries_select on public.workflow_event_deliveries for select to authenticated
    using (exists (select 1 from public.workflow_events e
                    where e.id = event_id and public.is_team_member(e.team_id)));

-- Supabase default privileges auto-grant new tables to authenticated and anon;
-- strip what each role must not have.
grant select, insert, update, delete on public.workflow_webhooks   to authenticated;
grant select on public.workflow_webhook_events                     to authenticated;
grant select, insert, update, delete on public.team_http_allowlist to authenticated;
grant select on public.workflow_events                             to authenticated;
grant select on public.workflow_event_deliveries                   to authenticated;
grant all on public.workflow_webhooks         to service_role;
grant all on public.workflow_webhook_events   to service_role;
grant all on public.team_http_allowlist       to service_role;
grant all on public.workflow_events           to service_role;
grant all on public.workflow_event_deliveries to service_role;

revoke all on public.workflow_webhooks         from anon;
revoke all on public.workflow_webhook_events   from anon;
revoke all on public.team_http_allowlist       from anon;
revoke all on public.workflow_events           from anon;
revoke all on public.workflow_event_deliveries from anon;
-- The capture buffer, the event log and the deliveries are written by the
-- routes and the executor (service_role), never by a browser.
revoke insert, update, delete on public.workflow_webhook_events   from authenticated;
revoke insert, update, delete on public.workflow_events           from authenticated;
revoke insert, update, delete on public.workflow_event_deliveries from authenticated;

-- The token and the signing secret live on a row only admins of that team can
-- read (the policy above), which is the same authority that may edit the
-- workflow at all. Both are legitimately theirs: the token is the URL they
-- paste into the sender, the signing secret is the symmetric key they give it.
-- Neither is ever echoed back by the /api/hooks route.

-- Functions. Supabase default privileges grant EXECUTE on every new function
-- to anon and authenticated, so each internal one is revoked by name.
revoke all on function public.wf_eval_rule(jsonb, jsonb) from public, anon;
revoke all on function public.wf_match_rules(jsonb, text, jsonb) from public, anon;
revoke all on function public.wf_eval_condition(jsonb, jsonb) from public, anon;
revoke all on function public.wf_format_value(text, text, jsonb) from public, anon;
revoke all on function public.wf_delay_until(jsonb, jsonb) from public, anon;
grant execute on function public.wf_eval_rule(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.wf_match_rules(jsonb, text, jsonb) to authenticated, service_role;
grant execute on function public.wf_eval_condition(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.wf_format_value(text, text, jsonb) to authenticated, service_role;
grant execute on function public.wf_delay_until(jsonb, jsonb) to authenticated, service_role;

revoke all on function public.advance_workflow_run(uuid) from public, authenticated, anon;
revoke all on function public.wf_resume_app_step(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.wf_resume_app_step(uuid, uuid, jsonb, text) to service_role;
revoke all on function public.wf_claim_app_runs(integer, uuid) from public, anon, authenticated;
grant execute on function public.wf_claim_app_runs(integer, uuid) to service_role;
revoke all on function public.wf_claim_resumable(integer) from public, anon, authenticated;
grant execute on function public.wf_claim_resumable(integer) to service_role;
revoke all on function public.wf_start_run(uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.wf_start_run(uuid, jsonb, jsonb, uuid) to service_role;
revoke all on function public.wf_emit_event(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.wf_emit_event(uuid, text, jsonb) to service_role;
revoke all on function public.wf_dispatch_events(integer) from public, anon, authenticated;
grant execute on function public.wf_dispatch_events(integer) to service_role;
revoke all on function public.wf_sweep_runs(integer) from public, anon, authenticated;
grant execute on function public.wf_sweep_runs(integer) to service_role;
