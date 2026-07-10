-- =============================================================================
-- Team settings — task-ID display format.
--
-- Teams can choose how a task's human ID renders (e.g. "PAY2-012" vs "#12"):
--   * prefixSource : "project_key" | "custom" | "none"
--   * customPrefix : text used when prefixSource = "custom"
--   * separator    : between prefix and number ("-", "_", " ", "")
--   * padding      : zero-pad width for the number (0 = none)
--   * uppercase    : upper-case the prefix
--
-- Stored as a small per-team settings row (one column now, room to grow).
-- Members read; only team admins write.
-- =============================================================================

create table if not exists public.team_settings (
    team_id        uuid                     primary key
                     references public.teams (id) on delete cascade,
    task_id_format jsonb                    not null default '{}'::jsonb,
    updated_at     timestamp with time zone not null default current_timestamp
);

alter table public.team_settings enable row level security;

drop policy if exists team_settings_select on public.team_settings;
create policy team_settings_select on public.team_settings
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists team_settings_write on public.team_settings;
create policy team_settings_write on public.team_settings
    for all to authenticated
    using (public.is_team_admin(team_id))
    with check (public.is_team_admin(team_id));

revoke all on public.team_settings from public, anon;
grant select, insert, update, delete on public.team_settings to authenticated;
grant all on public.team_settings to service_role;
