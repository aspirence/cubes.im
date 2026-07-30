-- =============================================================================
-- App: Client Portal — a read-only window for clients into their projects.
-- =============================================================================
-- A first-party app (see src/lib/apps-platform/catalog.ts). A team member curates
-- a PORTAL for one of the team's `clients`: a title + intro, a chosen accent, a
-- set of the client's PROJECTS to expose, and a feed of shared UPDATES
-- (announcements). While the portal is 'draft' it is internal-only; flipping it
-- to 'live' publishes an unguessable share token that the client opens at
-- `/portal/<token>` with no Cubes login.
--
-- Access model (in-app): every table gates on is_team_member(team_id) of the
-- owning portal, exactly like the other apps — so a team member only ever sees
-- and manages portals for teams they belong to, and cross-team isolation is
-- automatic via the FK + shared helper. Adding a project additionally requires
-- is_project_team_member (you can only expose projects you can see).
--
-- Access model (client): the anonymous read is a single SECURITY DEFINER RPC,
-- get_client_portal(token), which returns null unless the portal is 'live'. Its
-- projection is deliberately id-free — the token is the only public handle, and
-- nothing leaks for draft portals. This mirrors get_shared_project from the
-- project-sharing migration; a curated portal is an intentional share, so its
-- projects are exposed regardless of their own team/private visibility.

/* ---------------------------------------------------------------- tables */

create table if not exists public.app_client_portal_portals (
    id            uuid                     default gen_random_uuid() not null,
    team_id       uuid                                               not null,
    client_id     uuid                                               not null,
    title         text                                               not null,
    intro         text,
    accent        text                     default '#4a4ad0'         not null,
    status        text                     default 'draft'           not null,
    show_tasks    boolean                  default true              not null,
    show_progress boolean                  default true              not null,
    share_token   uuid                     default gen_random_uuid() not null,
    created_by    uuid,
    created_at    timestamp with time zone default current_timestamp not null,
    updated_at    timestamp with time zone default current_timestamp not null,
    constraint app_client_portal_portals_pk primary key (id),
    constraint app_client_portal_portals_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_client_portal_portals_client_fk
        foreign key (client_id) references public.clients (id) on delete cascade,
    constraint app_client_portal_portals_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_client_portal_portals_title_check check (char_length(title) <= 200),
    constraint app_client_portal_portals_intro_check check (char_length(intro) <= 4000),
    constraint app_client_portal_portals_status_check
        check (status in ('draft', 'live')),
    -- one portal per client; the token is the sole public handle.
    constraint app_client_portal_portals_client_unique unique (team_id, client_id),
    constraint app_client_portal_portals_token_unique unique (share_token)
);
create index if not exists app_client_portal_portals_team_index
    on public.app_client_portal_portals (team_id);
create index if not exists app_client_portal_portals_client_index
    on public.app_client_portal_portals (client_id);

create table if not exists public.app_client_portal_projects (
    id         uuid                     default gen_random_uuid() not null,
    portal_id  uuid                                               not null,
    project_id uuid                                               not null,
    sort_order integer                  default 0                not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint app_client_portal_projects_pk primary key (id),
    constraint app_client_portal_projects_portal_fk
        foreign key (portal_id) references public.app_client_portal_portals (id) on delete cascade,
    constraint app_client_portal_projects_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_client_portal_projects_unique unique (portal_id, project_id)
);
create index if not exists app_client_portal_projects_portal_index
    on public.app_client_portal_projects (portal_id);

create table if not exists public.app_client_portal_updates (
    id         uuid                     default gen_random_uuid() not null,
    portal_id  uuid                                               not null,
    title      text                                               not null,
    body       text,
    created_by uuid,
    created_at timestamp with time zone default current_timestamp not null,
    constraint app_client_portal_updates_pk primary key (id),
    constraint app_client_portal_updates_portal_fk
        foreign key (portal_id) references public.app_client_portal_portals (id) on delete cascade,
    constraint app_client_portal_updates_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_client_portal_updates_title_check check (char_length(title) <= 200),
    constraint app_client_portal_updates_body_check check (char_length(body) <= 8000)
);
create index if not exists app_client_portal_updates_portal_index
    on public.app_client_portal_updates (portal_id, created_at desc);

/* --------------------------------------------------------------- helper */

-- Child rows (exposed projects, updates) authorize via their portal's team.
create or replace function public.client_portal_can_access(p_portal_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.app_client_portal_portals pp
        where pp.id = p_portal_id
          and public.is_team_member(pp.team_id)
    );
$$;
revoke all on function public.client_portal_can_access(uuid) from public, anon;
grant execute on function public.client_portal_can_access(uuid) to authenticated;

/* ------------------------------------------------------------------ RLS */

alter table public.app_client_portal_portals  enable row level security;
alter table public.app_client_portal_projects enable row level security;
alter table public.app_client_portal_updates  enable row level security;

-- portals: any member of the owning team may read/manage.
drop policy if exists app_client_portal_portals_all on public.app_client_portal_portals;
create policy app_client_portal_portals_all on public.app_client_portal_portals
    for all to authenticated
    using (public.is_team_member(team_id))
    with check (public.is_team_member(team_id));

-- exposed projects: inherit access from the portal; adding a project additionally
-- requires that the caller can actually see that project (honors private
-- visibility so you can't expose a project you have no access to).
drop policy if exists app_client_portal_projects_all on public.app_client_portal_projects;
create policy app_client_portal_projects_all on public.app_client_portal_projects
    for all to authenticated
    using (public.client_portal_can_access(portal_id))
    with check (
        public.client_portal_can_access(portal_id)
        and public.is_project_team_member(project_id)
    );

-- updates: inherit access from the portal.
drop policy if exists app_client_portal_updates_all on public.app_client_portal_updates;
create policy app_client_portal_updates_all on public.app_client_portal_updates
    for all to authenticated
    using (public.client_portal_can_access(portal_id))
    with check (public.client_portal_can_access(portal_id));

/* --------------------------------------------------------------- grants */

revoke all on public.app_client_portal_portals  from public, anon;
revoke all on public.app_client_portal_projects from public, anon;
revoke all on public.app_client_portal_updates  from public, anon;
grant select, insert, update, delete on public.app_client_portal_portals  to authenticated;
grant select, insert, update, delete on public.app_client_portal_projects to authenticated;
grant select, insert, update, delete on public.app_client_portal_updates  to authenticated;
grant all on public.app_client_portal_portals  to service_role;
grant all on public.app_client_portal_projects to service_role;
grant all on public.app_client_portal_updates  to service_role;

/* --------------------------------------------------- public client read */

-- get_client_portal — anonymous read keyed by share token. Returns null unless
-- the token matches a portal with status = 'live'. The projection is id-free:
-- portal branding, the client's name, the curated projects (with status +
-- task-completion counts, and a milestone list when show_tasks), and the shared
-- updates feed. SECURITY DEFINER bypasses RLS by design — the token + 'live'
-- gate is the entire access check, exactly like get_shared_project.
create or replace function public.get_client_portal(p_token uuid)
    returns json
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select json_build_object(
        'portal', json_build_object(
            'title',         pp.title,
            'intro',         pp.intro,
            'accent',        pp.accent,
            'show_tasks',    pp.show_tasks,
            'show_progress', pp.show_progress,
            'client_name',   c.name,
            'updated_at',    pp.updated_at
        ),
        'projects', coalesce(
            (
                select json_agg(
                    json_build_object(
                        'name',         p.name,
                        'color_code',   p.color_code,
                        'notes',        p.notes,
                        'start_date',   p.start_date,
                        'end_date',     p.end_date,
                        'status',       ps.name,
                        'status_color', ps.color_code,
                        'total_tasks',  coalesce(tk.total_tasks, 0),
                        'done_tasks',   coalesce(tk.done_tasks, 0),
                        'tasks', case when pp.show_tasks then coalesce(
                            (
                                select json_agg(
                                    json_build_object(
                                        'name',     t.name,
                                        'done',     t.done,
                                        'end_date', t.end_date,
                                        'status',   ts.name
                                    )
                                    order by t.sort_order
                                )
                                from public.tasks t
                                left join public.task_statuses ts on ts.id = t.status_id
                                where t.project_id = p.id
                                  and t.archived = false
                                  and t.parent_task_id is null
                            ),
                            '[]'::json
                        ) else '[]'::json end
                    )
                    order by cpp.sort_order
                )
                from public.app_client_portal_projects cpp
                join public.projects p on p.id = cpp.project_id
                left join public.sys_project_statuses ps on ps.id = p.status_id
                left join lateral (
                    select count(*)                               as total_tasks,
                           count(*) filter (where t2.done is true) as done_tasks
                    from public.tasks t2
                    where t2.project_id = p.id
                      and t2.archived = false
                      and t2.parent_task_id is null
                ) tk on true
                where cpp.portal_id = pp.id
            ),
            '[]'::json
        ),
        'updates', coalesce(
            (
                select json_agg(
                    json_build_object(
                        'title',      u.title,
                        'body',       u.body,
                        'created_at', u.created_at
                    )
                    order by u.created_at desc
                )
                from public.app_client_portal_updates u
                where u.portal_id = pp.id
            ),
            '[]'::json
        )
    )
    from public.app_client_portal_portals pp
    join public.clients c on c.id = pp.client_id
    where pp.share_token = p_token
      and pp.status = 'live';
$$;

revoke all on function public.get_client_portal(uuid) from public;
grant execute on function public.get_client_portal(uuid) to anon, authenticated;
