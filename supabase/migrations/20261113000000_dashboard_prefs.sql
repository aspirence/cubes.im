-- =============================================================================
-- Home dashboard — saved global filter prefs
-- =============================================================================
-- The dashboard header's global lenses (time range + person) can now be saved
-- per user, so the same filter greets them next visit. Stored as a small jsonb
-- blob ({ "range": "today", "assigneeId": "<team_member uuid>" }) on the
-- existing per-user dashboard row; the row's own RLS (self-only) already
-- covers it.
-- =============================================================================

alter table public.user_dashboards
    add column if not exists prefs jsonb default '{}'::jsonb not null;

do $$
begin
    alter table public.user_dashboards
        add constraint user_dashboards_prefs_is_object
            check (jsonb_typeof(prefs) = 'object');
exception
    when duplicate_object then null;
end $$;
