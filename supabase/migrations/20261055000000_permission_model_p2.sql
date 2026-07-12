-- ============================================================================
-- Permission model — Phase 2 (enforcement).
--
-- Wires the tiers + capabilities from Phase 1 into the RLS gates. Safe for the
-- current data set: no guest/limited members exist yet, and member capability
-- defaults reproduce today's behaviour — so existing owners/admins/members are
-- unaffected. What changes going forward:
--   * guests get NO team-wide access (portal/project grants only),
--   * limited members are scoped to projects they're explicitly added to,
--   * a project's ADMIN/PROJECT_MANAGER member can manage that project,
--   * member/limited write capabilities are gated by member_can() so the
--     Settings > Permissions toggles actually restrict.
-- ============================================================================

-- 1) Guests are not "team members" for team-wide visibility. Their access flows
--    only through explicit project_members grants / the client portal. Every
--    is_team_member()-gated policy inherits this automatically.
create or replace function public.is_team_member(_team_id uuid)
    returns boolean
    language sql stable security definer set search_path = public
as
$$
    select exists (
        select 1
        from public.team_members tm
        where tm.team_id = _team_id
          and tm.user_id = auth.uid()
          and tm.active is true
          and tm.member_type <> 'guest'
    );
$$;

-- 2) Limited members only reach projects they're a member of (or own / admin),
--    even for team-visibility projects — same shape as a private project.
create or replace function public.can_access_project(
    _project_id uuid,
    _team_id    uuid,
    _visibility text,
    _owner_id   uuid
)
    returns boolean
    language sql stable security definer set search_path = public
as
$$
    select
        (_visibility <> 'private'
            and public.team_member_type(_team_id) is distinct from 'limited')
        or _owner_id = auth.uid()
        or public.is_project_member(_project_id)
        or public.is_team_admin(_team_id);
$$;

-- 3) Activate project-level access levels: a project member holding the ADMIN or
--    PROJECT_MANAGER access level is a project admin (can manage that project's
--    members/phases/views/automations) — in addition to team admins and the
--    project owner. This is additive (grants more), enabling project-level
--    permission management by a member.
create or replace function public.is_project_team_admin(_project_id uuid)
    returns boolean
    language sql stable security definer set search_path = public
as
$$
    select public.is_team_admin(public.team_id_of_project(_project_id))
        or exists (
            select 1 from public.projects p
            where p.id = _project_id and p.owner_id = auth.uid()
        )
        or exists (
            select 1
            from public.project_members pm
            join public.team_members tm on tm.id = pm.team_member_id
            join public.project_access_levels pal on pal.id = pm.project_access_level_id
            where pm.project_id = _project_id
              and tm.user_id = auth.uid()
              and tm.active is true
              and pal.key in ('ADMIN', 'PROJECT_MANAGER')
        );
$$;

-- 4) Capability gates on the broad "any member" write surfaces. member_can()
--    returns owner/admin=allow, guest=deny, member/limited=override-else-default;
--    the seeded defaults (create_projects/manage_labels/manage_templates = true
--    for members) preserve current member behaviour, while the Settings toggles
--    now bite. Invite gains an OR path so a member with the capability can invite.

-- projects: create
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
    for insert to authenticated
    with check (public.member_can(team_id, 'create_projects'));

-- team_labels: manage
drop policy if exists team_labels_insert on public.team_labels;
create policy team_labels_insert on public.team_labels
    for insert to authenticated
    with check (public.member_can(team_id, 'manage_labels'));
drop policy if exists team_labels_update on public.team_labels;
create policy team_labels_update on public.team_labels
    for update to authenticated
    using (public.member_can(team_id, 'manage_labels'))
    with check (public.member_can(team_id, 'manage_labels'));
drop policy if exists team_labels_delete on public.team_labels;
create policy team_labels_delete on public.team_labels
    for delete to authenticated
    using (public.member_can(team_id, 'manage_labels'));

-- task_templates: manage
drop policy if exists task_templates_insert on public.task_templates;
create policy task_templates_insert on public.task_templates
    for insert to authenticated
    with check (public.member_can(team_id, 'manage_templates'));
drop policy if exists task_templates_update on public.task_templates;
create policy task_templates_update on public.task_templates
    for update to authenticated
    using (public.member_can(team_id, 'manage_templates'))
    with check (public.member_can(team_id, 'manage_templates'));
drop policy if exists task_templates_delete on public.task_templates;
create policy task_templates_delete on public.task_templates
    for delete to authenticated
    using (public.member_can(team_id, 'manage_templates'));

-- project_templates: manage
drop policy if exists project_templates_insert on public.project_templates;
create policy project_templates_insert on public.project_templates
    for insert to authenticated
    with check (public.member_can(team_id, 'manage_templates'));
drop policy if exists project_templates_update on public.project_templates;
create policy project_templates_update on public.project_templates
    for update to authenticated
    using (public.member_can(team_id, 'manage_templates'))
    with check (public.member_can(team_id, 'manage_templates'));
drop policy if exists project_templates_delete on public.project_templates;
create policy project_templates_delete on public.project_templates
    for delete to authenticated
    using (public.member_can(team_id, 'manage_templates'));

-- email_invitations: admins always; members with the invite capability too.
drop policy if exists email_invitations_insert on public.email_invitations;
create policy email_invitations_insert on public.email_invitations
    for insert to authenticated
    with check (
        public.is_team_admin(team_id)
        or public.member_can(team_id, 'invite_members')
    );
