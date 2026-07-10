-- =============================================================================
-- Workflows engine core — Phase B of Workflows + Agents + Apps.
-- =============================================================================
-- Pabbly-style linear orchestration: Trigger -> Step -> Step -> ... Steps write
-- their output into a run context under steps.<step_key>; later steps reference
-- {{steps.key.field}}. v1 step types executed here: agent, condition, action.
-- (app/human/ai are enum-valid but raise "not yet supported" into the step error
-- — wired in Phase C/D.) Runs are ZERO-TOKEN: agent steps call deterministic
-- skill RPCs, conditions evaluate on data, actions reuse notify/create_task.
--
-- RLS: workflows/agents/steps read = team member, write = team admin;
-- runs/step_runs are read-only to members and written only by the SECURITY
-- DEFINER executor. Error idiom mirrors execute_task_automation (20261009).

-- ------------------------------------------------------------------- tables --

create table if not exists public.agents (
    id          uuid                     default gen_random_uuid() not null,
    team_id     uuid                                               not null,
    name        text                                               not null,
    emoji       text,
    description text,
    skills      jsonb                    default '[]'::jsonb       not null,
    data_scope  jsonb                    default '{}'::jsonb       not null,
    created_by  uuid,
    created_at  timestamp with time zone default current_timestamp not null,
    updated_at  timestamp with time zone default current_timestamp not null,
    constraint agents_pk primary key (id),
    constraint agents_team_id_fk foreign key (team_id)
        references public.teams (id) on delete cascade,
    constraint agents_created_by_fk foreign key (created_by)
        references public.users (id) on delete set null,
    constraint agents_name_check check (char_length(name) <= 200),
    constraint agents_skills_check check (jsonb_typeof(skills) = 'array'),
    constraint agents_data_scope_check check (jsonb_typeof(data_scope) = 'object')
);
create index if not exists agents_team_id_index on public.agents (team_id);

create table if not exists public.workflows (
    id             uuid                     default gen_random_uuid() not null,
    team_id        uuid                                               not null,
    name           text                                               not null,
    description    text,
    enabled        boolean                  default true              not null,
    trigger_type   text                     default 'manual'          not null,
    trigger_config jsonb                    default '{}'::jsonb       not null,
    next_run_at    timestamp with time zone,
    prompt         text,
    created_by     uuid,
    run_count      integer                  default 0                 not null,
    last_run_at    timestamp with time zone,
    created_at     timestamp with time zone default current_timestamp not null,
    updated_at     timestamp with time zone default current_timestamp not null,
    constraint workflows_pk primary key (id),
    constraint workflows_team_id_fk foreign key (team_id)
        references public.teams (id) on delete cascade,
    constraint workflows_created_by_fk foreign key (created_by)
        references public.users (id) on delete set null,
    constraint workflows_name_check check (char_length(name) <= 200),
    constraint workflows_trigger_type_check
        check (trigger_type in ('manual', 'schedule', 'event')),
    constraint workflows_trigger_config_check
        check (jsonb_typeof(trigger_config) = 'object')
);
create index if not exists workflows_team_id_index on public.workflows (team_id);

create table if not exists public.workflow_steps (
    id          uuid                     default gen_random_uuid() not null,
    workflow_id uuid                                               not null,
    position    integer                                            not null,
    step_key    text                                               not null,
    step_type   text                                               not null,
    config      jsonb                    default '{}'::jsonb       not null,
    enabled     boolean                  default true              not null,
    created_at  timestamp with time zone default current_timestamp not null,
    updated_at  timestamp with time zone default current_timestamp not null,
    constraint workflow_steps_pk primary key (id),
    constraint workflow_steps_workflow_id_fk foreign key (workflow_id)
        references public.workflows (id) on delete cascade,
    constraint workflow_steps_step_type_check
        check (step_type in ('agent', 'condition', 'action', 'app', 'human', 'ai')),
    constraint workflow_steps_config_check check (jsonb_typeof(config) = 'object'),
    constraint workflow_steps_key_unique unique (workflow_id, step_key)
);
-- `position` orders steps but is NOT unique: adjacent-step reorder in the
-- Builder would transiently collide a UNIQUE(workflow_id, position). Ties break
-- deterministically by id. (Drop the constraint if an earlier apply added it.)
alter table public.workflow_steps
    drop constraint if exists workflow_steps_position_unique;
create index if not exists workflow_steps_workflow_id_index
    on public.workflow_steps (workflow_id, position);

create table if not exists public.workflow_runs (
    id               uuid                     default gen_random_uuid() not null,
    workflow_id      uuid                                               not null,
    team_id          uuid                                               not null,
    status           text                     default 'running'         not null,
    context          jsonb                    default '{"steps": {}}'::jsonb not null,
    current_position integer                  default 0                 not null,
    trigger_snapshot jsonb                    default '{}'::jsonb       not null,
    error            text,
    started_at       timestamp with time zone default current_timestamp not null,
    finished_at      timestamp with time zone,
    constraint workflow_runs_pk primary key (id),
    constraint workflow_runs_workflow_id_fk foreign key (workflow_id)
        references public.workflows (id) on delete cascade,
    constraint workflow_runs_team_id_fk foreign key (team_id)
        references public.teams (id) on delete cascade,
    constraint workflow_runs_status_check
        check (status in ('running', 'waiting_human', 'success', 'error', 'stopped'))
);
create index if not exists workflow_runs_workflow_id_index
    on public.workflow_runs (workflow_id, started_at desc);

create table if not exists public.workflow_step_runs (
    id          uuid                     default gen_random_uuid() not null,
    run_id      uuid                                               not null,
    step_id     uuid,
    step_key    text                                               not null,
    step_type   text                                               not null,
    status      text                     default 'running'         not null,
    input       jsonb                    default '{}'::jsonb       not null,
    output      jsonb                    default '{}'::jsonb       not null,
    error       text,
    started_at  timestamp with time zone default current_timestamp not null,
    finished_at timestamp with time zone,
    constraint workflow_step_runs_pk primary key (id),
    constraint workflow_step_runs_run_id_fk foreign key (run_id)
        references public.workflow_runs (id) on delete cascade,
    constraint workflow_step_runs_step_id_fk foreign key (step_id)
        references public.workflow_steps (id) on delete set null,
    constraint workflow_step_runs_status_check
        check (status in ('running', 'success', 'error', 'skipped'))
);
create index if not exists workflow_step_runs_run_id_index
    on public.workflow_step_runs (run_id, started_at);

-- ----------------------------------------------------------- updated_at ----

create or replace function public.set_workflow_updated_at()
    returns trigger language plpgsql as
$$
begin
    -- Definition edits touch updated_at; executor counter bumps do not.
    if (to_jsonb(new) - 'run_count' - 'last_run_at' - 'next_run_at' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'run_count' - 'last_run_at' - 'next_run_at' - 'updated_at') then
        new.updated_at := current_timestamp;
    end if;
    return new;
end;
$$;

create or replace function public.set_row_updated_at()
    returns trigger language plpgsql as
$$
begin
    new.updated_at := current_timestamp;
    return new;
end;
$$;

drop trigger if exists workflows_set_updated_at on public.workflows;
create trigger workflows_set_updated_at before update on public.workflows
    for each row execute function public.set_workflow_updated_at();
drop trigger if exists agents_set_updated_at on public.agents;
create trigger agents_set_updated_at before update on public.agents
    for each row execute function public.set_row_updated_at();
drop trigger if exists workflow_steps_set_updated_at on public.workflow_steps;
create trigger workflow_steps_set_updated_at before update on public.workflow_steps
    for each row execute function public.set_row_updated_at();

-- =============================================================================
-- SECTION 2: Skill RPC — overdue_tasks (ports the standup route's queries)
-- =============================================================================
create or replace function public.wf_overdue_tasks(p_team_id uuid)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = public
as
$$
declare
    _overdue  jsonb;
    _due_soon jsonb;
    _oc       integer;
    _dc       integer;
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'wf_overdue_tasks: caller is not a member of team %', p_team_id;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
               'name', t.name, 'project', p.name, 'end_date', t.end_date)
               order by t.end_date), '[]'::jsonb),
           count(*)
      into _overdue, _oc
      from public.tasks t
      join public.projects p on p.id = t.project_id
     where p.team_id = p_team_id
       and t.done = false and t.archived = false
       and t.end_date is not null and t.end_date < now();

    select coalesce(jsonb_agg(jsonb_build_object(
               'name', t.name, 'project', p.name, 'end_date', t.end_date)
               order by t.end_date), '[]'::jsonb),
           count(*)
      into _due_soon, _dc
      from public.tasks t
      join public.projects p on p.id = t.project_id
     where p.team_id = p_team_id
       and t.done = false and t.archived = false
       and t.end_date is not null
       and t.end_date >= now() and t.end_date < now() + interval '7 days';

    return jsonb_build_object(
        'overdue_count', _oc, 'due_soon_count', _dc,
        'overdue', _overdue, 'due_soon', _due_soon);
end;
$$;

-- =============================================================================
-- SECTION 3: Context helpers (resolve / interpolate / condition)
-- =============================================================================

-- Resolves a dotted path ("steps.s1.hr_analytics.leave_pending") into the run
-- context jsonb; returns null when any segment is missing.
create or replace function public.wf_resolve_path(_context jsonb, _path text)
    returns jsonb language sql immutable as
$$
    select _context #> string_to_array(_path, '.');
$$;

-- Replaces every {{ dotted.path }} token in a template with the resolved value
-- (strings unquoted; other json rendered as compact text; missing -> empty).
create or replace function public.wf_interpolate(_template text, _context jsonb)
    returns text language plpgsql immutable as
$$
declare
    _result text := _template;
    _m      text[];
    _val    jsonb;
    _txt    text;
begin
    if _template is null then return null; end if;
    for _m in
        select regexp_matches(_template, '\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}', 'g')
    loop
        _val := public.wf_resolve_path(_context, _m[1]);
        if _val is null then
            _txt := '';
        elsif jsonb_typeof(_val) = 'string' then
            _txt := _val #>> '{}';
        else
            _txt := _val::text;
        end if;
        -- Replace the specific token (rebuild the exact match with braces).
        _result := regexp_replace(
            _result,
            -- Escape the path's dots so '.' matches literally, not as a wildcard.
            '\{\{\s*' || replace(_m[1], '.', '\.') || '\s*\}\}',
            replace(_txt, '\', '\\'),
            'g');
    end loop;
    return _result;
end;
$$;

-- Evaluates a condition config {left, op, right}. left/right are interpolated;
-- numeric comparison when both sides parse as numeric, else text (=,!=).
create or replace function public.wf_eval_condition(_context jsonb, _cfg jsonb)
    returns boolean language plpgsql immutable as
$$
declare
    _op    text := coalesce(_cfg ->> 'op', '=');
    _left  text := public.wf_interpolate(coalesce(_cfg ->> 'left', ''), _context);
    _right text := public.wf_interpolate(coalesce(_cfg ->> 'right', ''), _context);
    -- Only finite decimals take the numeric branch; this deliberately excludes
    -- 'NaN'/'Infinity' (which ::numeric would accept and order surprisingly).
    _num_re constant text := '^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$';
    _isnum boolean := (_left ~ _num_re) and (_right ~ _num_re);
    _ln    numeric;
    _rn    numeric;
begin
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

-- =============================================================================
-- SECTION 4: Skill dispatch — maps a skill key to its RPC, aggregating to jsonb
-- =============================================================================
-- Called from within the executor. Skill RPCs are SECURITY DEFINER and gate on
-- auth.uid() membership; for run-now that is the (team-member) caller, so they
-- pass. (Scheduled runs get a team-authority path in Phase C.)
create or replace function public.wf_run_skill(
    p_skill   text,
    p_team_id uuid,
    p_org_id  uuid,
    p_params  jsonb
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _out  jsonb;
    _from date := coalesce((p_params ->> 'from')::date, (current_date - 30));
    _to   date := coalesce((p_params ->> 'to')::date, (current_date + 30));
begin
    case p_skill
        when 'team_overview' then
            select to_jsonb(r) into _out from public.report_team_overview(p_team_id) r;
        when 'project_report' then
            select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into _out
              from public.report_projects(p_team_id) r;
        when 'member_report' then
            select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into _out
              from public.report_members(p_team_id) r;
        when 'timesheet' then
            select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into _out
              from public.report_time_logs(p_team_id, _from, _to) r;
        when 'availability' then
            select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into _out
              from public.get_team_member_availability(p_team_id, _from, _to) r;
        when 'overdue_tasks' then
            _out := public.wf_overdue_tasks(p_team_id);
        when 'hr_analytics' then
            if p_org_id is null then
                raise exception 'hr_analytics: no organization for this team';
            end if;
            _out := public.hr_org_analytics(p_org_id);
        else
            raise exception 'unknown skill %', p_skill;
    end case;
    return coalesce(_out, '{}'::jsonb);
end;
$$;

-- =============================================================================
-- SECTION 5: Executor — advance_workflow_run + start_workflow_run
-- =============================================================================

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
begin
    select * into _run from public.workflow_runs where id = p_run_id for update;
    if not found or _run.status <> 'running' then
        return;
    end if;
    _team_id := _run.team_id;
    select organization_id into _org_id from public.teams where id = _team_id;
    _ctx := _run.context;
    -- jsonb_set cannot create a missing intermediate key, so guarantee the
    -- `steps` container exists before merging any steps.<key> output into it.
    if not (_ctx ? 'steps') then
        _ctx := _ctx || jsonb_build_object('steps', '{}'::jsonb);
    end if;

    for _step in
        select * from public.workflow_steps
         where workflow_id = _run.workflow_id
           and enabled
           and position > _run.current_position
         order by position, id
    loop
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
                _output := jsonb_build_object('passed', _passed);
                if not _passed then
                    -- Linear stop: the run completes successfully, gated here.
                    update public.workflow_step_runs
                       set status = 'success', output = _output, finished_at = now()
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
                    -- auth.uid() (the run-now caller), so cross-tenant creation
                    -- raises inside it.
                    _new_id := public.create_task(
                        public.wf_interpolate(coalesce(_cfg ->> 'name', 'Task'), _ctx),
                        (_cfg ->> 'project_id')::uuid);
                    _output := jsonb_build_object('task_id', _new_id);
                else
                    -- 'add_comment' was removed: a raw SECURITY DEFINER insert into
                    -- task_comments bypassed is_task_member and allowed cross-tenant
                    -- writes. Re-add only via a gated RPC + a registry entry.
                    raise exception 'unknown action %', coalesce(_action, '(null)');
                end if;

            else
                -- app / human / ai: valid enum, not yet implemented.
                raise exception 'step type "%" is not yet supported', _step.step_type;
            end if;

            -- Success: merge output into context.steps.<key> and advance.
            _ctx := jsonb_set(_ctx, array['steps', _step.step_key], _output, true);
            update public.workflow_step_runs
               set status = 'success', output = _output, finished_at = now()
             where id = _sr_id;
            update public.workflow_runs
               set context = _ctx, current_position = _step.position
             where id = _run.id;

        exception when others then
            update public.workflow_step_runs
               set status = 'error', error = sqlerrm, finished_at = now()
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

-- Creates a run for a workflow and advances it. Any team member may run;
-- authority for skill reads is the caller (a team member). Returns the run id.
create or replace function public.start_workflow_run(
    p_workflow_id     uuid,
    p_trigger_snapshot jsonb default '{}'::jsonb
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
    if not public.is_team_member(_wf.team_id) then
        raise exception 'not authorized to run this workflow';
    end if;

    insert into public.workflow_runs (workflow_id, team_id, status, trigger_snapshot)
    values (_wf.id, _wf.team_id, 'running', coalesce(p_trigger_snapshot, '{}'::jsonb))
    returning id into _run_id;

    update public.workflows
       set run_count = run_count + 1, last_run_at = now()
     where id = _wf.id;

    perform public.advance_workflow_run(_run_id);
    return _run_id;
end;
$$;

-- =============================================================================
-- SECTION 6: RLS + grants
-- =============================================================================
alter table public.agents             enable row level security;
alter table public.workflows          enable row level security;
alter table public.workflow_steps     enable row level security;
alter table public.workflow_runs      enable row level security;
alter table public.workflow_step_runs enable row level security;

-- agents
drop policy if exists agents_select on public.agents;
create policy agents_select on public.agents for select to authenticated
    using (public.is_team_member(team_id));
drop policy if exists agents_write on public.agents;
create policy agents_write on public.agents for all to authenticated
    using (public.is_team_admin(team_id)) with check (public.is_team_admin(team_id));

-- workflows
drop policy if exists workflows_select on public.workflows;
create policy workflows_select on public.workflows for select to authenticated
    using (public.is_team_member(team_id));
drop policy if exists workflows_write on public.workflows;
create policy workflows_write on public.workflows for all to authenticated
    using (public.is_team_admin(team_id)) with check (public.is_team_admin(team_id));

-- workflow_steps (authority via the parent workflow's team)
drop policy if exists workflow_steps_select on public.workflow_steps;
create policy workflow_steps_select on public.workflow_steps for select to authenticated
    using (exists (select 1 from public.workflows w
                    where w.id = workflow_id and public.is_team_member(w.team_id)));
drop policy if exists workflow_steps_write on public.workflow_steps;
create policy workflow_steps_write on public.workflow_steps for all to authenticated
    using (exists (select 1 from public.workflows w
                    where w.id = workflow_id and public.is_team_admin(w.team_id)))
    with check (exists (select 1 from public.workflows w
                    where w.id = workflow_id and public.is_team_admin(w.team_id)));

-- runs / step_runs: members read; only the executor (service_role/definer) writes.
drop policy if exists workflow_runs_select on public.workflow_runs;
create policy workflow_runs_select on public.workflow_runs for select to authenticated
    using (public.is_team_member(team_id));
drop policy if exists workflow_step_runs_select on public.workflow_step_runs;
create policy workflow_step_runs_select on public.workflow_step_runs for select to authenticated
    using (exists (select 1 from public.workflow_runs r
                    where r.id = run_id and public.is_team_member(r.team_id)));

-- grants (Supabase default-privileges auto-grant new tables to authenticated/
-- anon; strip what each role must not have — see 20261011000000 for the why).
grant select, insert, update, delete on public.agents         to authenticated;
grant select, insert, update, delete on public.workflows      to authenticated;
grant select, insert, update, delete on public.workflow_steps to authenticated;
grant select on public.workflow_runs      to authenticated;
grant select on public.workflow_step_runs to authenticated;
grant all on public.agents             to service_role;
grant all on public.workflows          to service_role;
grant all on public.workflow_steps     to service_role;
grant all on public.workflow_runs      to service_role;
grant all on public.workflow_step_runs to service_role;

revoke all on public.agents             from anon;
revoke all on public.workflows          from anon;
revoke all on public.workflow_steps     from anon;
revoke all on public.workflow_runs      from anon;
revoke all on public.workflow_step_runs from anon;
-- runs/step_runs are executor-written only.
revoke insert, update, delete on public.workflow_runs      from authenticated;
revoke insert, update, delete on public.workflow_step_runs from authenticated;

-- Only start_workflow_run is a caller entry point (it gates is_team_member).
-- advance_workflow_run + wf_run_skill are internal to the executor (called with
-- definer privileges regardless of grants), so they are revoked from every
-- authenticated/anon caller — closing direct-call entry points (and future-
-- proofing the Phase C waiting_human resume path).
-- NB: Supabase default privileges auto-grant EXECUTE on every new function to
-- anon + authenticated, so revoking from PUBLIC alone leaves those role grants
-- intact — the internal executor functions must be revoked from the roles too.
revoke all on function public.start_workflow_run(uuid, jsonb) from public, anon;
grant execute on function public.start_workflow_run(uuid, jsonb) to authenticated;
revoke all on function public.advance_workflow_run(uuid) from public, authenticated, anon;
revoke all on function public.wf_run_skill(text, uuid, uuid, jsonb) from public, authenticated, anon;
grant execute on function public.wf_overdue_tasks(uuid) to authenticated;
