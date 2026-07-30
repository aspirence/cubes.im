-- =============================================================================
-- Video Review — folders inside projects.
-- =============================================================================
-- Real folder rows (not just a text label) so empty folders exist, can be
-- renamed, and deleting one leaves its videos unfiled (folder_id set null).
-- Access mirrors videos: team member + (optional) project visibility.

create table if not exists public.app_video_review_folders (
    id         uuid                     default gen_random_uuid() not null,
    team_id    uuid                                               not null,
    project_id uuid,
    name       text                                               not null,
    created_by uuid,
    created_at timestamp with time zone default current_timestamp not null,
    constraint app_video_review_folders_pk primary key (id),
    constraint app_video_review_folders_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_video_review_folders_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_video_review_folders_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_video_review_folders_name_check
        check (char_length(name) between 1 and 80)
);
create index if not exists app_video_review_folders_team_index
    on public.app_video_review_folders (team_id, project_id);
-- One name per scope (nulls distinct per project scope is fine for hub-level).
create unique index if not exists app_video_review_folders_unique_name
    on public.app_video_review_folders (team_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

alter table public.app_video_review_videos
    add column if not exists folder_id uuid;
alter table public.app_video_review_videos
    drop constraint if exists app_video_review_videos_folder_fk;
alter table public.app_video_review_videos
    add constraint app_video_review_videos_folder_fk
    foreign key (folder_id) references public.app_video_review_folders (id) on delete set null;

alter table public.app_video_review_folders enable row level security;

drop policy if exists app_video_review_folders_all on public.app_video_review_folders;
create policy app_video_review_folders_all on public.app_video_review_folders
    for all to authenticated
    using (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    )
    with check (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    );

revoke all on public.app_video_review_folders from public, anon;
grant select, insert, update, delete on public.app_video_review_folders to authenticated;
grant all on public.app_video_review_folders to service_role;
