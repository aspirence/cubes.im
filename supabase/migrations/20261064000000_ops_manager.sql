-- =============================================================================
-- Operations Manager agent — an always-on ops brain over the workspace.
-- =============================================================================
-- A new class of agent that watches delivery health and surfaces the things an
-- operations manager would chase: overdue work, tasks stalling with no updates,
-- work due-soon that hasn't started, items where the client keeps requesting
-- changes (video-review revisions), and overloaded people. It produces a
-- structured, ZERO-AI-TOKEN scan (all deterministic SQL) that lands as findings,
-- and can nudge the assignee in a chat channel ("why is this overdue?", "why so
-- many change requests?") and post a delivery digest — branded as the agent.
--
-- Design notes:
--   * Findings live in ops_insights, admin-readable, RPC-written only.
--   * Chat has no bot identity, so nudges/digests are authored by the acting
--     admin (auth.uid()) but the body is branded with the agent's emoji/name,
--     and the assignee also gets a notification.
--   * An "ops_manager" agent is created from a template; agents gain kind +
--     ops_config + scan timestamps so the app can drive a guarded periodic scan.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. agents — ops metadata
-- -----------------------------------------------------------------------------
alter table public.agents
    add column if not exists kind text;                       -- null | 'ops_manager'
alter table public.agents
    add column if not exists ops_config jsonb not null default '{}'::jsonb
        constraint agents_ops_config_check check (jsonb_typeof(ops_config) = 'object');
alter table public.agents
    add column if not exists ops_last_scan_at timestamptz;
alter table public.agents
    add column if not exists ops_next_scan_at timestamptz;

-- -----------------------------------------------------------------------------
-- 2. ops_insights — one row per finding produced by a scan
-- -----------------------------------------------------------------------------
create table if not exists public.ops_insights (
    id              uuid default gen_random_uuid() not null,
    team_id         uuid not null,
    agent_id        uuid not null,
    scan_id         uuid not null,
    kind            text not null
        constraint ops_insights_kind_check
            check (kind in ('overdue','at_risk','stalled','heavy_revisions','overloaded','quality_flag')),
    severity        text not null default 'med'
        constraint ops_insights_severity_check check (severity in ('low','med','high')),
    task_id         uuid,
    project_id      uuid,
    team_member_id  uuid,
    subject_user_id uuid,
    title           text not null,
    detail          text,
    metric          jsonb not null default '{}'::jsonb,
    suggested_ask   text,
    status          text not null default 'open'
        constraint ops_insights_status_check
            check (status in ('open','nudged','resolved','dismissed')),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint ops_insights_pk primary key (id),
    constraint ops_insights_team_fk   foreign key (team_id) references public.teams (id) on delete cascade,
    constraint ops_insights_agent_fk  foreign key (agent_id) references public.agents (id) on delete cascade,
    constraint ops_insights_task_fk    foreign key (task_id) references public.tasks (id) on delete set null,
    constraint ops_insights_project_fk foreign key (project_id) references public.projects (id) on delete set null,
    constraint ops_insights_tm_fk      foreign key (team_member_id) references public.team_members (id) on delete set null,
    constraint ops_insights_user_fk    foreign key (subject_user_id) references public.users (id) on delete set null
);

create index if not exists ops_insights_agent_idx on public.ops_insights (agent_id, created_at desc);
create index if not exists ops_insights_team_idx on public.ops_insights (team_id);
create index if not exists ops_insights_scan_idx on public.ops_insights (scan_id);

alter table public.ops_insights enable row level security;

drop policy if exists ops_insights_select on public.ops_insights;
create policy ops_insights_select on public.ops_insights
    for select to authenticated
    using (public.is_team_admin(team_id));

-- Writes only through the SECURITY DEFINER RPCs below.
revoke insert, update, delete on public.ops_insights from authenticated;
revoke insert, update, delete on public.ops_insights from anon;
grant select on public.ops_insights to authenticated;
grant all on public.ops_insights to service_role;

-- -----------------------------------------------------------------------------
-- 3. ops_post_message — post an agent-branded message into a chat channel
-- -----------------------------------------------------------------------------
-- Authored by the acting admin (chat has no bot identity), but the caller builds
-- the body with the agent's emoji/name so it reads as the agent speaking.
create or replace function public.ops_post_message(
    p_agent_id   uuid,
    p_channel_id uuid,
    p_body       text
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _team_id uuid;
    _sender  uuid := auth.uid();
    _msg_id  uuid;
begin
    if _sender is null then
        raise exception 'ops_post_message: no authenticated user';
    end if;
    select a.team_id into _team_id from public.agents a where a.id = p_agent_id;
    if _team_id is null then
        raise exception 'ops_post_message: agent % not found', p_agent_id;
    end if;
    if not public.is_team_admin(_team_id) then
        raise exception 'ops_post_message: not permitted';
    end if;
    -- Only public team channels are valid targets — never a private channel or
    -- a DM. And the caller must already be able to reach it (can_access_channel
    -- reads auth.uid(), so it holds even inside this SECURITY DEFINER function).
    -- This stops an admin from auto-joining / posting into a private channel or
    -- someone else's DM by passing its id.
    if not exists (
        select 1 from public.chat_channels c
        where c.id = p_channel_id and c.team_id = _team_id
          and c.kind = 'channel' and c.is_private is false
    ) then
        raise exception 'ops_post_message: target must be a public channel in this workspace';
    end if;
    if not public.can_access_channel(p_channel_id) then
        raise exception 'ops_post_message: channel not accessible';
    end if;
    if coalesce(btrim(p_body), '') = '' then
        raise exception 'ops_post_message: empty body';
    end if;

    -- Ensure the sender has a membership row (a read marker; harmless on a
    -- public channel the caller already accesses). SECURITY DEFINER bypasses the
    -- self-join RLS, which is why the can_access_channel gate above is required.
    insert into public.chat_channel_members (channel_id, user_id)
    values (p_channel_id, _sender)
    on conflict (channel_id, user_id) do nothing;

    insert into public.chat_messages (channel_id, user_id, body)
    values (p_channel_id, _sender, left(p_body, 4000))
    returning id into _msg_id;

    return _msg_id;
end;
$$;

revoke all on function public.ops_post_message(uuid, uuid, text) from public;
grant execute on function public.ops_post_message(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. ops_manager_scan — the deterministic ops brain
-- -----------------------------------------------------------------------------
create or replace function public.ops_manager_scan(
    p_team_id  uuid,
    p_agent_id uuid,
    p_params   jsonb default '{}'::jsonb
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _scan_id           uuid := gen_random_uuid();
    _cfg               jsonb;
    _stalled_days      int;
    _at_risk_days      int;
    _overload_open     int;
    _heavy_rev         int;
    _counts            jsonb;
    _pulse             jsonb;
begin
    if not public.is_team_admin(p_team_id) then
        raise exception 'ops_manager_scan: not permitted';
    end if;
    if not exists (select 1 from public.agents a where a.id = p_agent_id and a.team_id = p_team_id) then
        raise exception 'ops_manager_scan: agent % not in team', p_agent_id;
    end if;

    -- thresholds: explicit params win, else the agent's ops_config, else defaults.
    select ops_config into _cfg from public.agents where id = p_agent_id;
    _cfg          := coalesce(_cfg, '{}'::jsonb) || coalesce(p_params, '{}'::jsonb);
    _stalled_days  := coalesce((_cfg->>'stalled_days')::int, 5);
    _at_risk_days  := coalesce((_cfg->>'at_risk_days')::int, 3);
    _overload_open := coalesce((_cfg->>'overload_open')::int, 8);
    _heavy_rev     := coalesce((_cfg->>'heavy_revision_count')::int, 3);

    -- Fresh snapshot: drop previous still-open findings (keep nudged/resolved as history).
    delete from public.ops_insights where agent_id = p_agent_id and status = 'open';

    -- ---- OVERDUE ------------------------------------------------------------
    insert into public.ops_insights
        (team_id, agent_id, scan_id, kind, severity, task_id, project_id,
         team_member_id, subject_user_id, title, detail, metric, suggested_ask)
    select p_team_id, p_agent_id, _scan_id, 'overdue',
           case when (current_date - t.end_date::date) > 7 then 'high'
                when (current_date - t.end_date::date) > 2 then 'med' else 'low' end,
           t.id, t.project_id, asn.team_member_id, asn.user_id,
           t.name || ' — overdue by ' || (current_date - t.end_date::date) || ' day(s)',
           coalesce('Assigned to ' || asn.name, 'Unassigned') || ' · ' || p.name,
           jsonb_build_object('days_overdue', current_date - t.end_date::date,
                              'assignee', asn.name, 'project', p.name),
           'Hi ' || coalesce(asn.name, 'team') || ' — "' || t.name ||
           '" is overdue by ' || (current_date - t.end_date::date) ||
           ' day(s). What''s blocking it, and what''s the new ETA?'
    from public.tasks t
    join public.projects p on p.id = t.project_id
    left join lateral (
        select tm.id as team_member_id, u.id as user_id, u.name
        from public.tasks_assignees ta
        join public.team_members tm on tm.id = ta.team_member_id
        left join public.users u on u.id = tm.user_id
        where ta.task_id = t.id
        order by ta.created_at limit 1
    ) asn on true
    where p.team_id = p_team_id
      and t.done is false and t.archived is false
      and t.end_date is not null and t.end_date < now()
    order by (current_date - t.end_date::date) desc
    limit 100;

    -- ---- AT RISK (due soon, not started) ------------------------------------
    insert into public.ops_insights
        (team_id, agent_id, scan_id, kind, severity, task_id, project_id,
         team_member_id, subject_user_id, title, detail, metric, suggested_ask)
    select p_team_id, p_agent_id, _scan_id, 'at_risk', 'med',
           t.id, t.project_id, asn.team_member_id, asn.user_id,
           t.name || ' — due in ' || (t.end_date::date - current_date) || ' day(s), not started',
           coalesce('Assigned to ' || asn.name, 'Unassigned') || ' · ' || p.name,
           jsonb_build_object('days_left', t.end_date::date - current_date,
                              'assignee', asn.name, 'project', p.name),
           'Heads up ' || coalesce(asn.name, 'team') || ' — "' || t.name ||
           '" is due in ' || (t.end_date::date - current_date) ||
           ' day(s) and hasn''t started. On track?'
    from public.tasks t
    join public.projects p on p.id = t.project_id
    join public.task_statuses s on s.id = t.status_id
    join public.sys_task_status_categories c on c.id = s.category_id
    left join lateral (
        select tm.id as team_member_id, u.id as user_id, u.name
        from public.tasks_assignees ta
        join public.team_members tm on tm.id = ta.team_member_id
        left join public.users u on u.id = tm.user_id
        where ta.task_id = t.id
        order by ta.created_at limit 1
    ) asn on true
    where p.team_id = p_team_id
      and t.done is false and t.archived is false
      and t.end_date is not null
      and t.end_date >= now() and t.end_date::date - current_date <= _at_risk_days
      and c.is_todo is true and coalesce(t.total_minutes, 0) = 0
    limit 100;

    -- ---- STALLED (assigned, no movement in N days, not overdue) --------------
    insert into public.ops_insights
        (team_id, agent_id, scan_id, kind, severity, task_id, project_id,
         team_member_id, subject_user_id, title, detail, metric, suggested_ask)
    select p_team_id, p_agent_id, _scan_id, 'stalled',
           case when act.last_at < now() - (2 * _stalled_days || ' days')::interval then 'high' else 'med' end,
           t.id, t.project_id, asn.team_member_id, asn.user_id,
           t.name || ' — no updates in ' || greatest(1, (current_date - act.last_at::date)) || ' day(s)',
           coalesce('Assigned to ' || asn.name, 'Unassigned') || ' · ' || p.name,
           jsonb_build_object('days_idle', current_date - act.last_at::date,
                              'assignee', asn.name, 'project', p.name),
           'Hi ' || coalesce(asn.name, 'team') || ' — "' || t.name ||
           '" has had no activity for ' || greatest(1, (current_date - act.last_at::date)) ||
           ' day(s). Where does it stand?'
    from public.tasks t
    join public.projects p on p.id = t.project_id
    join lateral (
        select greatest(
                 t.updated_at,
                 coalesce((select max(cm.created_at) from public.task_comments cm where cm.task_id = t.id), t.created_at),
                 coalesce((select max(al.created_at) from public.task_activity_logs al where al.task_id = t.id), t.created_at)
               ) as last_at
    ) act on true
    join lateral (
        select tm.id as team_member_id, u.id as user_id, u.name
        from public.tasks_assignees ta
        join public.team_members tm on tm.id = ta.team_member_id
        left join public.users u on u.id = tm.user_id
        where ta.task_id = t.id
        order by ta.created_at limit 1
    ) asn on true
    where p.team_id = p_team_id
      and t.done is false and t.archived is false
      and (t.end_date is null or t.end_date >= now())
      and act.last_at < now() - (_stalled_days || ' days')::interval
    order by act.last_at asc
    limit 100;

    -- ---- HEAVY REVISIONS (client change requests) ---------------------------
    insert into public.ops_insights
        (team_id, agent_id, scan_id, kind, severity, task_id, project_id,
         team_member_id, subject_user_id, title, detail, metric, suggested_ask)
    select p_team_id, p_agent_id, _scan_id, 'heavy_revisions',
           case when v.latest_revision >= (_heavy_rev + 2) then 'high' else 'med' end,
           v.task_id, v.project_id, asn.team_member_id, asn.user_id,
           v.title || ' — revision ' || v.latest_revision ||
           case when v.status = 'changes_requested' then ' · changes requested' else '' end,
           coalesce('Owner ' || asn.name || ' · ', '') ||
           coalesce((select count(*) from public.app_video_review_comments cc
                     where cc.video_id = v.id and cc.resolved is false), 0) || ' open comment(s)',
           jsonb_build_object('revision', v.latest_revision, 'status', v.status,
                              'open_comments', (select count(*) from public.app_video_review_comments cc
                                                where cc.video_id = v.id and cc.resolved is false)),
           'The client is on revision ' || v.latest_revision || ' for "' || v.title ||
           '". What''s driving the repeated change requests, and can we align on scope?'
    from public.app_video_review_videos v
    left join lateral (
        select tm.id as team_member_id, u.id as user_id, u.name
        from public.tasks_assignees ta
        join public.team_members tm on tm.id = ta.team_member_id
        left join public.users u on u.id = tm.user_id
        where ta.task_id = v.task_id
        order by ta.created_at limit 1
    ) asn on true
    where v.team_id = p_team_id
      and v.deleted is false
      and (v.status = 'changes_requested' or v.latest_revision >= _heavy_rev)
    order by v.latest_revision desc
    limit 50;

    -- ---- OVERLOADED members -------------------------------------------------
    insert into public.ops_insights
        (team_id, agent_id, scan_id, kind, severity, team_member_id, subject_user_id,
         title, detail, metric, suggested_ask)
    select p_team_id, p_agent_id, _scan_id, 'overloaded',
           case when m.overdue_cnt >= 3 or m.open_cnt >= _overload_open + 5 then 'high' else 'med' end,
           m.team_member_id, m.user_id,
           m.name || ' — ' || m.open_cnt || ' open task(s), ' || m.overdue_cnt || ' overdue',
           'Workload looks heavy — consider rebalancing.',
           jsonb_build_object('open', m.open_cnt, 'overdue', m.overdue_cnt),
           m.name || ' is carrying ' || m.open_cnt || ' open task(s) (' || m.overdue_cnt ||
           ' overdue). Do we need to rebalance or unblock anything?'
    from (
        select tm.id as team_member_id, u.id as user_id,
               coalesce(u.name, u.email) as name,
               count(*) filter (where t.done is false and t.archived is false) as open_cnt,
               count(*) filter (where t.done is false and t.archived is false
                                 and t.end_date is not null and t.end_date < now()) as overdue_cnt
        from public.team_members tm
        join public.users u on u.id = tm.user_id
        join public.tasks_assignees ta on ta.team_member_id = tm.id
        join public.tasks t on t.id = ta.task_id
        join public.projects p on p.id = t.project_id and p.team_id = p_team_id
        where tm.team_id = p_team_id and tm.active is true
        group by tm.id, u.id, coalesce(u.name, u.email)
    ) m
    where m.open_cnt >= _overload_open or m.overdue_cnt >= 3
    limit 50;

    -- ---- QUALITY FLAG (silent overdue / status churn) -----------------------
    insert into public.ops_insights
        (team_id, agent_id, scan_id, kind, severity, task_id, project_id,
         team_member_id, subject_user_id, title, detail, metric, suggested_ask)
    select p_team_id, p_agent_id, _scan_id, 'quality_flag', 'low',
           t.id, t.project_id, asn.team_member_id, asn.user_id,
           t.name || ' — ' ||
           case when churn.n >= 4 then 'bounced statuses ' || churn.n || 'x'
                else 'overdue with no comments' end,
           p.name,
           jsonb_build_object('status_changes', churn.n, 'comments', cmt.n,
                              'overdue', t.end_date is not null and t.end_date < now()),
           case when churn.n >= 4
                then '"' || t.name || '" has changed status ' || churn.n ||
                     ' times — is the scope or acceptance unclear?'
                else '"' || t.name || '" is overdue with no comments logged — can we get a status note?'
           end
    from public.tasks t
    join public.projects p on p.id = t.project_id
    join lateral (
        select count(*)::int as n from public.task_activity_logs al
        where al.task_id = t.id and al.action = 'status_changed'
    ) churn on true
    join lateral (
        select count(*)::int as n from public.task_comments cm where cm.task_id = t.id
    ) cmt on true
    left join lateral (
        select tm.id as team_member_id, u.id as user_id, u.name
        from public.tasks_assignees ta
        join public.team_members tm on tm.id = ta.team_member_id
        left join public.users u on u.id = tm.user_id
        where ta.task_id = t.id
        order by ta.created_at limit 1
    ) asn on true
    where p.team_id = p_team_id
      and t.done is false and t.archived is false
      and (
        churn.n >= 4
        or (t.end_date is not null and t.end_date < now() and cmt.n = 0)
      )
    limit 50;

    -- ---- stamp the agent + build the summary --------------------------------
    update public.agents
       set ops_last_scan_at = now(),
           ops_next_scan_at = now() + interval '1 day',
           updated_at = now()
     where id = p_agent_id;

    select jsonb_object_agg(kind, cnt) into _counts
    from (
        select kind, count(*) as cnt from public.ops_insights
        where scan_id = _scan_id group by kind
    ) k;

    select coalesce(jsonb_agg(jsonb_build_object(
               'name', name, 'open', open_cnt, 'overdue', overdue_cnt,
               'completed_7d', done_cnt, 'logged_min_7d', logged_min)
               order by open_cnt desc), '[]'::jsonb)
    into _pulse
    from (
        select coalesce(u.name, u.email) as name,
               count(*) filter (where t.done is false and t.archived is false) as open_cnt,
               count(*) filter (where t.done is false and t.archived is false
                                 and t.end_date is not null and t.end_date < now()) as overdue_cnt,
               count(*) filter (where t.done is true and t.completed_at >= now() - interval '7 days') as done_cnt,
               coalesce((select round(sum(wl.time_spent)::numeric / 60)
                         from public.task_work_log wl
                         where wl.user_id = u.id and wl.created_at >= now() - interval '7 days'), 0) as logged_min
        from public.team_members tm
        join public.users u on u.id = tm.user_id
        join public.tasks_assignees ta on ta.team_member_id = tm.id
        join public.tasks t on t.id = ta.task_id
        join public.projects p on p.id = t.project_id and p.team_id = p_team_id
        where tm.team_id = p_team_id and tm.active is true
        group by u.id, coalesce(u.name, u.email)
    ) mp;

    return jsonb_build_object(
        'scan_id', _scan_id,
        'generated_at', now(),
        'counts', coalesce(_counts, '{}'::jsonb),
        'pulse', _pulse
    );
end;
$$;

revoke all on function public.ops_manager_scan(uuid, uuid, jsonb) from public;
grant execute on function public.ops_manager_scan(uuid, uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. ops_nudge — post a targeted question for one finding + notify the assignee
-- -----------------------------------------------------------------------------
create or replace function public.ops_nudge(
    p_insight_id uuid,
    p_channel_id uuid
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _ins    public.ops_insights%rowtype;
    _agent  public.agents%rowtype;
    _body   text;
    _msg    uuid;
    _label  text;
begin
    select * into _ins from public.ops_insights where id = p_insight_id;
    if _ins.id is null then
        raise exception 'ops_nudge: insight not found';
    end if;
    select * into _agent from public.agents where id = _ins.agent_id;
    if not public.is_team_admin(_ins.team_id) then
        raise exception 'ops_nudge: not permitted';
    end if;

    _label := coalesce(_agent.emoji, '🎯') || ' ' || coalesce(_agent.name, 'Operations Manager');
    _body := _label || ' · ops check-in' || chr(10) ||
             coalesce(_ins.suggested_ask, _ins.title);

    _msg := public.ops_post_message(_ins.agent_id, p_channel_id, _body);

    if _ins.subject_user_id is not null then
        perform public.create_notification(
            _ins.subject_user_id,
            coalesce(_agent.name, 'Operations Manager') || ': ' || coalesce(_ins.suggested_ask, _ins.title),
            'info',
            case when _ins.task_id is not null then '/projects/' || _ins.project_id::text else null end,
            _ins.team_id, _ins.task_id, _ins.project_id
        );
    end if;

    update public.ops_insights set status = 'nudged', updated_at = now() where id = p_insight_id;
    return _msg;
end;
$$;

revoke all on function public.ops_nudge(uuid, uuid) from public;
grant execute on function public.ops_nudge(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. ops_post_digest — a formatted delivery digest of the latest scan
-- -----------------------------------------------------------------------------
create or replace function public.ops_post_digest(
    p_agent_id   uuid,
    p_channel_id uuid
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _agent  public.agents%rowtype;
    _label  text;
    _body   text;
    _line   text;
    _oc     int;
    _sc     int;
    _rc     int;
    _ac     int;
    _lc     int;
begin
    select * into _agent from public.agents where id = p_agent_id;
    if _agent.id is null then
        raise exception 'ops_post_digest: agent not found';
    end if;
    if not public.is_team_admin(_agent.team_id) then
        raise exception 'ops_post_digest: not permitted';
    end if;

    select count(*) filter (where kind = 'overdue'),
           count(*) filter (where kind = 'stalled'),
           count(*) filter (where kind = 'heavy_revisions'),
           count(*) filter (where kind = 'at_risk'),
           count(*) filter (where kind = 'overloaded')
      into _oc, _sc, _rc, _ac, _lc
      from public.ops_insights
     where agent_id = p_agent_id and status in ('open','nudged')
       and created_at >= coalesce(_agent.ops_last_scan_at, now() - interval '1 day');

    _label := coalesce(_agent.emoji, '🎯') || ' ' || coalesce(_agent.name, 'Operations Manager');
    _body := _label || ' · delivery digest' || chr(10) ||
             '• Overdue: ' || _oc || chr(10) ||
             '• Due soon, not started: ' || _ac || chr(10) ||
             '• Stalled (no updates): ' || _sc || chr(10) ||
             '• Heavy client revisions: ' || _rc || chr(10) ||
             '• Overloaded people: ' || _lc;

    -- Append the three most urgent overdue items.
    for _line in
        select '   ↳ ' || title
        from public.ops_insights
        where agent_id = p_agent_id and kind = 'overdue'
          and status in ('open','nudged')
          and created_at >= coalesce(_agent.ops_last_scan_at, now() - interval '1 day')
        order by case severity when 'high' then 0 when 'med' then 1 else 2 end, created_at
        limit 3
    loop
        _body := _body || chr(10) || _line;
    end loop;

    return public.ops_post_message(p_agent_id, p_channel_id, _body);
end;
$$;

revoke all on function public.ops_post_digest(uuid, uuid) from public;
grant execute on function public.ops_post_digest(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. ops_set_insight_status — resolve / dismiss / reopen a finding
-- -----------------------------------------------------------------------------
create or replace function public.ops_set_insight_status(
    p_insight_id uuid,
    p_status     text
)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _team uuid;
begin
    if p_status not in ('open','nudged','resolved','dismissed') then
        raise exception 'ops_set_insight_status: invalid status %', p_status;
    end if;
    select team_id into _team from public.ops_insights where id = p_insight_id;
    if _team is null then
        raise exception 'ops_set_insight_status: not found';
    end if;
    if not public.is_team_admin(_team) then
        raise exception 'ops_set_insight_status: not permitted';
    end if;
    update public.ops_insights set status = p_status, updated_at = now() where id = p_insight_id;
end;
$$;

revoke all on function public.ops_set_insight_status(uuid, text) from public;
grant execute on function public.ops_set_insight_status(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. create_agent_from_template — seed a preconfigured agent
-- -----------------------------------------------------------------------------
-- v1 ships the Operations Manager template. Returns the new agent id.
create or replace function public.create_agent_from_template(
    p_team_id      uuid,
    p_template_key text
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
    if not public.is_team_admin(p_team_id) then
        raise exception 'create_agent_from_template: not permitted';
    end if;

    if p_template_key = 'ops_manager' then
        insert into public.agents (team_id, name, emoji, description, kind, skills, data_scope, ops_config, created_by)
        values (
            p_team_id,
            'Operations Manager',
            '🎯',
            'Watches delivery health across the workspace — flags overdue, stalled, at-risk and heavy-revision work, spots overloaded people, and nudges owners in chat.',
            'ops_manager',
            '["overdue_tasks","project_report","member_report"]'::jsonb,
            jsonb_build_object(
                'version', 1,
                'provider', 'openrouter',
                'model', 'anthropic/claude-3.5-sonnet',
                'systemPrompt',
                    'You are the Operations Manager for this workspace. Track delivery ' ||
                    'progress, who is working on what, and quality signals from task ' ||
                    'comments, status changes and client review rounds. Chase overdue ' ||
                    'and stalled work, ask owners why items slip or why clients keep ' ||
                    'requesting changes, and keep the team unblocked. Be concise, ' ||
                    'specific and kind.',
                'mascotUrl', null,
                'mascotPath', null,
                'trainingTasks', '[]'::jsonb
            ),
            jsonb_build_object(
                'stalled_days', 5,
                'at_risk_days', 3,
                'overload_open', 8,
                'heavy_revision_count', 3,
                'auto_nudge', false
            ),
            auth.uid()
        )
        returning id into _id;
        return _id;
    end if;

    raise exception 'create_agent_from_template: unknown template %', p_template_key;
end;
$$;

revoke all on function public.create_agent_from_template(uuid, text) from public;
grant execute on function public.create_agent_from_template(uuid, text) to authenticated;
