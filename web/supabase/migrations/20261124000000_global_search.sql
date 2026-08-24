-- =============================================================================
-- Global search — one RPC over projects, tasks, comments, and docs
-- =============================================================================
-- Powers the top-bar ⌘K search. One round trip, ILIKE across the team's
-- projects (name), tasks (name + description), task comments (content), and
-- doc titles. SECURITY DEFINER with an is_team_member gate up front, and every
-- branch re-checks is_project_team_member so limited members only see hits
-- from projects they can actually open (mirrors the RLS they'd hit anyway).
--
-- Result rows carry enough to navigate: project for '/projects/<id>', task for
-- '?task=<id>', comment for '?task=<task_id>&comment=<id>', doc for '?tab=doc'.
--
-- Table sizes here are ILIKE-friendly (thousands of rows); if that ever grows,
-- add pg_trgm indexes on the searched columns — the RPC contract stays put.
--
-- Re-runnable: create or replace.
-- =============================================================================

-- Plain-text window around the first match: tags stripped, ~130 chars starting
-- shortly before the hit so the match sits in context.
create or replace function public.search_snippet(_text text, _q text)
    returns text
    language sql
    immutable
as
$$
    select case
        when _text is null or _text = '' then null
        else (
            with t as (
                select regexp_replace(_text, '<[^>]*>', ' ', 'g') as plain
            )
            select nullif(trim(substring(
                plain
                from greatest(1, coalesce(nullif(position(lower(_q) in lower(plain)), 0), 1) - 40)
                for 130
            )), '')
            from t
        )
    end;
$$;

revoke all on function public.search_snippet(text, text) from public, anon;
grant execute on function public.search_snippet(text, text) to authenticated;

create or replace function public.global_search(
    p_team_id uuid,
    p_query   text,
    p_limit   integer default 8
)
    returns table (
        kind         text,
        id           uuid,
        title        text,
        snippet      text,
        project_id   uuid,
        project_name text,
        task_id      uuid,
        task_no      integer
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
declare
    _q       text := trim(coalesce(p_query, ''));
    _pattern text;
    _lim     integer := least(greatest(coalesce(p_limit, 8), 1), 25);
begin
    if auth.uid() is null then
        raise exception 'global_search: no authenticated user';
    end if;
    if not public.is_team_member(p_team_id) then
        raise exception 'global_search: caller is not a member of team %', p_team_id;
    end if;
    if length(_q) < 2 then
        return;
    end if;

    -- A literal search: % _ \ in the query must not act as wildcards.
    _pattern := '%' || replace(replace(replace(_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

    return query
    -- Projects by name.
    (
        select 'project'::text, p.id, p.name, null::text,
               p.id, p.name, null::uuid, null::integer
        from public.projects p
        where p.team_id = p_team_id
          and p.name ilike _pattern
          and public.is_project_team_member(p.id)
        order by p.name
        limit _lim
    )
    union all
    -- Tasks by name or description, newest movement first.
    (
        select 'task'::text, t.id, t.name, public.search_snippet(t.description, _q),
               t.project_id, pr.name, t.id, t.task_no
        from public.tasks t
        join public.projects pr on pr.id = t.project_id
        where pr.team_id = p_team_id
          and t.archived = false
          and (t.name ilike _pattern or t.description ilike _pattern)
          and public.is_project_team_member(t.project_id)
        order by t.updated_at desc
        limit _lim
    )
    union all
    -- Comments by content; the row navigates to its task with the comment
    -- focused (the drawer's ?comment= deep link).
    (
        select 'comment'::text, c.id, t.name, public.search_snippet(c.content, _q),
               t.project_id, pr.name, t.id, t.task_no
        from public.task_comments c
        join public.tasks t on t.id = c.task_id
        join public.projects pr on pr.id = t.project_id
        where pr.team_id = p_team_id
          and t.archived = false
          and c.content ilike _pattern
          and public.is_project_team_member(t.project_id)
        order by c.created_at desc
        limit _lim
    )
    union all
    -- Docs by title.
    (
        select 'doc'::text, d.id, d.title, null::text,
               d.project_id, pr.name, null::uuid, null::integer
        from public.app_docs_docs d
        join public.projects pr on pr.id = d.project_id
        where d.team_id = p_team_id
          and d.title ilike _pattern
          and public.is_project_team_member(d.project_id)
        order by d.updated_at desc
        limit _lim
    );
end;
$$;

revoke all on function public.global_search(uuid, text, integer) from public, anon;
grant execute on function public.global_search(uuid, text, integer) to authenticated;
