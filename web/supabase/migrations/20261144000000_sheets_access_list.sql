-- =============================================================================
-- Sheets — who can open each sheet's Google Sheet, for the whole list at once
-- =============================================================================
-- The sheet list's cards carry an "Access" row: the people who can actually
-- open the sheet's Google file, and whether the person looking is one of them.
-- The per-sheet answer already exists (app_sheets_share_targets, which
-- google-share.ts turns into Drive grants with planShares), but it is
-- service-role only, returns email addresses, and is one call per sheet — a
-- card grid would be a request per card. This is the same rule, for every sheet
-- of a workspace the caller can open, in ONE call, with no addresses in it.
--
-- WHAT "HAS ACCESS" MEANS HERE — the truth planShares and syncSheetShares tell:
--
--   owner    the member whose address owns the file. They have it by ownership,
--            whatever the share pass did or did not do.
--   shared   a member the last share pass offered the file to: not limited,
--            with a Google-shaped address, not the owner, and already a member
--            (of the workspace, and of the project when they are one by
--            project_members) when that pass ran (app_sheet_google_links
--            .shared_at). Drive refusals are NOT per-person in the database —
--            share_counts.failed is a count — so the client says "N of M" when
--            it is non-zero rather than vouching for anyone.
--   not_yet  would be offered the file now, but joined after the last pass
--            (or no pass has run): they do NOT have it until someone re-shares.
--   no_email the pass leaves them out: no address Drive could be given.
--
-- NOT RETURNED, on purpose:
--   * limited members. Decision B: Drive shares whole files, never rows, so a
--     member restricted to their own rows is never given the file. They are not
--     "people without access yet" and nothing should invite anyone to fix that.
--   * anything for a file Cubes did not create (owned_by_us = false) beyond its
--     owner: Cubes never shares those, and cannot see who their owner did.
--   * anything at all when the CALLER is a limited member. Their card shows no
--     Google parts (the list hides the link for them), so they need no roster
--     of who holds the file, and this returns them nothing rather than rely on
--     the client to look away.
--   * email addresses. user_id only: the client already has names and photos
--     from the team roster it caches.
--
-- WHERE IT CANNOT BE EXACT IT UNDER-CLAIMS. "Already a member when the pass
-- ran" reads team_members.created_at and project_members.created_at; a member
-- who joined the project by a later project_members row counts as not_yet even
-- if an older admin role or an open project had already qualified them. Saying
-- "not shared with you yet" to someone who can open the file costs a click;
-- saying "you have access" to someone who meets Google's access screen is the
-- thing this row exists to stop.
--
-- ACCESS RULE: the sheets returned are exactly those app_sheets_can_access()
-- answers true for the caller — the same function the app_sheet* SELECT
-- policies use, called per sheet, not re-derived — so this can never show a
-- card's access to someone who cannot see the card.
--
-- Re-runnable: create or replace + revoke/grant.

create or replace function public.app_sheets_access_list(p_team_id uuid)
    returns table (
        sheet_id uuid,
        user_id  uuid,
        -- 'owner' | 'shared' | 'not_yet' | 'no_email' — see the header.
        access   text
    )
    language sql
    stable
    security definer
    set search_path = public
as
$$
    with link as (
        select l.sheet_id,
               s.project_id,
               l.owned_by_us,
               l.shared_at,
               nullif(lower(btrim(l.owner_email)), '') as owner_email
        from public.app_sheet_google_links l
        join public.app_sheets s on s.id = l.sheet_id and s.team_id = l.team_id
        where l.team_id = p_team_id
          and l.provision_status = 'ready'
          and not coalesce(public.is_limited_member(p_team_id), false)
          and public.app_sheets_can_access(l.sheet_id)
    ),
    target as (
        -- The very rows planShares is fed, sheet by sheet.
        select k.sheet_id,
               k.project_id,
               k.owned_by_us,
               k.shared_at,
               k.owner_email,
               t.user_id as member_id,
               t.is_limited,
               lower(btrim(coalesce(t.member_email, ''))) as email
        from link k
        cross join lateral public.app_sheets_share_targets(k.sheet_id) t
    ),
    judged as (
        select g.sheet_id,
               g.member_id,
               g.email,
               case
                   -- Ownership is a fact about the file, not a grant we made.
                   when g.owner_email is not null and g.email = g.owner_email then 'owner'
                   -- Someone else's file: Cubes shared nothing, and knows nothing.
                   when not g.owned_by_us then null
                   when g.is_limited then null
                   -- looksLikeEmail() in google-share.ts, verbatim.
                   when g.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then 'no_email'
                   when g.shared_at is null then 'not_yet'
                   when since.at is not null and since.at <= g.shared_at then 'shared'
                   else 'not_yet'
               end as access
        from target g
        cross join lateral (
            -- greatest() skips a null, so a member with no project_members row
            -- is dated by their workspace membership alone.
            select greatest(
                       (select min(tm.created_at)
                        from public.team_members tm
                        where tm.team_id = p_team_id
                          and tm.user_id = g.member_id
                          and tm.active is true
                          and tm.member_type <> 'guest'),
                       (select min(pm.created_at)
                        from public.project_members pm
                        join public.team_members tm on tm.id = pm.team_member_id
                        where g.project_id is not null
                          and pm.project_id = g.project_id
                          and tm.team_id = p_team_id
                          and tm.user_id = g.member_id)
                   ) as at
        ) since
    )
    -- planShares grants an address once, to the first target that has it (they
    -- arrive ordered by user id); everyone else is keyed by their own id.
    select distinct on (j.sheet_id, case when j.access in ('shared', 'not_yet') then j.email else j.member_id::text end)
           j.sheet_id,
           j.member_id,
           j.access
    from judged j
    where j.access is not null
    order by j.sheet_id,
             case when j.access in ('shared', 'not_yet') then j.email else j.member_id::text end,
             j.member_id;
$$;

comment on function public.app_sheets_access_list(uuid) is
    'Sheets list: who can open each sheet''s Google file (owner / shared / not_yet / no_email), for every sheet of the workspace the caller can access. No emails; nothing for limited callers.';

revoke all on function public.app_sheets_access_list(uuid) from public, anon;
grant execute on function public.app_sheets_access_list(uuid) to authenticated, service_role;
