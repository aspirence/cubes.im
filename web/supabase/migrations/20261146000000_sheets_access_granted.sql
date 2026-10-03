-- =============================================================================
-- Sheets — the Access row reads WHO THE LAST SHARE PASS GAVE THE FILE TO
-- =============================================================================
-- 20261144's app_sheets_access_list marked a member 'shared' when they had
-- joined before the last share pass (membership time <= shared_at). It never
-- asked whether that pass actually GRANTED them the file, so it claimed access
-- that did not exist:
--
--   * a member who was LIMITED when the pass ran (skipped) and was promoted
--     later came back 'shared', with a face and "You + N" — and then met
--     Google's access wall;
--   * a member with no Google-shaped address at the pass (left out, named in
--     share_counts.left_out) who fixed it later came back 'shared', so the
--     tooltip said "Not on Google: Dev" while drawing Dev's face;
--   * a member whose invitation Google REFUSED came back 'shared' too, which
--     is how "3 people can open it" sat above "Google refused 1".
--
-- The fix is to stop inferring and start recording.
--
--   1. app_sheet_share_grants — one row per member the share pass dealt with,
--      saying what Drive did: 'held' (Drive already listed them), 'granted',
--      'promoted', or 'refused'. google-share.ts recordShare writes it, stamped
--      with the pass's own shared_at, and only then marks the link's
--      share_counts with per_person = true.
--   2. app_sheets_access_list reads that record instead of membership time.
--
-- WHY A TABLE, NOT share_counts.granted_ids: share_counts is on
-- app_sheet_google_links, whose SELECT policy is app_sheets_can_access() — so
-- LIMITED members read it. A roster of who holds the file in that column
-- would hand them exactly what this function refuses them. The table has RLS
-- on, no policies and no grants to anon/authenticated: the only way to read it
-- is through the SECURITY DEFINER function below, which returns nothing to a
-- limited caller. It is also per-person data with a lifecycle (it cascades
-- with its link), which a jsonb array would have to re-implement.
--
-- WHY THE ROWS CARRY shared_at: the link update and the grant rows are two
-- writes. The function trusts a grant row only when its shared_at equals the
-- link's, so a half-finished record (either write failing, or two passes
-- interleaving) can only make people look like they do NOT have the file —
-- never the reverse.
--
-- WHY THE ROWS CARRY address_sha256: Drive grants an ADDRESS, not a Cubes
-- user. If a member's address changes after the grant, Drive still holds the
-- old one. The row keeps a fingerprint of the address Drive was given (not the
-- address: this table needs only to notice a change) and the function stops
-- vouching when it no longer matches. Normalisation differences between the
-- writer and this function can only produce a mismatch, i.e. an under-claim.
--
-- LINKS SHARED BEFORE THIS MIGRATION have no rows and no per_person marker.
-- Until their next share pass the function returns every member but the
-- owner as 'not_yet', and the card (sheet-list-model.ts describeAccess) shows
-- the pass's own count ("Shared with N") with no faces and no claim about the
-- viewer. Nothing is backfilled: the only honest source of "who was granted"
-- is a pass that recorded it. Re-sharing from the sheet's Google panel (or a
-- member joining, or re-provisioning) records it.
--
-- Re-runnable and additive: create table if not exists, create or replace,
-- revoke/grant. No existing row is rewritten.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. app_sheet_share_grants — what the last Drive share pass did, per member
-- -----------------------------------------------------------------------------
create table if not exists public.app_sheet_share_grants (
    link_id        uuid        not null,
    user_id        uuid        not null,
    -- 'held'     Drive already listed them with at least the planned role
    -- 'granted'  this pass created their permission
    -- 'promoted' this pass raised their reader permission to writer
    -- 'refused'  Drive refused the grant or the promotion. A refused promotion
    --            still leaves them a reader; it is recorded as refused anyway,
    --            because the card promises the planned role and would
    --            over-claim it.
    outcome        text        not null,
    -- sha256 hex of the lower-cased address Drive was given (see the header).
    address_sha256 text        not null,
    -- The pass that wrote the row. Trusted only while it equals the link's
    -- shared_at, i.e. while it is the link's latest pass.
    shared_at      timestamptz not null,
    constraint app_sheet_share_grants_pk primary key (link_id, user_id),
    -- A grant record is meaningless without its link.
    constraint app_sheet_share_grants_link_fk
        foreign key (link_id) references public.app_sheet_google_links (id) on delete cascade,
    constraint app_sheet_share_grants_outcome_check
        check (outcome in ('held', 'granted', 'promoted', 'refused')),
    constraint app_sheet_share_grants_address_check
        check (address_sha256 ~ '^[0-9a-f]{64}$')
);

comment on table public.app_sheet_share_grants is
    'Per member: what the last Drive share pass did (held / granted / promoted / refused). Written by google-share.ts recordShare with the service role; read only through app_sheets_access_list. No client access.';

-- No policies on purpose: with RLS on, nothing but the owner (the definer
-- function) and the service role can see a row. The revoke undoes Supabase's
-- default table privileges, so a direct read fails loudly rather than
-- returning an empty set that looks like "nobody has it".
alter table public.app_sheet_share_grants enable row level security;
revoke all on table public.app_sheet_share_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.app_sheet_share_grants to service_role;


-- -----------------------------------------------------------------------------
-- 2. app_sheets_access_list — replaced; same signature, same callers
-- -----------------------------------------------------------------------------
-- WHAT EACH ANSWER MEANS:
--
--   owner    the member whose address owns the file. They have it by
--            ownership, whatever any pass did.
--   shared   the link's latest pass is recorded (share_counts.per_person) and
--            recorded this member as held / granted / promoted, for the
--            address they still have.
--   refused  the latest recorded pass asked Drive to share it with them and
--            Drive refused.
--   not_yet  everyone else who would be offered the file now: joined after
--            the pass, limited or addressless at the pass and changed since,
--            skipped because the pass was cut short, a changed address, or a
--            link whose pass predates the record. They do NOT have it until a
--            pass grants it.
--   no_email the pass cannot give them the file: no Google-shaped address.
--
-- ORDER OF THE RULES follows planShares in google-share.ts: limited first,
-- so a limited member is never returned — not even as the OWNER of a file
-- they picked from their own Drive, which would put their face "(owner)" on
-- every full member's card.
--
-- NOT RETURNED, on purpose (unchanged from 20261144):
--   * limited members (Decision B: Drive shares whole files, never rows);
--   * anyone but the owner for a file Cubes did not create (owned_by_us =
--     false): Cubes never shares those and cannot see who their owner did;
--   * anything at all when the CALLER is a limited member;
--   * email addresses — user_id only.
--
-- ACCESS RULE: exactly the sheets app_sheets_can_access() answers true for,
-- called per sheet (the same function the app_sheet* SELECT policies use).
create or replace function public.app_sheets_access_list(p_team_id uuid)
    returns table (
        sheet_id uuid,
        user_id  uuid,
        -- 'owner' | 'shared' | 'refused' | 'not_yet' | 'no_email' — see above.
        access   text
    )
    language sql
    stable
    security definer
    set search_path = public
as
$$
    with link as (
        select l.id as link_id,
               l.sheet_id,
               l.owned_by_us,
               l.shared_at,
               nullif(lower(btrim(l.owner_email)), '') as owner_email,
               -- Written by recordShare only after the grant rows landed. A
               -- link without it has no per-person record to trust.
               coalesce(l.share_counts ->> 'per_person' = 'true', false) as recorded
        from public.app_sheet_google_links l
        join public.app_sheets s on s.id = l.sheet_id and s.team_id = l.team_id
        where l.team_id = p_team_id
          and l.provision_status = 'ready'
          and not coalesce(public.is_limited_member(p_team_id), false)
          and public.app_sheets_can_access(l.sheet_id)
    ),
    target as (
        -- The very rows planShares is fed, sheet by sheet.
        select k.link_id,
               k.sheet_id,
               k.owned_by_us,
               k.shared_at,
               k.owner_email,
               k.recorded,
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
                   -- planShares' first rule, and it outranks ownership: a
                   -- limited member is never shown, whatever they own.
                   when g.is_limited then null
                   -- Ownership is a fact about the file, not a grant we made.
                   when g.owner_email is not null and g.email = g.owner_email then 'owner'
                   -- Someone else's file: Cubes shared nothing, and knows nothing.
                   when not g.owned_by_us then null
                   -- looksLikeEmail() in google-share.ts, verbatim.
                   when g.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then 'no_email'
                   -- No pass, or a pass from before the record: under-claim.
                   when g.shared_at is null or not g.recorded then 'not_yet'
                   when gr.outcome in ('held', 'granted', 'promoted') then 'shared'
                   when gr.outcome = 'refused' then 'refused'
                   else 'not_yet'
               end as access
        from target g
        left join public.app_sheet_share_grants gr
               on gr.link_id = g.link_id
              and gr.user_id = g.member_id
              -- Only the link's latest pass counts (see the header).
              and gr.shared_at = g.shared_at
              -- …and only for the address Drive was actually given.
              and gr.address_sha256 = encode(sha256(convert_to(g.email, 'UTF8')), 'hex')
    )
    -- planShares grants an address once, to the first target that has it; one
    -- address is one face. Anyone else is keyed by their own id. Within an
    -- address, the person the record vouches for wins over a twin it does not.
    select distinct on (j.sheet_id, case when j.access in ('shared', 'refused', 'not_yet') then j.email else j.member_id::text end)
           j.sheet_id,
           j.member_id,
           j.access
    from judged j
    where j.access is not null
    order by j.sheet_id,
             case when j.access in ('shared', 'refused', 'not_yet') then j.email else j.member_id::text end,
             case j.access when 'shared' then 0 when 'refused' then 1 else 2 end,
             j.member_id;
$$;

comment on function public.app_sheets_access_list(uuid) is
    'Sheets list: who can open each sheet''s Google file (owner / shared / refused / not_yet / no_email), read from the last share pass''s recorded grants (app_sheet_share_grants), for every sheet of the workspace the caller can access. No emails; nothing for limited callers.';

revoke all on function public.app_sheets_access_list(uuid) from public, anon;
grant execute on function public.app_sheets_access_list(uuid) to authenticated, service_role;
