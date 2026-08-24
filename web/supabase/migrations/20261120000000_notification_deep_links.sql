-- =============================================================================
-- 20261120000000_notification_deep_links.sql
--
-- Comment notifications now carry a deep-link URL so clicking one lands on the
-- EXACT comment, not just the project:
--
--   * notify_on_task_comment          -> /projects/<p>?task=<t>&comment=<c>
--   * notify_task_comment_mentions    -> /projects/<p>?task=<t>&comment=<c>
--   * notify_project_comment_mentions -> /projects/<p>?tab=updates&comment=<c>
--
-- The web app consumes `?task=` (opens the task drawer), `&comment=` (scrolls
-- to and flashes that comment row) and `?tab=updates` (activates the Updates
-- view, whose feed scrolls to the comment). Existing notification rows keep
-- url NULL and fall back to task-level navigation client-side; the table
-- schema is unchanged.
--
-- Function bodies are otherwise identical to their latest definitions:
--   * notify_on_task_comment       — 20261062 access-leak-fixed version (keeps
--     the per-recipient user_can_access_project gate).
--   * notify_task_comment_mentions — 20260901, with the message enriched to
--     name the author and task ("<author> mentioned you in a comment on
--     "<task>"") in the same style as the project-mention trigger.
--   * notify_project_comment_mentions — 20260901.
-- The triggers themselves are unchanged (same function names), so
-- create-or-replace suffices. SECURITY DEFINER + pinned search_path preserved.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. notify_on_task_comment — participants (assignees + reporter) of the task.
-- -----------------------------------------------------------------------------
create or replace function public.notify_on_task_comment()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _task_name    text;
    _project_id   uuid;
    _team_id      uuid;
    _reporter_id  uuid;
    _commenter    uuid := new.created_by;
    _recipient    uuid;
    _url          text;
begin
    select t.name, t.project_id, t.reporter_id, p.team_id
        into _task_name, _project_id, _reporter_id, _team_id
        from public.tasks t
        join public.projects p on p.id = t.project_id
        where t.id = new.task_id;

    -- Deep link to the exact comment (NULL when the task lookup failed, which
    -- also yields no recipients below).
    _url := '/projects/' || _project_id::text
         || '?task=' || new.task_id::text
         || '&comment=' || new.id::text;

    -- Distinct set of participant users: assignees' users + the reporter, minus
    -- the commenter and nulls, and minus anyone who can no longer access the
    -- project (e.g. removed from the project / a now-private project or Space).
    for _recipient in
        select distinct u
        from (
            select tm.user_id as u
                from public.tasks_assignees ta
                join public.team_members tm on tm.id = ta.team_member_id
                where ta.task_id = new.task_id
            union
            select _reporter_id as u
        ) parts
        where u is not null
          and u is distinct from _commenter
          and public.user_can_access_project(u, _project_id)
    loop
        perform public.create_notification(
            p_user_id    => _recipient,
            p_message    => 'New comment on ' || coalesce(_task_name, 'a task'),
            p_type       => 'comment',
            p_url        => _url,
            p_team_id    => _team_id,
            p_task_id    => new.task_id,
            p_project_id => _project_id
        );
    end loop;

    return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. notify_task_comment_mentions — users @mentioned in a task comment.
-- -----------------------------------------------------------------------------
create or replace function public.notify_task_comment_mentions()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _task_name   text;
    _project_id  uuid;
    _team_id     uuid;
    _author_name text;
    _message     text;
    _url         text;
    _uid         uuid;
begin
    if new.mentions is null or array_length(new.mentions, 1) is null then
        return new;
    end if;

    -- Resolve the task's name + project, then the project's team.
    select t.name, t.project_id
        into _task_name, _project_id
        from public.tasks t
        where t.id = new.task_id;
    if _project_id is not null then
        select public.team_id_of_project(_project_id) into _team_id;
    end if;
    select u.name into _author_name from public.users u where u.id = new.created_by;

    _message := coalesce(_author_name, 'Someone')
             || ' mentioned you in a comment on "'
             || coalesce(_task_name, 'a task') || '"';
    _url := '/projects/' || _project_id::text
         || '?task=' || new.task_id::text
         || '&comment=' || new.id::text;

    foreach _uid in array new.mentions
    loop
        if _uid is not null and _uid is distinct from new.created_by then
            perform public.create_notification(
                p_user_id    => _uid,
                p_message    => _message,
                p_type       => 'mention',
                p_url        => _url,
                p_team_id    => _team_id,
                p_task_id    => new.task_id,
                p_project_id => _project_id
            );
        end if;
    end loop;

    return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. notify_project_comment_mentions — users @mentioned in a project update.
-- -----------------------------------------------------------------------------
create or replace function public.notify_project_comment_mentions()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _team_id      uuid;
    _author_name  text;
    _message      text;
    _url          text;
    _uid          uuid;
begin
    -- Nothing to do if no one was mentioned.
    if new.mentions is null or array_length(new.mentions, 1) is null then
        return new;
    end if;

    -- Resolve the project's team (for the per-team popup preference in
    -- create_notification) and the author's display name for the message.
    select public.team_id_of_project(new.project_id) into _team_id;
    select u.name into _author_name from public.users u where u.id = new.created_by;
    _message := coalesce(_author_name, 'Someone') || ' mentioned you in a project update';
    _url := '/projects/' || new.project_id::text
         || '?tab=updates&comment=' || new.id::text;

    foreach _uid in array new.mentions
    loop
        -- Skip nulls and the author (no self-mention notification).
        if _uid is not null and _uid is distinct from new.created_by then
            perform public.create_notification(
                p_user_id    => _uid,
                p_message    => _message,
                p_type       => 'mention',
                p_url        => _url,
                p_team_id    => _team_id,
                p_task_id    => null,
                p_project_id => new.project_id
            );
        end if;
    end loop;

    return new;
end;
$$;
