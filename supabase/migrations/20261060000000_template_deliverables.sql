-- ============================================================================
-- Deliverables belong to templates, not the create-task modal. A task template
-- can specify a deliverable_type (video | text); applying the template sets the
-- task's deliverable. Ship a default "Video task" template (video deliverable +
-- subtask steps) to every team so "select the video template -> get a video
-- deliverable" works out of the box.
-- ============================================================================
alter table public.task_templates
    add column if not exists deliverable_type text;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'task_templates_deliverable_type_chk') then
        alter table public.task_templates
            add constraint task_templates_deliverable_type_chk
            check (deliverable_type is null or deliverable_type in ('video', 'text'));
    end if;
end $$;

-- Creates the default "Video task" template for a team if it doesn't have one.
create or replace function public.ensure_video_template(p_team_id uuid, p_owner uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
begin
    if not exists (
        select 1 from public.task_templates
        where team_id = p_team_id and lower(name) = 'video task'
    ) then
        insert into public.task_templates
            (team_id, name, description, priority, deliverable_type, steps, created_by)
        values (
            p_team_id,
            'Video task',
            'A video deliverable — drafts, review, and final export.',
            'medium',
            'video',
            '[{"name":"Upload first draft"},
              {"name":"Collect feedback in Video Review"},
              {"name":"Apply revisions"},
              {"name":"Final export & deliver"}]'::jsonb,
            p_owner
        );
    end if;
end;
$$;

revoke all on function public.ensure_video_template(uuid, uuid) from public, anon, authenticated;

-- New teams get the template too (plain AFTER INSERT — only needs team + owner;
-- failures never block team creation).
create or replace function public.handle_new_team_video_template()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
begin
    perform public.ensure_video_template(new.id, new.user_id);
    return null;
exception
    when others then
        return null;
end;
$$;

drop trigger if exists on_team_created_video_template on public.teams;
create trigger on_team_created_video_template
    after insert on public.teams
    for each row execute function public.handle_new_team_video_template();

-- Backfill every existing team.
select public.ensure_video_template(t.id, t.user_id) from public.teams t;
