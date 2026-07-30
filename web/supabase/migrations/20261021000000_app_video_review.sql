-- =============================================================================
-- App: Video Review — timestamped review of project videos.
-- =============================================================================
-- A first-party app (see src/lib/apps-platform/catalog.ts). A "video" belongs
-- to a team and optionally links to a project + task; each video has one or more
-- REVISIONS (v1, v2 …), and reviewers leave timestamped COMMENTS on a revision.
-- Bytes live in the private `video-review` Storage bucket at
-- `<team_id>/<video_id>/<file>`; a revision may instead point at an external url.
--
-- Access model: a video scoped to a project uses is_project_team_member (honors
-- private-project visibility); an unscoped video uses is_team_member. Revisions
-- and comments inherit access from their parent video via a helper.

/* ---------------------------------------------------------------- tables */

create table if not exists public.app_video_review_videos (
    id              uuid                     default gen_random_uuid() not null,
    team_id         uuid                                               not null,
    project_id      uuid,
    task_id         uuid,
    title           text                                               not null,
    folder          text,
    status          text                     default 'in_review'      not null,
    latest_revision integer                  default 1                not null,
    created_by      uuid,
    created_at      timestamp with time zone default current_timestamp not null,
    updated_at      timestamp with time zone default current_timestamp not null,
    deleted         boolean                  default false            not null,
    constraint app_video_review_videos_pk primary key (id),
    constraint app_video_review_videos_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_video_review_videos_project_fk
        foreign key (project_id) references public.projects (id) on delete set null,
    constraint app_video_review_videos_task_fk
        foreign key (task_id) references public.tasks (id) on delete set null,
    constraint app_video_review_videos_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_video_review_videos_title_check check (char_length(title) <= 200),
    constraint app_video_review_videos_status_check
        check (status in ('draft', 'in_review', 'approved', 'changes_requested'))
);
create index if not exists app_video_review_videos_team_index
    on public.app_video_review_videos (team_id);
create index if not exists app_video_review_videos_project_index
    on public.app_video_review_videos (project_id);

create table if not exists public.app_video_review_revisions (
    id          uuid                     default gen_random_uuid() not null,
    video_id    uuid                                               not null,
    revision    integer                                            not null,
    storage_path text,
    url         text,
    summary     text,
    uploaded_by uuid,
    uploaded_at timestamp with time zone default current_timestamp not null,
    constraint app_video_review_revisions_pk primary key (id),
    constraint app_video_review_revisions_video_fk
        foreign key (video_id) references public.app_video_review_videos (id) on delete cascade,
    constraint app_video_review_revisions_uploaded_by_fk
        foreign key (uploaded_by) references public.users (id) on delete set null,
    constraint app_video_review_revisions_unique unique (video_id, revision),
    -- a revision points at an uploaded object OR an external url.
    constraint app_video_review_revisions_source_check
        check (storage_path is not null or url is not null)
);
create index if not exists app_video_review_revisions_video_index
    on public.app_video_review_revisions (video_id);

create table if not exists public.app_video_review_comments (
    id         uuid                     default gen_random_uuid() not null,
    video_id   uuid                                               not null,
    revision   integer                  default 1                not null,
    author_id  uuid,
    body       text                                               not null,
    time_ms    integer                  default 0                not null,
    resolved   boolean                  default false            not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint app_video_review_comments_pk primary key (id),
    constraint app_video_review_comments_video_fk
        foreign key (video_id) references public.app_video_review_videos (id) on delete cascade,
    constraint app_video_review_comments_author_fk
        foreign key (author_id) references public.users (id) on delete set null,
    constraint app_video_review_comments_body_check check (char_length(body) <= 2000),
    constraint app_video_review_comments_time_check check (time_ms >= 0)
);
create index if not exists app_video_review_comments_video_index
    on public.app_video_review_comments (video_id, revision);

/* --------------------------------------------------------------- helper */

create or replace function public.video_review_can_access(p_video_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.app_video_review_videos v
        where v.id = p_video_id
          and public.is_team_member(v.team_id)
          and (v.project_id is null or public.is_project_team_member(v.project_id))
    );
$$;
revoke all on function public.video_review_can_access(uuid) from public, anon;
grant execute on function public.video_review_can_access(uuid) to authenticated;

/* ------------------------------------------------------------------ RLS */

alter table public.app_video_review_videos    enable row level security;
alter table public.app_video_review_revisions enable row level security;
alter table public.app_video_review_comments  enable row level security;

-- videos: any team member who can see the (optional) project.
drop policy if exists app_video_review_videos_select on public.app_video_review_videos;
create policy app_video_review_videos_select on public.app_video_review_videos
    for select to authenticated
    using (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    );

drop policy if exists app_video_review_videos_write on public.app_video_review_videos;
create policy app_video_review_videos_write on public.app_video_review_videos
    for all to authenticated
    using (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    )
    with check (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    );

-- revisions + comments: inherit access from the parent video.
drop policy if exists app_video_review_revisions_all on public.app_video_review_revisions;
create policy app_video_review_revisions_all on public.app_video_review_revisions
    for all to authenticated
    using (public.video_review_can_access(video_id))
    with check (public.video_review_can_access(video_id));

drop policy if exists app_video_review_comments_all on public.app_video_review_comments;
create policy app_video_review_comments_all on public.app_video_review_comments
    for all to authenticated
    using (public.video_review_can_access(video_id))
    with check (public.video_review_can_access(video_id));

/* --------------------------------------------------------------- grants */

revoke all on public.app_video_review_videos    from public, anon;
revoke all on public.app_video_review_revisions from public, anon;
revoke all on public.app_video_review_comments  from public, anon;
grant select, insert, update, delete on public.app_video_review_videos    to authenticated;
grant select, insert, update, delete on public.app_video_review_revisions to authenticated;
grant select, insert, update, delete on public.app_video_review_comments  to authenticated;
grant all on public.app_video_review_videos    to service_role;
grant all on public.app_video_review_revisions to service_role;
grant all on public.app_video_review_comments  to service_role;

/* ------------------------------------------------------- storage bucket */

-- Private bucket; playback via signed URLs. Path: `<team_id>/<video_id>/<file>`.
insert into storage.buckets (id, name, public)
values ('video-review', 'video-review', false)
on conflict (id) do nothing;

drop policy if exists "video_review_select_team_member" on storage.objects;
create policy "video_review_select_team_member" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'video-review'
        and public.is_team_member(((storage.foldername(name))[1])::uuid)
    );

drop policy if exists "video_review_insert_team_member" on storage.objects;
create policy "video_review_insert_team_member" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'video-review'
        and public.is_team_member(((storage.foldername(name))[1])::uuid)
    );

drop policy if exists "video_review_delete_team_member" on storage.objects;
create policy "video_review_delete_team_member" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'video-review'
        and public.is_team_member(((storage.foldername(name))[1])::uuid)
    );
