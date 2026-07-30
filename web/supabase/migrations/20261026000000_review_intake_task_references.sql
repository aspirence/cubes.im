-- =============================================================================
-- Review intake provenance + task references + tighter folder-management RLS.
-- =============================================================================

/* ------------------------------------------------------- file provenance */

alter table public.app_files_files
    add column if not exists source_relative_path text,
    add column if not exists source_import_label text;

alter table public.app_files_files
    drop constraint if exists app_files_files_source_relative_path_check;
alter table public.app_files_files
    add constraint app_files_files_source_relative_path_check
    check (
        source_relative_path is null
        or char_length(source_relative_path) between 1 and 500
    );

alter table public.app_files_files
    drop constraint if exists app_files_files_source_import_label_check;
alter table public.app_files_files
    add constraint app_files_files_source_import_label_check
    check (
        source_import_label is null
        or char_length(source_import_label) between 1 and 120
    );

create index if not exists app_files_files_import_label_index
    on public.app_files_files (team_id, source_import_label);

/* --------------------------------------------------------- task refs */

create table if not exists public.task_reference_links (
    id            uuid                     default gen_random_uuid() not null,
    task_id       uuid                                               not null,
    url           text                                               not null,
    title         text,
    preview_image text,
    domain        text,
    sort_order    integer                  default 0                 not null,
    created_by    uuid,
    created_at    timestamp with time zone default current_timestamp not null,
    updated_at    timestamp with time zone default current_timestamp not null,
    constraint task_reference_links_pk primary key (id),
    constraint task_reference_links_task_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint task_reference_links_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint task_reference_links_url_check
        check (char_length(url) between 1 and 2000),
    constraint task_reference_links_title_check
        check (title is null or char_length(title) between 1 and 200),
    constraint task_reference_links_preview_image_check
        check (preview_image is null or char_length(preview_image) <= 2000),
    constraint task_reference_links_domain_check
        check (domain is null or char_length(domain) between 1 and 255)
);

create index if not exists task_reference_links_task_index
    on public.task_reference_links (task_id, sort_order, created_at);

drop trigger if exists task_reference_links_set_updated_at on public.task_reference_links;
create trigger task_reference_links_set_updated_at
    before update on public.task_reference_links
    for each row execute function public.set_row_updated_at();

alter table public.task_reference_links enable row level security;

drop policy if exists task_reference_links_all on public.task_reference_links;
create policy task_reference_links_all on public.task_reference_links
    for all to authenticated
    using (public.is_task_member(task_id))
    with check (public.is_task_member(task_id));

revoke all on public.task_reference_links from public, anon;
grant select, insert, update, delete on public.task_reference_links to authenticated;
grant all on public.task_reference_links to service_role;

/* -------------------------------------------------------- review RLS */

create or replace function public.can_manage_review_folder(
    p_team_id uuid,
    p_project_id uuid
)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select case
        when p_project_id is null then public.is_team_admin(p_team_id)
        else public.is_team_admin(p_team_id) or public.is_project_team_admin(p_project_id)
    end;
$$;

revoke all on function public.can_manage_review_folder(uuid, uuid) from public, anon;
grant execute on function public.can_manage_review_folder(uuid, uuid) to authenticated;

drop policy if exists app_video_review_folders_all on public.app_video_review_folders;
create policy app_video_review_folders_select on public.app_video_review_folders
    for select to authenticated
    using (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    );

create policy app_video_review_folders_write on public.app_video_review_folders
    for all to authenticated
    using (public.can_manage_review_folder(team_id, project_id))
    with check (public.can_manage_review_folder(team_id, project_id));

drop policy if exists app_files_folders_all on public.app_files_folders;
create policy app_files_folders_select on public.app_files_folders
    for select to authenticated
    using (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    );

create policy app_files_folders_write on public.app_files_folders
    for all to authenticated
    using (public.can_manage_review_folder(team_id, project_id))
    with check (public.can_manage_review_folder(team_id, project_id));
