-- =============================================================================
-- Cubes CRM — lead tier (Bronze / Silver / Gold)
-- =============================================================================
-- A THIRD axis on a deal, and the reason it is a third rather than folded into
-- one of the two that exist:
--
--   * stage_id  — where the card sits on the board. Per-team, user-configurable.
--   * status    — how the lead is DOING right now. Fixed vocabulary, and it
--                 moves constantly: new → contacted → follow_up → junk.
--   * tier      — how much the lead is WORTH. Set once by a human who looked at
--                 it, and then it mostly stays put.
--
-- Status answers "what happened to this lead", tier answers "which leads
-- deserve the next hour". Those go out of sync on purpose: a Gold lead that
-- went quiet is still Gold, and that is exactly the list someone wants when
-- they come back to re-plan. Folding tier into status would destroy that —
-- marking the lead 'follow_up' would erase the fact that it was worth chasing.
--
-- NULLABLE, with no default. An ungraded lead is not Bronze; it is a lead
-- nobody has judged yet, and defaulting everyone to the bottom rung would put a
-- verdict in the database that no human ever gave. "Ungraded" has to stay
-- distinguishable from "graded low" or the tier list is worthless.
--
-- Re-runnable: add column if not exists / do-block guarded constraint /
-- create index if not exists / create or replace function.
-- =============================================================================


-- =============================================================================
-- SECTION 1: The column
-- =============================================================================

alter table public.app_crm_deals
    add column if not exists tier text;

-- Three rungs, lowest first. Fixed vocabulary for the same reason status is
-- fixed: dashboards, filters and reports all have to compare it across teams.
do $$
begin
    alter table public.app_crm_deals
        add constraint app_crm_deals_tier_check
        check (tier is null or tier in ('bronze', 'silver', 'gold'));
exception
    when duplicate_object then null;
end $$;

-- "Show me the Gold leads on this team" is the whole point of the column, and
-- it is always asked within one team.
create index if not exists app_crm_deals_tier_idx
    on public.app_crm_deals (team_id, tier);


-- =============================================================================
-- SECTION 2: Timeline — a re-grade is its own event
-- =============================================================================

-- Without this a tier change falls through to the generic 'updated' branch and
-- renders as "updated tier" with no before or after. Tier is a judgement call,
-- so "who downgraded this from Gold, and when" is precisely the question the
-- timeline gets asked — the same argument that gave `status` its own event in
-- 20261115000000.
--
-- Re-created wholesale (create or replace) rather than patched, because a
-- trigger function has no partial form. Only the tier branch below is new; the
-- rest is carried forward verbatim from 20261115000000.
create or replace function public.app_crm_track_record()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _target  text := tg_argv[0];
    _event   text;
    _props   jsonb := '{}'::jsonb;
    _changed text[];
begin
    if tg_op = 'INSERT' then
        _event := 'created';
    elsif old.deleted_at is null and new.deleted_at is not null then
        _event := 'deleted';
    elsif old.deleted_at is not null and new.deleted_at is null then
        _event := 'restored';
    else
        select coalesce(array_agg(o.key order by o.key), '{}'::text[])
        into _changed
        from jsonb_each(to_jsonb(old)) as o(key, value)
        join jsonb_each(to_jsonb(new)) as n(key, value) on n.key = o.key
        where o.value is distinct from n.value
          and o.key not in ('updated_at', 'created_at', 'position', 'deleted_at');

        if coalesce(array_length(_changed, 1), 0) = 0 then
            return new;
        end if;

        _event := 'updated';
        _props := jsonb_build_object('fields', to_jsonb(_changed));

        if _target = 'deal' and 'stage_id' = any (_changed) then
            _event := 'stage_changed';
            _props := _props || jsonb_build_object(
                'from', (select s.name from public.app_crm_stages s where s.id = old.stage_id),
                'to',   (select s.name from public.app_crm_stages s where s.id = new.stage_id));
        elsif _target = 'deal' and 'status' = any (_changed) then
            _event := 'status_changed';
            _props := _props || jsonb_build_object(
                'from', old.status,
                'to',   new.status);
        elsif _target = 'deal' and 'tier' = any (_changed) then
            _event := 'tier_changed';
            -- Raw values; the client has crmLeadTierMeta to label them, and a
            -- null end reads as ungraded rather than as a missing property.
            _props := _props || jsonb_build_object(
                'from', old.tier,
                'to',   new.tier);
        end if;
    end if;

    insert into public.app_crm_activities (team_id, target_type, target_id, event, properties, actor_id)
    values (new.team_id, _target, new.id, _event, _props, auth.uid());
    return new;
end;
$$;
