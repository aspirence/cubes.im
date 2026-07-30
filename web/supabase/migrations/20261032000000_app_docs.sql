-- =============================================================================
-- App: Docs — project docs (a page tree with per-page privacy).
-- =============================================================================
-- A project has one or more DOCS; each doc is a tree of PAGES (parent_id →
-- subpages). A page holds an ordered array of content BLOCKS (jsonb) authored in
-- the custom block/slash editor, an optional emoji icon, and an is_private flag.
--
-- Access model:
--   * docs  — read/write for any member of the doc's project (collaborative),
--             honoring private-project visibility via is_project_team_member.
--   * pages — same, PLUS per-page privacy: a private page is visible only to its
--             author and the project's admins. The predicate is inlined into the
--             policies (not a separate helper) so read and write agree exactly.
-- RLS resolves the owning project through project_id (denormalized onto pages so
-- the policy needs no join), and every project delete cascades its docs + pages.

/* ---------------------------------------------------------------- tables */

create table if not exists public.app_docs_docs (
    id         uuid                     default gen_random_uuid() not null,
    project_id uuid                                               not null,
    team_id    uuid                                               not null,
    title      text                     default 'Doc'            not null,
    sort_order integer                  default 0                not null,
    created_by uuid,
    created_at timestamp with time zone default current_timestamp not null,
    updated_at timestamp with time zone default current_timestamp not null,
    constraint app_docs_docs_pk primary key (id),
    constraint app_docs_docs_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_docs_docs_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_docs_docs_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_docs_docs_title_check check (char_length(title) <= 200)
);
create index if not exists app_docs_docs_project_index
    on public.app_docs_docs (project_id);

create table if not exists public.app_docs_pages (
    id         uuid                     default gen_random_uuid() not null,
    doc_id     uuid                                               not null,
    project_id uuid                                               not null,
    parent_id  uuid,
    title      text                     default 'Untitled'       not null,
    icon       text,
    content    jsonb                    default '[]'::jsonb      not null,
    is_private boolean                  default false            not null,
    sort_order integer                  default 0                not null,
    created_by uuid,
    created_at timestamp with time zone default current_timestamp not null,
    updated_at timestamp with time zone default current_timestamp not null,
    constraint app_docs_pages_pk primary key (id),
    constraint app_docs_pages_doc_fk
        foreign key (doc_id) references public.app_docs_docs (id) on delete cascade,
    constraint app_docs_pages_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_docs_pages_parent_fk
        foreign key (parent_id) references public.app_docs_pages (id) on delete cascade,
    constraint app_docs_pages_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_docs_pages_title_check check (char_length(title) <= 300),
    constraint app_docs_pages_content_check check (jsonb_typeof(content) = 'array'),
    constraint app_docs_pages_icon_check check (icon is null or char_length(icon) <= 16)
);
create index if not exists app_docs_pages_doc_index
    on public.app_docs_pages (doc_id);
create index if not exists app_docs_pages_parent_index
    on public.app_docs_pages (parent_id);
create index if not exists app_docs_pages_project_index
    on public.app_docs_pages (project_id);

/* ------------------------------------------------------------------ RLS */

alter table public.app_docs_docs  enable row level security;
alter table public.app_docs_pages enable row level security;

-- docs: any member of the doc's project (visibility-aware helper).
drop policy if exists app_docs_docs_all on public.app_docs_docs;
create policy app_docs_docs_all on public.app_docs_docs
    for all to authenticated
    using (public.is_project_team_member(project_id))
    with check (public.is_project_team_member(project_id));

-- pages: project member AND (page is public, OR you authored it, OR you're a
-- project admin). Same predicate for read and write so visibility == editability.
drop policy if exists app_docs_pages_all on public.app_docs_pages;
create policy app_docs_pages_all on public.app_docs_pages
    for all to authenticated
    using (
        public.is_project_team_member(project_id)
        and (
            not is_private
            or created_by = auth.uid()
            or public.is_project_team_admin(project_id)
        )
    )
    with check (
        public.is_project_team_member(project_id)
        and (
            not is_private
            or created_by = auth.uid()
            or public.is_project_team_admin(project_id)
        )
    );

/* --------------------------------------------------------------- grants */

revoke all on public.app_docs_docs  from public, anon;
revoke all on public.app_docs_pages from public, anon;
grant select, insert, update, delete on public.app_docs_docs  to authenticated;
grant select, insert, update, delete on public.app_docs_pages to authenticated;
grant all on public.app_docs_docs  to service_role;
grant all on public.app_docs_pages to service_role;
