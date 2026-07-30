-- =============================================================================
-- App: Social Studio — campaigns, channels, publishing queue, and media reuse.
-- =============================================================================
-- A first-party app inspired by products like Postiz, but implemented as a
-- Cubes-native surface attached to teams / projects / tasks / internal Files.
-- Scope model:
--   * team-wide records use project_id = null
--   * project-scoped records FK into projects and inherit private-project access
--   * post assets point at app_files_files so Files remains the storage source
--     of truth for creative media.

/* ---------------------------------------------------------------- tables */

create table if not exists public.app_social_studio_channels (
    id              uuid                     default gen_random_uuid() not null,
    team_id         uuid                                               not null,
    project_id      uuid,
    name            text                                               not null,
    platform        text                                               not null,
    handle          text                                               not null,
    avatar_url      text,
    theme_color     text                     default '#ff7a45'         not null,
    followers_count integer                  default 0                 not null,
    connected       boolean                  default true              not null,
    created_by      uuid,
    created_at      timestamp with time zone default current_timestamp not null,
    updated_at      timestamp with time zone default current_timestamp not null,
    constraint app_social_studio_channels_pk primary key (id),
    constraint app_social_studio_channels_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_social_studio_channels_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_social_studio_channels_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_social_studio_channels_name_check
        check (char_length(name) between 1 and 120),
    constraint app_social_studio_channels_handle_check
        check (char_length(handle) between 1 and 160),
    constraint app_social_studio_channels_platform_check
        check (
            platform in (
                'instagram',
                'linkedin',
                'x',
                'facebook',
                'threads',
                'youtube',
                'tiktok',
                'reddit',
                'bluesky'
            )
        ),
    constraint app_social_studio_channels_followers_check
        check (followers_count >= 0)
);
create index if not exists app_social_studio_channels_team_index
    on public.app_social_studio_channels (team_id, project_id);
create unique index if not exists app_social_studio_channels_unique_handle
    on public.app_social_studio_channels (
        team_id,
        coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
        lower(platform),
        lower(handle)
    );

create table if not exists public.app_social_studio_campaigns (
    id          uuid                     default gen_random_uuid() not null,
    team_id     uuid                                               not null,
    project_id  uuid,
    name        text                                               not null,
    brief       text,
    goal        text,
    theme_color text                     default '#7c6cf0'         not null,
    start_date  date,
    end_date    date,
    created_by  uuid,
    created_at  timestamp with time zone default current_timestamp not null,
    updated_at  timestamp with time zone default current_timestamp not null,
    constraint app_social_studio_campaigns_pk primary key (id),
    constraint app_social_studio_campaigns_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_social_studio_campaigns_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_social_studio_campaigns_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_social_studio_campaigns_name_check
        check (char_length(name) between 1 and 140),
    constraint app_social_studio_campaigns_brief_check
        check (brief is null or char_length(brief) <= 4000),
    constraint app_social_studio_campaigns_goal_check
        check (goal is null or char_length(goal) <= 2000)
);
create index if not exists app_social_studio_campaigns_team_index
    on public.app_social_studio_campaigns (team_id, project_id);

create table if not exists public.app_social_studio_posts (
    id                uuid                     default gen_random_uuid() not null,
    team_id           uuid                                               not null,
    project_id        uuid,
    task_id           uuid,
    campaign_id       uuid,
    title             text                                               not null,
    caption           text                                               not null,
    status            text                     default 'draft'            not null,
    scheduled_for     timestamp with time zone,
    published_at      timestamp with time zone,
    approval_required boolean                  default false              not null,
    target_url        text,
    impressions       integer                  default 0                  not null,
    engagements       integer                  default 0                  not null,
    clicks            integer                  default 0                  not null,
    created_by        uuid,
    created_at        timestamp with time zone default current_timestamp  not null,
    updated_at        timestamp with time zone default current_timestamp  not null,
    constraint app_social_studio_posts_pk primary key (id),
    constraint app_social_studio_posts_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_social_studio_posts_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_social_studio_posts_task_fk
        foreign key (task_id) references public.tasks (id) on delete set null,
    constraint app_social_studio_posts_campaign_fk
        foreign key (campaign_id) references public.app_social_studio_campaigns (id) on delete set null,
    constraint app_social_studio_posts_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_social_studio_posts_title_check
        check (char_length(title) between 1 and 200),
    constraint app_social_studio_posts_caption_check
        check (char_length(caption) between 1 and 12000),
    constraint app_social_studio_posts_status_check
        check (status in ('draft', 'pending_approval', 'scheduled', 'published', 'failed')),
    constraint app_social_studio_posts_impressions_check
        check (impressions >= 0),
    constraint app_social_studio_posts_engagements_check
        check (engagements >= 0),
    constraint app_social_studio_posts_clicks_check
        check (clicks >= 0)
);
create index if not exists app_social_studio_posts_team_index
    on public.app_social_studio_posts (team_id, project_id, status);
create index if not exists app_social_studio_posts_scheduled_index
    on public.app_social_studio_posts (scheduled_for);
create index if not exists app_social_studio_posts_campaign_index
    on public.app_social_studio_posts (campaign_id);
create index if not exists app_social_studio_posts_task_index
    on public.app_social_studio_posts (task_id);

create table if not exists public.app_social_studio_post_channels (
    id              uuid                     default gen_random_uuid() not null,
    post_id         uuid                                               not null,
    channel_id      uuid                                               not null,
    variant_caption text,
    sort_order      integer                  default 0                 not null,
    created_at      timestamp with time zone default current_timestamp not null,
    constraint app_social_studio_post_channels_pk primary key (id),
    constraint app_social_studio_post_channels_post_fk
        foreign key (post_id) references public.app_social_studio_posts (id) on delete cascade,
    constraint app_social_studio_post_channels_channel_fk
        foreign key (channel_id) references public.app_social_studio_channels (id) on delete cascade,
    constraint app_social_studio_post_channels_unique unique (post_id, channel_id),
    constraint app_social_studio_post_channels_variant_caption_check
        check (variant_caption is null or char_length(variant_caption) <= 12000)
);
create index if not exists app_social_studio_post_channels_post_index
    on public.app_social_studio_post_channels (post_id, sort_order);
create index if not exists app_social_studio_post_channels_channel_index
    on public.app_social_studio_post_channels (channel_id);

create table if not exists public.app_social_studio_post_assets (
    id         uuid                     default gen_random_uuid() not null,
    post_id    uuid                                               not null,
    file_id    uuid                                               not null,
    sort_order integer                  default 0                 not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint app_social_studio_post_assets_pk primary key (id),
    constraint app_social_studio_post_assets_post_fk
        foreign key (post_id) references public.app_social_studio_posts (id) on delete cascade,
    constraint app_social_studio_post_assets_file_fk
        foreign key (file_id) references public.app_files_files (id) on delete cascade,
    constraint app_social_studio_post_assets_unique unique (post_id, file_id)
);
create index if not exists app_social_studio_post_assets_post_index
    on public.app_social_studio_post_assets (post_id, sort_order);

drop trigger if exists app_social_studio_channels_set_updated_at on public.app_social_studio_channels;
create trigger app_social_studio_channels_set_updated_at
    before update on public.app_social_studio_channels
    for each row execute function public.set_row_updated_at();

drop trigger if exists app_social_studio_campaigns_set_updated_at on public.app_social_studio_campaigns;
create trigger app_social_studio_campaigns_set_updated_at
    before update on public.app_social_studio_campaigns
    for each row execute function public.set_row_updated_at();

drop trigger if exists app_social_studio_posts_set_updated_at on public.app_social_studio_posts;
create trigger app_social_studio_posts_set_updated_at
    before update on public.app_social_studio_posts
    for each row execute function public.set_row_updated_at();

/* --------------------------------------------------------------- helpers */

create or replace function public.social_studio_can_access_channel(p_channel_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.app_social_studio_channels c
        where c.id = p_channel_id
          and public.is_team_member(c.team_id)
          and (c.project_id is null or public.is_project_team_member(c.project_id))
    );
$$;
revoke all on function public.social_studio_can_access_channel(uuid) from public, anon;
grant execute on function public.social_studio_can_access_channel(uuid) to authenticated;

create or replace function public.social_studio_can_access_campaign(p_campaign_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.app_social_studio_campaigns c
        where c.id = p_campaign_id
          and public.is_team_member(c.team_id)
          and (c.project_id is null or public.is_project_team_member(c.project_id))
    );
$$;
revoke all on function public.social_studio_can_access_campaign(uuid) from public, anon;
grant execute on function public.social_studio_can_access_campaign(uuid) to authenticated;

create or replace function public.social_studio_can_access_post(p_post_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.app_social_studio_posts p
        where p.id = p_post_id
          and public.is_team_member(p.team_id)
          and (p.project_id is null or public.is_project_team_member(p.project_id))
    );
$$;
revoke all on function public.social_studio_can_access_post(uuid) from public, anon;
grant execute on function public.social_studio_can_access_post(uuid) to authenticated;

create or replace function public.social_studio_can_access_file(p_file_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.app_files_files f
        where f.id = p_file_id
          and public.is_team_member(f.team_id)
          and (f.project_id is null or public.is_project_team_member(f.project_id))
    );
$$;
revoke all on function public.social_studio_can_access_file(uuid) from public, anon;
grant execute on function public.social_studio_can_access_file(uuid) to authenticated;

/* ------------------------------------------------------------------ RLS */

alter table public.app_social_studio_channels enable row level security;
alter table public.app_social_studio_campaigns enable row level security;
alter table public.app_social_studio_posts enable row level security;
alter table public.app_social_studio_post_channels enable row level security;
alter table public.app_social_studio_post_assets enable row level security;

drop policy if exists app_social_studio_channels_all on public.app_social_studio_channels;
create policy app_social_studio_channels_all on public.app_social_studio_channels
    for all to authenticated
    using (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    )
    with check (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    );

drop policy if exists app_social_studio_campaigns_all on public.app_social_studio_campaigns;
create policy app_social_studio_campaigns_all on public.app_social_studio_campaigns
    for all to authenticated
    using (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    )
    with check (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    );

drop policy if exists app_social_studio_posts_all on public.app_social_studio_posts;
create policy app_social_studio_posts_all on public.app_social_studio_posts
    for all to authenticated
    using (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    )
    with check (
        public.is_team_member(team_id)
        and (project_id is null or public.is_project_team_member(project_id))
    );

drop policy if exists app_social_studio_post_channels_all on public.app_social_studio_post_channels;
create policy app_social_studio_post_channels_all on public.app_social_studio_post_channels
    for all to authenticated
    using (
        public.social_studio_can_access_post(post_id)
        and public.social_studio_can_access_channel(channel_id)
    )
    with check (
        public.social_studio_can_access_post(post_id)
        and public.social_studio_can_access_channel(channel_id)
    );

drop policy if exists app_social_studio_post_assets_all on public.app_social_studio_post_assets;
create policy app_social_studio_post_assets_all on public.app_social_studio_post_assets
    for all to authenticated
    using (
        public.social_studio_can_access_post(post_id)
        and public.social_studio_can_access_file(file_id)
    )
    with check (
        public.social_studio_can_access_post(post_id)
        and public.social_studio_can_access_file(file_id)
    );

/* --------------------------------------------------------------- grants */

revoke all on public.app_social_studio_channels from public, anon;
revoke all on public.app_social_studio_campaigns from public, anon;
revoke all on public.app_social_studio_posts from public, anon;
revoke all on public.app_social_studio_post_channels from public, anon;
revoke all on public.app_social_studio_post_assets from public, anon;
grant select, insert, update, delete on public.app_social_studio_channels to authenticated;
grant select, insert, update, delete on public.app_social_studio_campaigns to authenticated;
grant select, insert, update, delete on public.app_social_studio_posts to authenticated;
grant select, insert, update, delete on public.app_social_studio_post_channels to authenticated;
grant select, insert, update, delete on public.app_social_studio_post_assets to authenticated;
grant all on public.app_social_studio_channels to service_role;
grant all on public.app_social_studio_campaigns to service_role;
grant all on public.app_social_studio_posts to service_role;
grant all on public.app_social_studio_post_channels to service_role;
grant all on public.app_social_studio_post_assets to service_role;
