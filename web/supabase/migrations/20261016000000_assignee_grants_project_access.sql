-- =============================================================================
-- Assigning a member to a task grants them access to the task's project.
-- =============================================================================
-- Previously create_task resolved a project_member for the assignee if one
-- already existed, but assigning a teammate who was NOT a project member left
-- them without access (they couldn't see a private project's work). This makes
-- "assign -> access granted" automatic EVERYWHERE a task is assigned (create
-- modal, task drawer, board, API) via one AFTER-INSERT trigger, instead of
-- retrofitting every member picker.
--
-- Safe: whoever inserts a tasks_assignees row is already a project team member
-- (RLS), and the assignee is a same-team team_member — project membership only
-- scopes private-project visibility, so this is not an escalation.

create or replace function public.ensure_assignee_project_member()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    _project_id uuid;
begin
    select project_id into _project_id from public.tasks where id = new.task_id;
    if _project_id is not null then
        insert into public.project_members (project_id, team_member_id)
        values (_project_id, new.team_member_id)
        on conflict (project_id, team_member_id) do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists tasks_assignees_ensure_project_member on public.tasks_assignees;
create trigger tasks_assignees_ensure_project_member
    after insert on public.tasks_assignees
    for each row
    execute function public.ensure_assignee_project_member();
