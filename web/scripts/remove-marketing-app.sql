-- One-off cleanup for the dev database: the Marketing app is removed from
-- the product (2026-09-28). Prod never received any marketing migration, so
-- this only ever runs against dev. Single transaction; re-runnable.
--
--   psql "$SUPABASE_DB_URL" -X -1 -v ON_ERROR_STOP=1 -f scripts/remove-marketing-app.sql

-- 1. Workflows built on Marketing actions or events, with their steps/runs.
delete from public.workflows w
 where (w.trigger_type = 'event' and coalesce(w.trigger_config ->> 'event_key', '') like 'marketing.%')
    or exists (select 1 from public.workflow_steps s where s.workflow_id = w.id and s.config ->> 'action' like 'marketing.%');
delete from public.workflow_events where key like 'marketing.%';

-- 2. Data that pointed at the app.
delete from public.app_client_shares where kind = 'funnel';
delete from public.app_sheets where source in ('marketing_insights', 'marketing_campaigns');
delete from public.app_sheet_templates where source in ('marketing_insights', 'marketing_campaigns');
delete from public.app_crm_campaign_spend where source = 'meta';
delete from public.project_views where view_key = 'marketing';
delete from public.installed_apps where app_key = 'marketing';

-- 3. Functions that read the app's tables, restored to their pre-marketing shape.
create or replace function public.crm_accrue_campaign_spend()
    returns integer
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _created integer;
begin
    insert into public.app_crm_campaign_spend
        (team_id, campaign_id, spend_on, amount, source, note)
    select
        c.team_id,
        c.id,
        current_date,
        c.daily_budget,
        'budget',
        'Daily budget'
    from public.app_crm_campaigns c
    where c.deleted_at is null
      and c.status = 'active'
      and c.daily_budget is not null
      and c.daily_budget > 0
      and (c.started_on is null or c.started_on <= current_date)
      and (c.ended_on   is null or c.ended_on   >= current_date)
    on conflict (campaign_id, spend_on) do nothing;

    get diagnostics _created = row_count;
    return _created;
end;
$$;

revoke all on function public.crm_accrue_campaign_spend() from public;
grant execute on function public.crm_accrue_campaign_spend() to service_role;

CREATE OR REPLACE FUNCTION public.client_project_overview(p_token text, p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
    _s         record;
    _access    record;
    _project   record;
    _tasks     jsonb;
    _files     jsonb;
    _sheets    jsonb;
    _updates   jsonb;
    _approvals jsonb;
    _requests  jsonb;
    _can_approve boolean;
begin
    select * into _s from public.client_resolve_session(p_token);
    if _s.contact_id is null then
        return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
    end if;

    select a.can_request, a.can_approve
      into _access
      from public.app_client_project_access a
     where a.contact_id = _s.contact_id and a.project_id = p_project_id;
    if _access is null or _access.can_request is null then
        -- Not shared with this contact: same answer as "no such project".
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    select p.id, p.name, p.color_code, p.start_date, p.end_date, cl.name as client_name
      into _project
      from public.projects p
      left join public.clients cl on cl.id = p.client_id
     where p.id = p_project_id and p.team_id = _s.team_id;
    if _project.id is null then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    -- Approving is its own permission: the role OR the per-project flag.
    _can_approve := coalesce(_access.can_approve, false)
                    or _s.role in ('approver', 'manager');

    -- Shared tasks. Name, status and due date only — no description, no
    -- assignee, no estimate, no comments, no time. The project check is not
    -- redundant with the share's own project_id: ref_id has no FK, so it is
    -- the only thing stopping a hand-written share from naming a task that
    -- lives somewhere else entirely.
    select coalesce(jsonb_agg(jsonb_build_object(
               'share_id', s.id,
               'task_id', t.id,
               'name', t.name,
               'status', st.name,
               'status_color', cat.color_code,
               'done', t.done,
               'end_date', t.end_date
           ) order by t.name), '[]'::jsonb)
      into _tasks
      from public.app_client_shares s
      join public.tasks t on t.id = s.ref_id and t.project_id = s.project_id
      left join public.task_statuses st on st.id = t.status_id
      left join public.sys_task_status_categories cat on cat.id = st.category_id
     where s.project_id = p_project_id and s.kind = 'task'
       and t.archived is not true;

    -- A file may be filed under the project or loose in the workspace — the
    -- share picker offers exactly those two — so anything belonging to another
    -- project is not something this agency chose to share here.
    select coalesce(jsonb_agg(jsonb_build_object(
               'share_id', s.id,
               'file_id', f.id,
               'name', f.name,
               'mime', f.mime,
               'size_bytes', f.size_bytes,
               'created_at', f.created_at
           ) order by f.created_at desc), '[]'::jsonb)
      into _files
      from public.app_client_shares s
      join public.app_files_files f
        on f.id = s.ref_id
       and f.team_id = s.team_id
       and (f.project_id = s.project_id or f.project_id is null)
     where s.project_id = p_project_id and s.kind = 'file';

    -- Sheets say up front whether the portal can actually open them. Only a
    -- custom sheet keeps its rows in app_sheet_rows; every other source is a
    -- live view of internal data (tasks, ad insights, content items) assembled
    -- by the app's own adapters, and there is no honest read-only rendering of
    -- those for an outsider — so the portal says so instead of showing a row
    -- that does nothing.
    select coalesce(jsonb_agg(jsonb_build_object(
               'share_id', s.id,
               'name', sh.name,
               'description', sh.description,
               'viewable', sh.source = 'custom',
               'columns', jsonb_array_length(public.client_sheet_columns(sh.columns)),
               'rows', case when sh.source = 'custom'
                            then (select count(*) from public.app_sheet_rows r
                                   where r.sheet_id = sh.id and r.team_id = sh.team_id)
                            else null end
           ) order by sh.name), '[]'::jsonb)
      into _sheets
      from public.app_client_shares s
      join public.app_sheets sh
        on sh.id = s.ref_id
       and sh.team_id = s.team_id
       and (sh.project_id = s.project_id or sh.project_id is null)
     where s.project_id = p_project_id and s.kind = 'sheet'
       and sh.archived is not true;

    -- An "update" is a project comment the agency deliberately picked out.
    -- The title is the snapshot taken at share time, so an edited comment
    -- still reads under the heading the agency chose; the body is the comment
    -- as plain text. Author, mentions and every other comment on the project
    -- stay where they are.
    select coalesce(jsonb_agg(jsonb_build_object(
               'share_id', s.id,
               'title', s.title,
               'body', public.client_plain_text(c.content, 8000),
               'created_at', c.created_at
           ) order by c.created_at desc), '[]'::jsonb)
      into _updates
      from public.app_client_shares s
      join public.project_comments c
        on c.id = s.ref_id and c.project_id = s.project_id
     where s.project_id = p_project_id and s.kind = 'update';

    -- Approvals carry their subject. A client signing off "Diwali reel v3"
    -- needs the copy, the artwork and the schedule in front of them, not a
    -- filename — and an approval whose subject has since been deleted says so
    -- by carrying a null subject rather than pretending.
    --
    -- Assets travel as an ORDINAL, not a file id: the bytes come back from
    -- client_approval_file, which re-derives the nth asset of this approval's
    -- own subject, so a guessed number can only ever address something this
    -- contact was already shown.
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', ap.id,
               'subject_kind', ap.subject_kind,
               'subject_id', ap.subject_id,
               'version', ap.version,
               'title', ap.title,
               'note', ap.note,
               'state', ap.state,
               'requested_at', ap.requested_at,
               'decided_at', ap.decided_at,
               'decision_note', ap.decision_note,
               'decided_by_me', ap.decided_by_contact = _s.contact_id,
               'can_decide', _can_approve and ap.state = 'pending',
               'subject', subject.payload
           ) order by ap.requested_at desc), '[]'::jsonb)
      into _approvals
      from public.app_client_approvals ap
      left join lateral (
          select case ap.subject_kind
              when 'task' then (
                  select jsonb_build_object(
                             'kind', 'task',
                             'name', t.name,
                             'status', st.name,
                             'done', t.done,
                             'end_date', t.end_date)
                    from public.tasks t
                    left join public.task_statuses st on st.id = t.status_id
                   where t.id = ap.subject_id
                     and t.project_id = ap.project_id
                     and t.archived is not true)
              when 'file' then (
                  select jsonb_build_object(
                             'kind', 'file',
                             'name', f.name,
                             'mime', f.mime,
                             'size_bytes', f.size_bytes)
                    from public.app_files_files f
                   where f.id = ap.subject_id
                     and f.team_id = ap.team_id
                     and (f.project_id = ap.project_id or f.project_id is null))
              when 'content_item' then (
                  select jsonb_build_object(
                             'kind', 'content_item',
                             'title', i.title,
                             'body', public.client_plain_text(i.body, 8000),
                             'content_type', i.content_type,
                             'scheduled_for', i.scheduled_for,
                             'assets', coalesce((
                                 select jsonb_agg(jsonb_build_object(
                                            'n', a.n,
                                            'name', a.name,
                                            'mime', a.mime,
                                            'size_bytes', a.size_bytes)
                                        order by a.n)
                                   from public.client_content_item_assets(i.id) a), '[]'::jsonb))
                    from public.app_content_studio_items i
                   where i.id = ap.subject_id
                     and i.project_id = ap.project_id
                     and i.team_id = ap.team_id)
              when 'video_review' then (
                  -- Title and round only. A review's stage, editor and
                  -- internal comments are the agency's production process.
                  select jsonb_build_object(
                             'kind', 'video_review',
                             'title', v.title,
                             'revision', v.latest_revision)
                    from public.app_video_review_videos v
                   where v.id = ap.subject_id
                     and v.project_id = ap.project_id
                     and v.team_id = ap.team_id
                     and v.deleted is not true)
              else null
          end as payload
      ) subject on true
     where ap.project_id = p_project_id;

    -- Only this contact's own requests. Another contact's intake is another
    -- client's business, even inside the same project.
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'title', r.title, 'details', r.details,
               'request_type', r.request_type, 'priority', r.priority,
               'status', r.status, 'due_by', r.due_by,
               'created_at', r.created_at, 'decided_at', r.decided_at,
               'decision_note', r.decision_note,
               -- Whether it became work, never which task or who owns it.
               'accepted', r.task_id is not null
           ) order by r.created_at desc), '[]'::jsonb)
      into _requests
      from public.app_client_requests r
     where r.project_id = p_project_id and r.contact_id = _s.contact_id;

    perform public.client_log_event(_s.team_id, _s.contact_id, p_project_id,
                                    'view_project', '{}'::jsonb);

    return jsonb_build_object(
        'ok', true,
        'project', jsonb_build_object(
            'id', _project.id, 'name', _project.name,
            'color_code', _project.color_code, 'client_name', _project.client_name,
            'start_date', _project.start_date, 'end_date', _project.end_date),
        'permissions', jsonb_build_object(
            'can_request', coalesce(_access.can_request, false),
            'can_approve', _can_approve),
        'tasks', _tasks, 'files', _files, 'sheets', _sheets,
        'updates', _updates,
        'approvals', _approvals, 'requests', _requests
    );
end;
$function$
;

-- 4. The app's own tables first (their policies depend on the functions),
--    then the functions; cascade covers whatever still hangs off them.
drop table if exists public.app_marketing_leads cascade;
drop table if exists public.app_marketing_funnel_campaigns cascade;
drop table if exists public.app_marketing_funnel_accounts cascade;
drop table if exists public.app_marketing_funnel_stages cascade;
drop table if exists public.app_marketing_funnels cascade;
drop table if exists public.app_marketing_insights cascade;
drop table if exists public.app_marketing_objects cascade;
drop table if exists public.app_marketing_sync_runs cascade;
drop table if exists public.app_marketing_ad_account_secrets cascade;
drop table if exists public.app_marketing_ad_accounts cascade;
drop function if exists public.marketing_push_crm_spend(uuid, integer) cascade;
drop function if exists public.marketing_link_crm_campaign(uuid, uuid) cascade;
drop function if exists public.marketing_funnel_metrics(uuid, date, date) cascade;
drop function if exists public.marketing_funnel_emit_target_misses(uuid, integer) cascade;
drop function if exists public.marketing_funnel_seed_stages(uuid) cascade;
drop function if exists public.marketing_funnel_can_access(uuid) cascade;
drop function if exists public.marketing_funnel_campaign_link_account() cascade;
drop function if exists public.marketing_funnel_campaign_parent() cascade;
drop function if exists public.marketing_funnel_service_call() cascade;
drop function if exists public.marketing_funnel_stage_team() cascade;

-- 5. Check constraints back to their pre-marketing sets.
alter table public.app_crm_campaign_spend drop constraint if exists app_crm_campaign_spend_source_check;
alter table public.app_crm_campaign_spend add constraint app_crm_campaign_spend_source_check check (source in ('manual', 'budget'));
alter table public.app_sheets drop constraint if exists app_sheets_source_check;
alter table public.app_sheets add constraint app_sheets_source_check check (source in ('custom', 'tasks', 'content_studio_items'));
alter table public.app_sheet_templates drop constraint if exists app_sheet_templates_source_check;
alter table public.app_sheet_templates add constraint app_sheet_templates_source_check check (source in ('custom', 'tasks', 'content_studio_items'));
alter table public.app_client_shares drop constraint if exists app_client_shares_kind_check;
alter table public.app_client_shares add constraint app_client_shares_kind_check check (kind in ('task', 'file', 'sheet', 'update'));

-- 6. The migration ledger: the files are gone from the repo too.
delete from supabase_migrations.schema_migrations where version in ('20261130000000', '20261131000000', '20261138000000', '20261145000000');
