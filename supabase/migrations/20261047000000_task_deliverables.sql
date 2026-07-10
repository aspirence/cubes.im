-- =============================================================================
-- Cubes — Task deliverables + submission
-- =============================================================================
-- Every task can carry an OPTIONAL deliverable expectation set at creation
-- (e.g. a "video" task expects a video review; a "text" task expects written
-- output). The submission area on the task detail renders per type.
--
--   * deliverable_type: null (no deliverable) | 'video' | 'text'
--   * submission_content: the text submission (for the 'text' deliverable).
--     Video deliverables are satisfied by the existing app_video_review_videos
--     linked to the task, so they need no extra column here.
--   * submission_status: 'pending' | 'submitted' — a light state the owner can
--     flip to mark the deliverable done.

alter table public.tasks
    add column if not exists deliverable_type   text,
    add column if not exists submission_content text,
    add column if not exists submission_status  text not null default 'pending';

-- Guard the small enums (nullable deliverable_type; status has a default).
alter table public.tasks
    drop constraint if exists tasks_deliverable_type_chk;
alter table public.tasks
    add constraint tasks_deliverable_type_chk
    check (deliverable_type is null or deliverable_type in ('video', 'text'));

alter table public.tasks
    drop constraint if exists tasks_submission_status_chk;
alter table public.tasks
    add constraint tasks_submission_status_chk
    check (submission_status in ('pending', 'submitted'));
