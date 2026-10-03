-- One-off cleanup: remove the subtasks the seeded "Video task" template
-- created before migration 20261147000000_video_template_without_steps.
--
-- Deletes ONLY subtasks still exactly as the template made them: one of the
-- four seeded names, sitting in a status named "Backlog", not done, no
-- description, no time logged, no comments, no assignees. A step somebody
-- moved, assigned, or wrote on is left alone. Parents are never touched.
-- Re-runnable; prints the number removed.
--
--   psql "$SUPABASE_DB_URL" -1 -f scripts/cleanup-video-template-subtasks.sql
--
-- Dry run (counts, changes nothing):
--   psql "$SUPABASE_DB_URL" -c "select count(*) from public.tasks t join public.task_statuses s on s.id = t.status_id where t.parent_task_id is not null and s.name = 'Backlog' and t.name in ('Upload first draft','Collect feedback in Video Review','Apply revisions','Final export & deliver')"

with doomed as (
    select t.id
      from public.tasks t
      join public.task_statuses s on s.id = t.status_id
     where t.parent_task_id is not null
       and s.name = 'Backlog'
       and t.name in ('Upload first draft',
                      'Collect feedback in Video Review',
                      'Apply revisions',
                      'Final export & deliver')
       and t.done is false
       and coalesce(t.description, '') = ''
       and coalesce(t.total_minutes, 0) = 0
       and not exists (select 1 from public.task_comments  c where c.task_id = t.id)
       and not exists (select 1 from public.tasks_assignees a where a.task_id = t.id)
)
delete from public.tasks t
 using doomed d
 where t.id = d.id;
