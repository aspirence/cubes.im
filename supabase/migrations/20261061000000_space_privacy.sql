-- =============================================================================
-- Space (folder) privacy — ClickUp-style shared / private Spaces.
-- =============================================================================
-- Until now every project_folder (Space) was visible to every team member.
-- This mirrors the project sharing model (20261010) onto Spaces so a Space can
-- be:
--   * 'team'    (default) — every FULL member of the team sees it (the old
--                behavior). Guests never see Spaces; limited members only see
--                Spaces they're explicitly added to.
--   * 'private' — only the Space's members, its creator, and team admins/owner.
--
-- The guarantee the product wants: a member who joins a workspace does NOT
-- automatically get dropped into every Space — they see only Spaces shared with
-- the whole team plus private Spaces they're explicitly added to, and only the
-- projects inside those they're permitted to see. Space privacy CASCADES to the
-- projects inside it: a team-visible project sitting in a private Space is
-- hidden from anyone who can't see the Space.
--
-- Enforcement is centralized, same as project sharing:
--   * project_folders_select delegates to can_access_space(id).
--   * can_access_project() additionally requires the project's Space be
--     accessible, so every project-scoped table (which routes through
--     is_project_team_member / projects_select) inherits the cascade with no
--     per-table policy change.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
alter table public.project_folders
    add column if not exists visibility text default 'team' not null
        constraint project_folders_visibility_check
            check (visibility in ('team', 'private'));

-- -----------------------------------------------------------------------------
-- 2. space_members — explicit membership for a (usually private) Space
-- -----------------------------------------------------------------------------
create table if not exists public.space_members (
    id             uuid default gen_random_uuid() not null,
    folder_id      uuid not null,
    team_member_id uuid not null,
    role           text not null default 'member'
                       constraint space_members_role_check
                           check (role in ('member', 'admin')),
    added_by       uuid,
    created_at     timestamp with time zone default now() not null,
    constraint space_members_pk primary key (id),
    constraint space_members_folder_fk
        foreign key (folder_id) references public.project_folders (id) on delete cascade,
    constraint space_members_team_member_fk
        foreign key (team_member_id) references public.team_members (id) on delete cascade,
    constraint space_members_added_by_fk
        foreign key (added_by) references public.users (id),
    constraint space_members_unique unique (folder_id, team_member_id)
);

create index if not exists space_members_folder_idx
    on public.space_members (folder_id);
create index if not exists space_members_team_member_idx
    on public.space_members (team_member_id);

-- -----------------------------------------------------------------------------
-- 3. Access helpers (SECURITY DEFINER, pinned search_path — read membership
--    tables with RLS bypassed to avoid policy recursion).
-- -----------------------------------------------------------------------------

-- caller is an explicit member of the Space
create or replace function public.is_space_member(_folder_id uuid)
    returns boolean
    language sql stable security definer set search_path = public
as
$$
    select exists (
        select 1
        from public.space_members sm
        join public.team_members tm on tm.id = sm.team_member_id
        where sm.folder_id = _folder_id
          and tm.user_id = auth.uid()
    );
$$;

revoke all on function public.is_space_member(uuid) from public;
grant execute on function public.is_space_member(uuid) to authenticated;

-- caller may manage the Space (team admin/owner, or a Space member with the
-- 'admin' role).
create or replace function public.is_space_admin(_folder_id uuid)
    returns boolean
    language sql stable security definer set search_path = public
as
$$
    select
        public.is_team_admin((select f.team_id from public.project_folders f
                              where f.id = _folder_id))
        or exists (
            select 1
            from public.space_members sm
            join public.team_members tm on tm.id = sm.team_member_id
            where sm.folder_id = _folder_id
              and tm.user_id = auth.uid()
              and sm.role = 'admin'
        );
$$;

revoke all on function public.is_space_admin(uuid) from public;
grant execute on function public.is_space_admin(uuid) to authenticated;

-- the visibility predicate for a Space. Team-visible Spaces are open to full
-- members (never guests, never limited); private Spaces only to the creator,
-- explicit Space members, and team admins/owner.
create or replace function public.can_access_space(_folder_id uuid)
    returns boolean
    language sql stable security definer set search_path = public
as
$$
    select exists (
        select 1
        from public.project_folders f
        where f.id = _folder_id
          and public.is_team_member(f.team_id)          -- excludes guests
          and (
                f.created_by = auth.uid()
                or public.is_team_admin(f.team_id)
                or public.is_space_member(f.id)
                or (f.visibility <> 'private'
                    and public.team_member_type(f.team_id) is distinct from 'limited')
              )
    );
$$;

revoke all on function public.can_access_space(uuid) from public;
grant execute on function public.can_access_space(uuid) to authenticated;

-- true when the project's Space (if any) is accessible to the caller; projects
-- with no Space are top-level and always pass this gate.
create or replace function public.project_space_accessible(_project_id uuid)
    returns boolean
    language sql stable security definer set search_path = public
as
$$
    select coalesce(
        (select public.can_access_space(p.folder_id)
           from public.projects p
          where p.id = _project_id and p.folder_id is not null),
        true
    );
$$;

revoke all on function public.project_space_accessible(uuid) from public;
grant execute on function public.project_space_accessible(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. can_access_project — compose Space privacy on top of project visibility
-- -----------------------------------------------------------------------------
-- Owner / explicit project members / team admins always pass (being added to a
-- project grants access regardless of its Space). Otherwise a team-visible
-- project is visible only when the caller is a non-limited member AND can see
-- the containing Space. Signature preserved from 20261010 / 20261055.
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
        _owner_id = auth.uid()
        or public.is_project_member(_project_id)
        or public.is_team_admin(_team_id)
        or (
              _visibility <> 'private'
              and public.team_member_type(_team_id) is distinct from 'limited'
              and public.project_space_accessible(_project_id)
           );
$$;

revoke all on function public.can_access_project(uuid, uuid, text, uuid) from public;
grant execute on function public.can_access_project(uuid, uuid, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------
-- project_folders: members read only Spaces they can access (was: any team
-- member). Writes stay admin-only (unchanged from Phase 3), so keep those
-- policies as they are and only re-home the SELECT policy.
drop policy if exists project_folders_select on public.project_folders;
create policy project_folders_select on public.project_folders
    for select to authenticated
    using (public.can_access_space(id));

alter table public.space_members enable row level security;

-- Read the roster of any Space you can see.
drop policy if exists space_members_select on public.space_members;
create policy space_members_select on public.space_members
    for select to authenticated
    using (public.can_access_space(folder_id));

-- Writes go through the SECURITY DEFINER RPCs below only.
revoke insert, update, delete on public.space_members from authenticated;
revoke insert, update, delete on public.space_members from anon;
grant select on public.space_members to authenticated;
grant all on public.space_members to service_role;

-- -----------------------------------------------------------------------------
-- 6. Management RPCs (SECURITY DEFINER; gated on is_space_admin)
-- -----------------------------------------------------------------------------

-- Flip a Space between 'team' and 'private'. Making it private auto-enrolls the
-- creator as a Space admin so they never lose access to their own Space.
create or replace function public.set_space_visibility(
    p_folder_id uuid,
    p_visibility text
)
    returns void
    language plpgsql security definer set search_path = public, extensions
as
$$
declare
    _folder public.project_folders%rowtype;
    _tm     uuid;
begin
    select * into _folder from public.project_folders where id = p_folder_id;
    if not found then
        raise exception 'set_space_visibility: space % not found', p_folder_id;
    end if;
    if not public.is_space_admin(p_folder_id) then
        raise exception 'set_space_visibility: not permitted';
    end if;
    if p_visibility not in ('team', 'private') then
        raise exception 'set_space_visibility: invalid visibility %', p_visibility;
    end if;

    update public.project_folders set visibility = p_visibility, updated_at = now()
    where id = p_folder_id;

    if p_visibility = 'private' then
        select tm.id into _tm
        from public.team_members tm
        where tm.team_id = _folder.team_id
          and tm.user_id = _folder.created_by
          and tm.active is true
        limit 1;
        if _tm is not null then
            insert into public.space_members (folder_id, team_member_id, role, added_by)
            values (p_folder_id, _tm, 'admin', auth.uid())
            on conflict (folder_id, team_member_id)
                do update set role = 'admin';
        end if;
    end if;
end;
$$;

revoke all on function public.set_space_visibility(uuid, text) from public;
grant execute on function public.set_space_visibility(uuid, text) to authenticated;

-- Add (or re-role) a team member on a Space. The team member must belong to the
-- Space's team.
create or replace function public.add_space_member(
    p_folder_id uuid,
    p_team_member_id uuid,
    p_role text default 'member'
)
    returns uuid
    language plpgsql security definer set search_path = public, extensions
as
$$
declare
    _team_id uuid;
    _id      uuid;
begin
    select f.team_id into _team_id from public.project_folders f where f.id = p_folder_id;
    if _team_id is null then
        raise exception 'add_space_member: space % not found', p_folder_id;
    end if;
    if not public.is_space_admin(p_folder_id) then
        raise exception 'add_space_member: not permitted';
    end if;
    if p_role not in ('member', 'admin') then
        raise exception 'add_space_member: invalid role %', p_role;
    end if;
    if not exists (
        select 1 from public.team_members tm
        where tm.id = p_team_member_id and tm.team_id = _team_id
    ) then
        raise exception 'add_space_member: member % is not on this team', p_team_member_id;
    end if;

    insert into public.space_members (folder_id, team_member_id, role, added_by)
    values (p_folder_id, p_team_member_id, p_role, auth.uid())
    on conflict (folder_id, team_member_id) do update set role = excluded.role
    returning id into _id;

    return _id;
end;
$$;

revoke all on function public.add_space_member(uuid, uuid, text) from public;
grant execute on function public.add_space_member(uuid, uuid, text) to authenticated;

-- Remove a team member from a Space.
create or replace function public.remove_space_member(
    p_folder_id uuid,
    p_team_member_id uuid
)
    returns void
    language plpgsql security definer set search_path = public, extensions
as
$$
begin
    if not public.is_space_admin(p_folder_id) then
        raise exception 'remove_space_member: not permitted';
    end if;
    delete from public.space_members
    where folder_id = p_folder_id and team_member_id = p_team_member_id;
end;
$$;

revoke all on function public.remove_space_member(uuid, uuid) from public;
grant execute on function public.remove_space_member(uuid, uuid) to authenticated;

-- Create a Space in one shot: name (+ optional parent/color), initial
-- visibility, and — for a private Space — the members to seed it with. Admin
-- only (mirrors the project_folders INSERT policy). Returns the new Space id.
create or replace function public.create_space(
    p_team_id uuid,
    p_name text,
    p_visibility text default 'team',
    p_parent_folder_id uuid default null,
    p_color_code text default null,
    p_member_ids uuid[] default '{}'
)
    returns uuid
    language plpgsql security definer set search_path = public, extensions
as
$$
declare
    _id  uuid;
    _mid uuid;
begin
    if not public.is_team_admin(p_team_id) then
        raise exception 'create_space: not permitted';
    end if;
    if coalesce(btrim(p_name), '') = '' then
        raise exception 'create_space: name is required';
    end if;
    if p_visibility not in ('team', 'private') then
        raise exception 'create_space: invalid visibility %', p_visibility;
    end if;

    insert into public.project_folders (name, team_id, created_by, visibility,
                                        parent_folder_id, color_code)
    values (btrim(p_name), p_team_id, auth.uid(), p_visibility,
            p_parent_folder_id,
            coalesce(nullif(p_color_code, ''), '#70a6f3'))
    returning id into _id;

    if p_visibility = 'private' then
        -- Seed the chosen members plus (implicitly) the creator via
        -- set_space_visibility's creator-enrollment path.
        foreach _mid in array coalesce(p_member_ids, '{}'::uuid[])
        loop
            if exists (select 1 from public.team_members tm
                       where tm.id = _mid and tm.team_id = p_team_id) then
                insert into public.space_members (folder_id, team_member_id, role, added_by)
                values (_id, _mid, 'member', auth.uid())
                on conflict (folder_id, team_member_id) do nothing;
            end if;
        end loop;

        insert into public.space_members (folder_id, team_member_id, role, added_by)
        select _id, tm.id, 'admin', auth.uid()
        from public.team_members tm
        where tm.team_id = p_team_id and tm.user_id = auth.uid() and tm.active is true
        on conflict (folder_id, team_member_id) do update set role = 'admin';
    end if;

    return _id;
end;
$$;

revoke all on function public.create_space(uuid, text, text, uuid, text, uuid[]) from public;
grant execute on function public.create_space(uuid, text, text, uuid, text, uuid[]) to authenticated;
