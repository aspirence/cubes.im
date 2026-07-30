-- =============================================================================
-- App: Files — internal team file sharing with per-file permissions.
-- =============================================================================
-- A first-party app (src/lib/apps-platform/catalog.ts). Files live in the
-- private `team-files` bucket at `<team_id>/<file_id>/<name>`; metadata rows
-- carry per-file permissions:
--   * allow_download — false = view/stream only (no download affordance),
--   * watermark      — overlay the viewer's identity on previews,
--   * published      — "pushed to server": marked ready for wider sharing.
-- Access mirrors the other apps: team member + (optional) project visibility.
-- Folders organize files per project (or team-wide when project_id is null).

create table if not exists public.app_files_folders (
    id         uuid                     default gen_random_uuid() not null,
    team_id    uuid                                               not null,
    project_id uuid,
    name       text                                               not null,
    created_by uuid,
    created_at timestamp with time zone default current_timestamp not null,
    constraint app_files_folders_pk primary key (id),
    constraint app_files_folders_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_files_folders_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_files_folders_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_files_folders_name_check check (char_length(name) between 1 and 80)
);
create index if not exists app_files_folders_team_index
    on public.app_files_folders (team_id, project_id);
create unique index if not exists app_files_folders_unique_name
    on public.app_files_folders (team_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table if not exists public.app_files_files (
    id             uuid                     default gen_random_uuid() not null,
    team_id        uuid                                               not null,
    project_id     uuid,
    folder_id      uuid,
    name           text                                               not null,
    storage_path   text                                               not null,
    mime           text,
    size_bytes     bigint,
    allow_download boolean                  default true              not null,
    watermark      boolean                  default false             not null,
    published      boolean                  default false             not null,
    created_by     uuid,
    created_at     timestamp with time zone default current_timestamp not null,
    constraint app_files_files_pk primary key (id),
    constraint app_files_files_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_files_files_project_fk
        foreign key (project_id) references public.projects (id) on delete set null,
    constraint app_files_files_folder_fk
        foreign key (folder_id) references public.app_files_folders (id) on delete set null,
    constraint app_files_files_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_files_files_name_check check (char_length(name) <= 255)
);
create index if not exists app_files_files_team_index
    on public.app_files_files (team_id, project_id);
create index if not exists app_files_files_folder_index
    on public.app_files_files (folder_id);

alter table public.app_files_folders enable row level security;
alter table public.app_files_files   enable row level security;

drop policy if exists app_files_folders_all on public.app_files_folders;
create policy app_files_folders_all on public.app_files_folders
    for all to authenticated
    using (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    )
    with check (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    );

drop policy if exists app_files_files_all on public.app_files_files;
create policy app_files_files_all on public.app_files_files
    for all to authenticated
    using (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    )
    with check (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    );

revoke all on public.app_files_folders from public, anon;
revoke all on public.app_files_files   from public, anon;
grant select, insert, update, delete on public.app_files_folders to authenticated;
grant select, insert, update, delete on public.app_files_files   to authenticated;
grant all on public.app_files_folders to service_role;
grant all on public.app_files_files   to service_role;

/* ------------------------------------------------------- storage bucket */

insert into storage.buckets (id, name, public)
values ('team-files', 'team-files', false)
on conflict (id) do nothing;

drop policy if exists "team_files_select_member" on storage.objects;
create policy "team_files_select_member" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'team-files'
        and public.is_team_member(((storage.foldername(name))[1])::uuid)
    );

drop policy if exists "team_files_insert_member" on storage.objects;
create policy "team_files_insert_member" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'team-files'
        and public.is_team_member(((storage.foldername(name))[1])::uuid)
    );

drop policy if exists "team_files_delete_member" on storage.objects;
create policy "team_files_delete_member" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'team-files'
        and public.is_team_member(((storage.foldername(name))[1])::uuid)
    );
