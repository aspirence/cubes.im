-- =============================================================================
-- Google-first Sheets — every Cubes sheet IS a real Google Sheet
-- =============================================================================
-- The sheet view no longer renders our own grid: it embeds the live Google
-- Sheet. That makes the Google file load-bearing rather than optional, and
-- two things follow from it.
--
--   1. PROVISIONING STATE. A sheet may exist before its Google file does — the
--      workspace has no Google account connected yet, or the create call to
--      Google failed. That is no longer "not linked" (a state with nothing to
--      show); it is a link row in 'pending' / 'failed', which the sheet view
--      reads to explain itself and to offer the button that finishes the job.
--      So connection_id and spreadsheet_id become nullable: a pending row has
--      neither yet, and it must still hold the sheet's one link slot so the
--      state has exactly one home.
--
--   2. SHARING. A file WE created is owned by the connected Google account, so
--      the Drive API can grant the team access to it. Whether we own the file
--      (owned_by_us) decides whether sharing is even possible — a file the user
--      picked from their own Drive is theirs, and Drive will refuse our
--      permission writes on it. The outcome of the last share pass is kept here
--      so the Google panel can name who was left out and why.
--
-- Push notifications (Drive files.watch) are NOT here. They live in
-- 20261142000000_drive_watch_channels.sql, which owns app_sheet_drive_channels
-- and watches every ready link in this table — including the ones this file's
-- provisioning creates. Two watchers on one file would mean two notifications
-- and two syncs per edit, so this migration deliberately has none.
--
-- Re-runnable and additive: add column if not exists, drop constraint if exists
-- before add, create or replace for functions. No existing row is rewritten.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. app_sheet_google_links — provisioning and sharing columns
-- -----------------------------------------------------------------------------
alter table public.app_sheet_google_links
    -- 'pending'  the Cubes sheet exists, the Google file does not yet
    -- 'ready'    there is a spreadsheet and a connection that can open it
    -- 'failed'   we tried and Google refused; provision_error says why
    add column if not exists provision_status text not null default 'ready',
    -- Member-readable, so sanitised text only — never Google's raw body.
    add column if not exists provision_error  text,
    add column if not exists provisioned_at   timestamptz,
    -- True only when Cubes created the file. Drive permission writes are
    -- attempted only then; on someone else's file they would 403 forever.
    add column if not exists owned_by_us      boolean not null default false,
    -- The Google account that owns the file, denormalised so the sheet view can
    -- say "ask <this person> to share it" without joining a table a member may
    -- not be able to read by the time the connection is gone.
    add column if not exists owner_email      text,
    -- Last Drive-permissions pass: 'ok' (everyone in scope has access),
    -- 'partial' (some members could not be shared with), 'failed'.
    add column if not exists share_status     text,
    add column if not exists share_error      text,
    -- { granted, unchanged, skipped, failed } plus a `left_out` array naming
    -- the members with no usable Google address. Sanitised before it is written.
    add column if not exists share_counts     jsonb,
    add column if not exists shared_at        timestamptz;

-- A pending link has no spreadsheet and no Google account yet. Both columns
-- were NOT NULL when a link could only be made by a user who already had both.
alter table public.app_sheet_google_links alter column connection_id  drop not null;
alter table public.app_sheet_google_links alter column spreadsheet_id drop not null;

-- …but a 'ready' link must have them, or the sync engine would run on nothing.
alter table public.app_sheet_google_links
    drop constraint if exists app_sheet_google_links_ready_check;
alter table public.app_sheet_google_links
    add constraint app_sheet_google_links_ready_check
    check (provision_status <> 'ready'
           or (spreadsheet_id is not null and connection_id is not null));

alter table public.app_sheet_google_links
    drop constraint if exists app_sheet_google_links_provision_check;
alter table public.app_sheet_google_links
    add constraint app_sheet_google_links_provision_check
    check (provision_status in ('pending', 'ready', 'failed'));

alter table public.app_sheet_google_links
    drop constraint if exists app_sheet_google_links_provision_error_check;
alter table public.app_sheet_google_links
    add constraint app_sheet_google_links_provision_error_check
    check (provision_error is null or char_length(provision_error) <= 1000);

alter table public.app_sheet_google_links
    drop constraint if exists app_sheet_google_links_share_status_check;
alter table public.app_sheet_google_links
    add constraint app_sheet_google_links_share_status_check
    check (share_status is null or share_status in ('ok', 'partial', 'failed'));

alter table public.app_sheet_google_links
    drop constraint if exists app_sheet_google_links_share_error_check;
alter table public.app_sheet_google_links
    add constraint app_sheet_google_links_share_error_check
    check (share_error is null or char_length(share_error) <= 1000);

alter table public.app_sheet_google_links
    drop constraint if exists app_sheet_google_links_owner_email_check;
alter table public.app_sheet_google_links
    add constraint app_sheet_google_links_owner_email_check
    check (owner_email is null or char_length(owner_email) between 3 and 320);

-- -----------------------------------------------------------------------------
-- 2. The team/connection guard trigger has to tolerate a pending row
-- -----------------------------------------------------------------------------
-- Same rule as before — team_id always follows the sheet, and a connection must
-- belong to that workspace — except that a pending link legitimately has no
-- connection yet.
create or replace function public.app_sheet_google_links_check()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    _team uuid;
begin
    select s.team_id into _team from public.app_sheets s where s.id = new.sheet_id;
    if _team is null then
        raise exception 'Sheet not found.' using errcode = 'P0002';
    end if;
    new.team_id := _team;
    if new.connection_id is not null
       and not exists (select 1 from public.app_google_connections c
                       where c.id = new.connection_id and c.team_id = _team) then
        raise exception 'That Google account belongs to another workspace.'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

revoke all on function public.app_sheet_google_links_check() from public, anon, authenticated;

drop trigger if exists app_sheet_google_links_team on public.app_sheet_google_links;
create trigger app_sheet_google_links_team
    before insert or update of sheet_id, team_id, connection_id on public.app_sheet_google_links
    for each row execute function public.app_sheet_google_links_check();


-- -----------------------------------------------------------------------------
-- 3. app_sheets_share_targets — who a sheet's Google file should be shared with
-- -----------------------------------------------------------------------------
-- The same access rule the sheet itself uses (team member; project member for a
-- project sheet), resolved to the email addresses Drive can grant to. Kept in
-- SQL rather than in Node because it is exactly app_sheets_can_access written
-- set-at-a-time, and the two must not be allowed to drift.
--
-- `limited` is carried out rather than filtered here: a limited member sees
-- only their own tasks in Cubes, so handing them the whole Google file would
-- widen their access. The caller drops them and says so — it does not skip
-- them silently.
--
-- The rule below is is_team_member() + is_project_team_member() rewritten to run
-- for a whole team at once, because those two take no user argument — they ask
-- about auth.uid(), and this has to ask about everybody. Two consequences worth
-- knowing:
--
--   * It must track them. In particular `member_type <> 'guest'` and
--     `active is true` are is_team_member()'s conditions verbatim; dropping
--     either would hand the file to someone who cannot open the sheet.
--   * Where it cannot track them exactly it UNDER-shares, never over-shares.
--     can_access_project()'s last branch ends in project_space_accessible(),
--     which recurses into folder permissions we cannot evaluate per user here.
--     So a non-private project counts only when it sits in no folder; inside a
--     folder, only its owner, its explicit members and workspace admins are
--     offered the file. The cost of that is someone seeing Google's access
--     screen and the panel telling them who to ask — visible and fixable with
--     one press of Re-share. The cost of the opposite is a leak.
create or replace function public.app_sheets_share_targets(p_sheet_id uuid)
    returns table (
        user_id      uuid,
        -- Named apart from users.name / users.email on purpose: an output
        -- parameter sharing a column's name is a resolution trap in a SQL
        -- function, and this one is security-sensitive enough not to risk it.
        member_name  text,
        member_email text,
        is_limited   boolean
    )
    language sql
    stable
    security definer
    set search_path = public
as
$$
    with sheet as (
        select s.team_id, s.project_id
        from public.app_sheets s
        where s.id = p_sheet_id
    ),
    proj as (
        select p.id, p.visibility, p.owner_id, p.folder_id
        from public.projects p
        join sheet sh on sh.project_id = p.id
    ),
    -- is_team_member(), for every member of the sheet's workspace at once.
    members as (
        select tm.id as member_id,
               tm.user_id,
               tm.member_type,
               -- is_team_admin(): the role flags, not the member_type string.
               (r.owner is true or r.admin_role is true) as is_admin
        from sheet sh
        join public.team_members tm on tm.team_id = sh.team_id
        left join public.roles r on r.id = tm.role_id
        where tm.active is true
          and tm.member_type <> 'guest'
          and tm.user_id is not null
    )
    -- A user with two member rows is one person to Drive; the row that grants
    -- the most wins, so "limited" only stands if every one of their rows is.
    select distinct on (m.user_id)
           m.user_id, u.name, u.email, m.member_type = 'limited'
    from members m
    join public.users u on u.id = m.user_id
    where coalesce(u.is_deleted, false) = false
      and ((select sh.project_id from sheet sh) is null
           or exists (select 1
                      from proj p
                      where p.owner_id = m.user_id
                         or m.is_admin
                         or exists (select 1 from public.project_members pm
                                    where pm.project_id = p.id
                                      and pm.team_member_id = m.member_id)
                         or (p.visibility <> 'private' and p.folder_id is null)))
    order by m.user_id, (m.member_type = 'limited');
$$;

revoke all on function public.app_sheets_share_targets(uuid) from public, anon, authenticated;
grant execute on function public.app_sheets_share_targets(uuid) to service_role;
