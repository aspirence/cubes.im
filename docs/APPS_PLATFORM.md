# Apps Platform — authoring guide

The **Apps platform** lets a team install prebuilt first-party **feature apps**
(mini-applications) that plug into the core `teams` / `projects` / `tasks` data.

> Not to be confused with the **App Center connectors** (`app_connections`,
> `/settings/apps`), which reach *external* services (Slack, webhook). Those send
> data *out*; feature apps *are* product surfaces built *on* the core data.

## The three pieces

| Piece | Where | Role |
|---|---|---|
| **Catalog** | `src/lib/apps-platform/catalog.ts` (code) | What can be installed + how it's described. First-party apps are code, so the catalog is a typed array. |
| **Installations** | `installed_apps` table (`20261013`) | Which apps a team has installed. RLS: read = team member, write = team admin. `unique(team_id, app_key)`. |
| **Per-app data** | `app_<key>_*` tables (one migration per app) | The app's own storage, joined to the core by real FKs and the shared RLS helpers. |

## How an app "connects to" core tables (the important part)

An app never invents its own tenancy. It stores data in tables named
`app_<key>_<entity>` that carry **real foreign keys** into the core
(`project_id → projects`, `task_id → tasks`, `team_id → teams`) with
`ON DELETE CASCADE`, and it reuses the **same RLS helpers** every other table
uses:

- read → `is_team_member(team_id)` (or `is_project_team_member(project_id)`)
- write → `is_team_admin(team_id)` / `is_project_team_admin(project_id)` /
  membership, matching the sensitivity of the write.

Because the FK resolves the owning team and the policy calls the shared helper,
an app **automatically** inherits multi-tenant isolation: a caller only ever sees
rows for teams/projects they belong to, and no app can read another team's data.
Deleting a project cascades its app data. This is the whole safety story — no
app-specific auth code.

## Adding a new app (checklist)

1. **Catalog entry** — add an `AppDescriptor` to `APP_CATALOG` with
   `status: "coming_soon"` and its `coreAccess` (shown to admins at install).
2. **Migration** — `supabase/migrations/<ts>_app_<key>.sql`: create the
   `app_<key>_*` tables (FK to core, cascade), enable RLS, add member-read /
   admin-or-membership-write policies, grant `authenticated` + `service_role`,
   `revoke ... from anon`. Timestamp after the latest migration; keep it
   idempotent. Apply to the docker DB and RLS-test (member reads, non-member
   denied) before shipping.
3. **Types** — hand-add the new tables to `src/types/database.ts` in the
   generated format (regen tends to hang here).
4. **Feature hooks** — `src/features/app-<key>/…` (TanStack Query, team/project
   scoped, same pattern as `use-projects.ts`).
5. **Routes** — pages under `src/app/(app)/apps/<key>/…`. Gate each page on the
   app being installed **and enabled** for the active team (read `useInstalledApps`);
   otherwise send the user to `/apps` to install it.
6. **Flip status** to `"available"` and the catalog card's **Open** button
   activates.

## Worked example — Video Review (`key: "video_review"`)

Registered in the catalog as `coming_soon`. When it's built, its migration would
add (illustrative):

```sql
-- app_video_review_videos: a video uploaded against a project.
create table public.app_video_review_videos (
    id         uuid default gen_random_uuid() primary key,
    project_id uuid not null references public.projects(id) on delete cascade,
    team_id    uuid not null references public.teams(id)    on delete cascade,
    title      text not null,
    storage_path text not null,           -- reuse the existing storage bucket
    created_by uuid references public.users(id) on delete set null,
    created_at timestamptz default now() not null
);

-- app_video_review_comments: a timestamped note, optionally linked to a task.
create table public.app_video_review_comments (
    id         uuid default gen_random_uuid() primary key,
    video_id   uuid not null references public.app_video_review_videos(id) on delete cascade,
    task_id    uuid references public.tasks(id) on delete set null,  -- turn a note into work
    at_seconds numeric not null,          -- frame-accurate position
    body       text not null,
    author_id  uuid references public.users(id) on delete set null,
    created_at timestamptz default now() not null
);

alter table public.app_video_review_videos   enable row level security;
alter table public.app_video_review_comments enable row level security;

-- read = project team member; write = project team member (collaborative).
create policy avr_videos_read on public.app_video_review_videos
    for select to authenticated using (public.is_project_team_member(project_id));
create policy avr_videos_write on public.app_video_review_videos
    for all to authenticated
    using (public.is_project_team_member(project_id))
    with check (public.is_project_team_member(project_id));
-- comments authorize via their video's project (join), same helper.
```

Notes stay next to the project's tasks (`task_id` FK), the video lives on the
project (`project_id` FK), and RLS is the existing `is_project_team_member` — so
the app is multi-tenant-safe with zero bespoke auth. Its UI lives at
`/apps/video-review`, gated on the app being installed + enabled.
