-- =============================================================================
-- Client portal — four things the app promised and did not deliver
-- =============================================================================
-- 1. 'update' shares never reached the client. The agency picks a PROJECT
--    COMMENT to share (client-modals.tsx) and the id was stored verbatim, but
--    client_project_overview joined app_client_portal_updates — a different
--    table from the older portal app, with a different id space. The join could
--    not match, so the agency saw the update in "what the client can see" and
--    the client saw nothing. Resolved against project_comments here: the
--    producer is the one telling the truth about what an update IS.
--
-- 2. An approval showed a title and a version number and nothing else, so
--    every sign-off was a blind signature. Each approval now carries its
--    subject — the post's copy and its images, the file, the task — and
--    client_approval_file serves those bytes through the same signed-URL
--    pattern as a shared file.
--
-- 3. A shared sheet was an inert row. client_sheet_for_share returns the
--    columns and rows of a custom sheet, read-only, projecting ONLY the
--    columns the sheet itself declares.
--
-- 4. Cross-tenant hardening. app_client_shares.ref_id carries no FK (it points
--    at five different tables), and the reads resolved it without checking the
--    referenced row belongs to the SAME team or project as the share. An
--    agency can insert its own share rows, so a hand-written ref_id naming
--    another workspace's task or file would have been served to that agency's
--    own client. Every ref join below is now scoped to the share's team and,
--    where the share picker offers nothing wider, to its project.
--
-- Additive and re-runnable: create or replace throughout, no drops.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Rich text (project comments, content copy) reaches the portal as plain text.
-- Doing it here rather than in the browser means no markup is ever IN the
-- payload, so a rendering mistake on the client side cannot turn an internal
-- comment's HTML into live markup on an outsider's screen.
create or replace function public.client_plain_text(
    p_html  text,
    p_limit integer default 4000
)
    returns text
    language sql
    immutable
    set search_path = pg_catalog
as
$$
    select case
        when p_html is null then null
        else left(
            btrim(regexp_replace(
                replace(replace(replace(replace(replace(replace(
                    regexp_replace(p_html, '<[^>]*>', ' ', 'g'),
                    '&nbsp;', ' '),
                    '&lt;', '<'),
                    '&gt;', '>'),
                    '&quot;', '"'),
                    '&#39;', ''''),
                    -- &amp; last: decoding it first would resurrect the
                    -- entities above out of "&amp;lt;".
                    '&amp;', '&'),
                '\s+', ' ', 'g')),
            greatest(coalesce(p_limit, 4000), 1))
    end;
$$;

-- The columns of a sheet an outsider may be shown, stripped to what a viewer
-- needs. Three kinds are dropped rather than rendered:
--   * hidden columns — the agency already said these are not for looking at;
--   * person / people — the values are team_members ids, i.e. who internally
--     owns a row, which is never the client's business;
--   * dynamicOptions columns — their values are ids resolved against internal
--     tables (statuses, members, campaigns); the portal has no way to resolve
--     them and printing raw uuids would be worse than leaving them out.
create or replace function public.client_sheet_columns(p_columns jsonb)
    returns jsonb
    language sql
    immutable
    set search_path = pg_catalog
as
$$
    select coalesce(jsonb_agg(jsonb_build_object(
               'id',       c->>'id',
               'label',    coalesce(nullif(c->>'label', ''), c->>'id'),
               'type',     coalesce(c->>'type', 'text'),
               'currency', c->>'currency',
               'options',  case when jsonb_typeof(c->'options') = 'array'
                                then c->'options' else '[]'::jsonb end
           ) order by ord), '[]'::jsonb)
      from jsonb_array_elements(
               case when jsonb_typeof(p_columns) = 'array'
                    then p_columns else '[]'::jsonb end
           ) with ordinality as t(c, ord)
     where c->>'id' is not null
       and (c->'hidden') is distinct from to_jsonb(true)
       and coalesce(c->>'type', 'text') not in ('person', 'people')
       and c->>'dynamicOptions' is null;
$$;


-- -----------------------------------------------------------------------------
-- The assets of a content item, numbered
-- -----------------------------------------------------------------------------
-- One definition of "the nth asset", used by the overview (to list them) and
-- by client_approval_file (to serve one). Two orderings that disagreed would
-- mean a client clicking image 2 and getting image 3.
create or replace function public.client_content_item_assets(p_item_id uuid)
    returns table (
        n            integer,
        file_id      uuid,
        name         text,
        mime         text,
        size_bytes   bigint,
        storage_path text,
        allow_download boolean
    )
    language sql
    stable
    set search_path = public, extensions
as
$$
    select row_number() over (order by a.sort_order, a.created_at, a.id)::integer,
           f.id, f.name, f.mime, f.size_bytes, f.storage_path, f.allow_download
      from public.app_content_studio_item_assets a
      join public.app_content_studio_items i on i.id = a.item_id
      join public.app_files_files f on f.id = a.file_id and f.team_id = i.team_id
     where a.item_id = p_item_id;
$$;


-- -----------------------------------------------------------------------------
-- client_project_overview — everything one project shows a client
-- -----------------------------------------------------------------------------
create or replace function public.client_project_overview(
    p_token      text,
    p_project_id uuid
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
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
$$;


-- -----------------------------------------------------------------------------
-- client_file_for_share — a shared file's storage path
-- -----------------------------------------------------------------------------
-- Replaced only to bound the file by the share's team: ref_id has no FK, so
-- without it an agency could have shared another workspace's file id with its
-- own client and this would have signed a URL for it.
create or replace function public.client_file_for_share(
    p_token    text,
    p_share_id uuid
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _s    record;
    _file record;
begin
    select * into _s from public.client_resolve_session(p_token);
    if _s.contact_id is null then
        return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
    end if;

    select f.id, f.name, f.mime, f.storage_path, f.allow_download, s.project_id
      into _file
      from public.app_client_shares s
      join public.app_client_project_access a
        on a.project_id = s.project_id and a.contact_id = _s.contact_id
      join public.app_files_files f
        on f.id = s.ref_id
       and f.team_id = s.team_id
       and (f.project_id = s.project_id or f.project_id is null)
     where s.id = p_share_id and s.kind = 'file' and s.team_id = _s.team_id;

    if _file.id is null or _file.storage_path is null then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    perform public.client_log_event(_s.team_id, _s.contact_id, _file.project_id,
                                    'view_file', jsonb_build_object('share_id', p_share_id));

    return jsonb_build_object(
        'ok', true, 'name', _file.name, 'mime', _file.mime,
        'storage_path', _file.storage_path,
        'allow_download', coalesce(_file.allow_download, true));
end;
$$;


-- -----------------------------------------------------------------------------
-- client_approval_file — the bytes behind an approval
-- -----------------------------------------------------------------------------
-- p_asset null  -> the approval's own subject, which must be a file.
-- p_asset n     -> the nth asset of a content item being approved.
-- Either way the caller names an APPROVAL, never a file: what may be served is
-- derived here from the approval's subject, so there is nothing to guess.
create or replace function public.client_approval_file(
    p_token       text,
    p_approval_id uuid,
    p_asset       integer default null
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _s    record;
    _ap   record;
    _file record;
begin
    select * into _s from public.client_resolve_session(p_token);
    if _s.contact_id is null then
        return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
    end if;

    -- The access row is the gate: an approval id from a project this contact
    -- was never given resolves to nothing, exactly like a wrong id.
    select ap.id, ap.team_id, ap.project_id, ap.subject_kind, ap.subject_id
      into _ap
      from public.app_client_approvals ap
      join public.app_client_project_access a
        on a.project_id = ap.project_id and a.contact_id = _s.contact_id
     where ap.id = p_approval_id and ap.team_id = _s.team_id;
    if _ap.id is null then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    if p_asset is null then
        if _ap.subject_kind <> 'file' then
            return jsonb_build_object('ok', false, 'reason', 'not_found');
        end if;
        select f.name, f.mime, f.storage_path, f.allow_download
          into _file
          from public.app_files_files f
         where f.id = _ap.subject_id
           and f.team_id = _ap.team_id
           and (f.project_id = _ap.project_id or f.project_id is null);
    else
        if _ap.subject_kind <> 'content_item' then
            return jsonb_build_object('ok', false, 'reason', 'not_found');
        end if;
        select a.name, a.mime, a.storage_path, a.allow_download
          into _file
          from public.app_content_studio_items i
          join public.client_content_item_assets(i.id) a on a.n = p_asset
         where i.id = _ap.subject_id
           and i.project_id = _ap.project_id
           and i.team_id = _ap.team_id;
    end if;

    if _file.storage_path is null then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    perform public.client_log_event(
        _s.team_id, _s.contact_id, _ap.project_id, 'view_approval_file',
        jsonb_build_object('approval_id', p_approval_id, 'asset', p_asset));

    return jsonb_build_object(
        'ok', true, 'name', _file.name, 'mime', _file.mime,
        'storage_path', _file.storage_path,
        -- Work sent for sign-off is watched, not collected: the file's own
        -- download flag still decides, same as a shared file.
        'allow_download', coalesce(_file.allow_download, true));
end;
$$;


-- -----------------------------------------------------------------------------
-- client_sheet_for_share — a shared sheet, read-only
-- -----------------------------------------------------------------------------
-- Only the sheet's declared, visible columns are projected out of each row's
-- jsonb: a custom sheet's `data` can hold keys from a column that was deleted
-- or from a Google sync, and none of those was ever put in front of a client.
create or replace function public.client_sheet_for_share(
    p_token    text,
    p_share_id uuid,
    p_limit    integer default 200,
    p_offset   integer default 0
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _s       record;
    _sheet   record;
    _columns jsonb;
    _rows    jsonb;
    _total   bigint;
    _limit   integer := least(greatest(coalesce(p_limit, 200), 1), 500);
    _offset  integer := greatest(coalesce(p_offset, 0), 0);
begin
    select * into _s from public.client_resolve_session(p_token);
    if _s.contact_id is null then
        return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
    end if;

    select sh.id, sh.name, sh.description, sh.source, sh.columns, sh.team_id,
           s.project_id
      into _sheet
      from public.app_client_shares s
      join public.app_client_project_access a
        on a.project_id = s.project_id and a.contact_id = _s.contact_id
      join public.app_sheets sh
        on sh.id = s.ref_id
       and sh.team_id = s.team_id
       and (sh.project_id = s.project_id or sh.project_id is null)
     where s.id = p_share_id and s.kind = 'sheet' and s.team_id = _s.team_id
       and sh.archived is not true;
    if _sheet.id is null then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    if _sheet.source <> 'custom' then
        -- Honest, not silent: the portal tells the client this sheet is a live
        -- view of the team's own data rather than showing an empty grid.
        return jsonb_build_object('ok', false, 'reason', 'not_viewable',
                                  'name', _sheet.name);
    end if;

    _columns := public.client_sheet_columns(_sheet.columns);

    select count(*) into _total
      from public.app_sheet_rows r
     where r.sheet_id = _sheet.id and r.team_id = _sheet.team_id;

    select coalesce(jsonb_agg(page.values order by page.ord), '[]'::jsonb)
      into _rows
      from (
          select row_number() over (order by r.position, r.created_at, r.id) as ord,
                 coalesce((
                     select jsonb_object_agg(col->>'id', coalesce(r.data->(col->>'id'), 'null'::jsonb))
                       from jsonb_array_elements(_columns) col
                 ), '{}'::jsonb) as values
            from public.app_sheet_rows r
           where r.sheet_id = _sheet.id and r.team_id = _sheet.team_id
           order by r.position, r.created_at, r.id
           offset _offset
           limit _limit
      ) page;

    perform public.client_log_event(
        _s.team_id, _s.contact_id, _sheet.project_id, 'view_sheet',
        jsonb_build_object('share_id', p_share_id));

    return jsonb_build_object(
        'ok', true,
        'name', _sheet.name,
        'description', _sheet.description,
        'columns', _columns,
        'rows', _rows,
        'total', _total,
        'offset', _offset,
        'limit', _limit);
end;
$$;


-- -----------------------------------------------------------------------------
-- Grants — the portal RPCs are service_role only, as the rest of the app is
-- -----------------------------------------------------------------------------
-- Nothing here is callable by `anon` or `authenticated`: a client's browser
-- never reaches PostgREST, it reaches /api/client/**, and the service-role key
-- stays on the server.
revoke all on function public.client_plain_text(text, integer) from public, anon, authenticated;
revoke all on function public.client_sheet_columns(jsonb) from public, anon, authenticated;
revoke all on function public.client_content_item_assets(uuid) from public, anon, authenticated;
revoke all on function public.client_approval_file(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.client_sheet_for_share(text, uuid, integer, integer) from public, anon, authenticated;

grant execute on function public.client_plain_text(text, integer) to service_role;
grant execute on function public.client_sheet_columns(jsonb) to service_role;
grant execute on function public.client_content_item_assets(uuid) to service_role;
grant execute on function public.client_approval_file(text, uuid, integer) to service_role;
grant execute on function public.client_sheet_for_share(text, uuid, integer, integer) to service_role;

-- Re-asserted because `create or replace` on an existing function does not
-- reset privileges, but a fresh database creates these two here for the first
-- time with the default "executable by public".
revoke all on function public.client_project_overview(text, uuid) from public, anon, authenticated;
revoke all on function public.client_file_for_share(text, uuid) from public, anon, authenticated;
grant execute on function public.client_project_overview(text, uuid) to service_role;
grant execute on function public.client_file_for_share(text, uuid) to service_role;
