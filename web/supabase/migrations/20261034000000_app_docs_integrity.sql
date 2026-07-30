-- =============================================================================
-- Docs integrity + authorization hardening (fixes review findings).
-- =============================================================================
-- app_docs_pages RLS authorizes against the denormalized project_id, but nothing
-- forced that column to match the page's doc's real project — so a caller could
-- INSERT a page under another project's doc with a project_id they DO belong to
-- and slip past WITH CHECK (RLS runs AFTER before-triggers). These BEFORE
-- triggers pin the server-trusted values so the existing policies become sound:
--   * pages.project_id  := the doc's project (spoof-proof authorization key)
--   * pages.created_by  := auth.uid() on INSERT (no forged authorship)
--   * a subpage's parent must live in the SAME doc
--   * docs.team_id      := the project's real team; docs.created_by := auth.uid()
-- WITH CHECK then re-evaluates is_project_team_member on the corrected row, so an
-- outsider inserting into another project's doc is rejected.

create or replace function public.app_docs_pages_pin()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    _doc_project uuid;
    _parent_doc  uuid;
begin
    select project_id into _doc_project
        from public.app_docs_docs where id = new.doc_id;
    if _doc_project is null then
        raise exception 'app_docs_pages: doc % does not exist', new.doc_id;
    end if;
    new.project_id := _doc_project;

    if new.parent_id is not null then
        select doc_id into _parent_doc
            from public.app_docs_pages where id = new.parent_id;
        if _parent_doc is distinct from new.doc_id then
            raise exception 'app_docs_pages: parent % is not in doc %',
                new.parent_id, new.doc_id;
        end if;
    end if;

    if tg_op = 'INSERT' then
        new.created_by := auth.uid();
    end if;
    return new;
end;
$$;
revoke all on function public.app_docs_pages_pin() from public, anon;

drop trigger if exists app_docs_pages_pin_trg on public.app_docs_pages;
create trigger app_docs_pages_pin_trg
    before insert or update on public.app_docs_pages
    for each row execute function public.app_docs_pages_pin();

create or replace function public.app_docs_docs_pin()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    _team uuid;
begin
    select team_id into _team from public.projects where id = new.project_id;
    if _team is null then
        raise exception 'app_docs_docs: project % does not exist', new.project_id;
    end if;
    new.team_id := _team;
    if tg_op = 'INSERT' then
        new.created_by := auth.uid();
    end if;
    return new;
end;
$$;
revoke all on function public.app_docs_docs_pin() from public, anon;

drop trigger if exists app_docs_docs_pin_trg on public.app_docs_docs;
create trigger app_docs_docs_pin_trg
    before insert or update on public.app_docs_docs
    for each row execute function public.app_docs_docs_pin();
