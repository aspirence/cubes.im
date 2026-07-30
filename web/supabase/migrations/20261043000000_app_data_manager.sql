-- =============================================================================
-- Cubes — Data Manager app (backup / restore / clear workspace data)
-- =============================================================================
-- The Data Manager app is stateless (no app_data_manager_* tables): backups are
-- generated client-side from RLS-guarded reads and imports replay through the
-- same RPCs the app uses (create_project / create_task). Only the destructive
-- path needs server-side power — and a STRICTER gate than everything else:
--
--   * is_team_owner(_team_id): true only for members whose role is flagged
--     `owner` (is_team_admin also accepts admin_role — not good enough here).
--   * clear_team_data(p_team_id): SECURITY DEFINER wipe of the workspace's
--     work-management data. Projects cascade to tasks/statuses/comments/
--     attachments/automations/app rows; folders, labels, clients, and
--     templates are team-scoped and deleted explicitly.

-- is_team_owner: true only when the caller's active membership in _team_id has
-- the Owner role (r.owner). Mirrors is_team_admin but without admin_role.
create or replace function public.is_team_owner(_team_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.team_members tm
        join public.roles r on r.id = tm.role_id
        where tm.team_id = _team_id
          and tm.user_id = auth.uid()
          and tm.active is true
          and r.owner is true
    );
$$;

revoke all on function public.is_team_owner(uuid) from public, anon;
grant execute on function public.is_team_owner(uuid) to authenticated;

-- clear_team_data: wipe the workspace's work data. Owner-only; returns a jsonb
-- summary of what was deleted so the UI can report it.
create or replace function public.clear_team_data(p_team_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    _projects  int;
    _folders   int;
    _labels    int;
    _clients   int;
    _templates int;
begin
    if not public.is_team_owner(p_team_id) then
        raise exception 'forbidden: only the workspace owner can clear workspace data';
    end if;

    -- Projects cascade to tasks, statuses, assignees, labels-joins, comments,
    -- attachments, views, automations, and per-project app rows.
    with gone as (
        delete from public.projects where team_id = p_team_id returning 1
    )
    select count(*) into _projects from gone;

    with gone as (
        delete from public.project_folders where team_id = p_team_id returning 1
    )
    select count(*) into _folders from gone;

    with gone as (
        delete from public.team_labels where team_id = p_team_id returning 1
    )
    select count(*) into _labels from gone;

    with gone as (
        delete from public.clients where team_id = p_team_id returning 1
    )
    select count(*) into _clients from gone;

    with a as (
        delete from public.project_templates where team_id = p_team_id returning 1
    ), b as (
        delete from public.task_templates where team_id = p_team_id returning 1
    ), c as (
        delete from public.status_templates where team_id = p_team_id returning 1
    )
    select (select count(*) from a) + (select count(*) from b) + (select count(*) from c)
      into _templates;

    return jsonb_build_object(
        'projects', _projects,
        'folders', _folders,
        'labels', _labels,
        'clients', _clients,
        'templates', _templates
    );
end;
$$;

revoke all on function public.clear_team_data(uuid) from public, anon;
grant execute on function public.clear_team_data(uuid) to authenticated;
