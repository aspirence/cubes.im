-- =============================================================================
-- Per-page sharing — grant specific people access to a PRIVATE doc page.
-- =============================================================================
-- Until now a page was binary: shared (whole project) or private (author +
-- project admins). This adds an explicit grant list so a private page can also
-- be shared with hand-picked members. Effective visibility of a page becomes:
--   * public (is_private = false)            -> every project member
--   * private (is_private = true)            -> author + project admins
--                                               + anyone in app_docs_page_shares
-- Only the page's manager (author or a project admin) can see/edit the grant
-- list; a granted user just gains access to the page itself via the extended
-- pages policy.

create table if not exists public.app_docs_page_shares (
    id         uuid                     default gen_random_uuid() not null,
    page_id    uuid                                               not null,
    user_id    uuid                                               not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint app_docs_page_shares_pk primary key (id),
    constraint app_docs_page_shares_page_fk
        foreign key (page_id) references public.app_docs_pages (id) on delete cascade,
    constraint app_docs_page_shares_user_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint app_docs_page_shares_unique unique (page_id, user_id)
);
create index if not exists app_docs_page_shares_page_index
    on public.app_docs_page_shares (page_id);

/* --------------------------------------------------------------- helpers */

-- Can the caller manage a page's sharing (its author, or a project admin)?
create or replace function public.doc_page_can_manage(p_page_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.app_docs_pages p
        where p.id = p_page_id
          and (p.created_by = auth.uid()
               or public.is_project_team_admin(p.project_id))
    );
$$;
revoke all on function public.doc_page_can_manage(uuid) from public, anon;
grant execute on function public.doc_page_can_manage(uuid) to authenticated;

-- Is the page explicitly shared with the caller? SECURITY DEFINER so the pages
-- RLS can consult the grant list without granting callers table-level read on it.
create or replace function public.doc_page_shared_with_me(p_page_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.app_docs_page_shares s
        where s.page_id = p_page_id and s.user_id = auth.uid()
    );
$$;
revoke all on function public.doc_page_shared_with_me(uuid) from public, anon;
grant execute on function public.doc_page_shared_with_me(uuid) to authenticated;

/* ------------------------------------- extend the pages policy with grants */

drop policy if exists app_docs_pages_all on public.app_docs_pages;
create policy app_docs_pages_all on public.app_docs_pages
    for all to authenticated
    using (
        public.is_project_team_member(project_id)
        and (
            not is_private
            or created_by = auth.uid()
            or public.is_project_team_admin(project_id)
            or public.doc_page_shared_with_me(id)
        )
    )
    with check (
        public.is_project_team_member(project_id)
        and (
            not is_private
            or created_by = auth.uid()
            or public.is_project_team_admin(project_id)
            or public.doc_page_shared_with_me(id)
        )
    );

/* -------------------------------------------------------- shares RLS/grants */

alter table public.app_docs_page_shares enable row level security;

-- Only a page's manager can see/modify who it is shared with.
drop policy if exists app_docs_page_shares_all on public.app_docs_page_shares;
create policy app_docs_page_shares_all on public.app_docs_page_shares
    for all to authenticated
    using (public.doc_page_can_manage(page_id))
    with check (public.doc_page_can_manage(page_id));

revoke all on public.app_docs_page_shares from public, anon;
grant select, insert, update, delete on public.app_docs_page_shares to authenticated;
grant all on public.app_docs_page_shares to service_role;
