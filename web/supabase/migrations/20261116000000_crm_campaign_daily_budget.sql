-- =============================================================================
-- Cubes CRM — a campaign's daily budget, accrued into the spend log each day
-- =============================================================================
-- Ad platforms are told a daily budget once and then spend it every day. Asking
-- someone to hand-type a spend row per campaign per day is the thing they were
-- avoiding by setting a budget in the first place — so a campaign can carry
-- `daily_budget`, and a nightly sweep writes that day's row for every campaign
-- that is running.
--
-- The sweep is deliberately NON-DESTRUCTIVE: `on conflict do nothing` against
-- the (campaign_id, spend_on) unique index. A real figure typed in by hand — or
-- imported later — always wins over the budgeted guess, and re-running the job
-- can never double-count or overwrite.
-- =============================================================================

alter table public.app_crm_campaigns
    add column if not exists daily_budget numeric;

do $$
begin
    alter table public.app_crm_campaigns
        add constraint app_crm_campaigns_daily_budget_check
            check (daily_budget is null or daily_budget >= 0);
exception
    when duplicate_object then null;
end $$;

-- Marks a spend row as budget-derived rather than actual, so the UI can say so
-- and a later import knows what it may safely replace.
alter table public.app_crm_campaign_spend
    add column if not exists source text not null default 'manual';

do $$
begin
    alter table public.app_crm_campaign_spend
        add constraint app_crm_campaign_spend_source_check
            check (source in ('manual', 'budget'));
exception
    when duplicate_object then null;
end $$;


-- -----------------------------------------------------------------------------
-- crm_accrue_campaign_spend — write today's budgeted spend for running
-- campaigns. Returns how many rows it created (0 on a re-run).
--
-- "Running" means: not soft-deleted, status 'active', a positive daily_budget,
-- and today inside [started_on, ended_on] where those are set. `current_date`
-- is the server's date; campaigns are a per-day concept, so the small timezone
-- skew at the boundary is acceptable and self-correcting the next night.
-- -----------------------------------------------------------------------------
create or replace function public.crm_accrue_campaign_spend()
    returns integer
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _created integer;
begin
    insert into public.app_crm_campaign_spend
        (team_id, campaign_id, spend_on, amount, source, note)
    select
        c.team_id,
        c.id,
        current_date,
        c.daily_budget,
        'budget',
        'Daily budget'
    from public.app_crm_campaigns c
    where c.deleted_at is null
      and c.status = 'active'
      and c.daily_budget is not null
      and c.daily_budget > 0
      and (c.started_on is null or c.started_on <= current_date)
      and (c.ended_on   is null or c.ended_on   >= current_date)
    on conflict (campaign_id, spend_on) do nothing;

    get diagnostics _created = row_count;
    return _created;
end;
$$;

revoke all on function public.crm_accrue_campaign_spend() from public;
grant execute on function public.crm_accrue_campaign_spend() to service_role;


-- -----------------------------------------------------------------------------
-- Schedule: 00:20 every day, after midnight has definitely passed. Idempotent —
-- unschedule first so a re-run of this migration doesn't stack jobs.
-- -----------------------------------------------------------------------------
do $$
begin
    perform cron.unschedule('crm-accrue-campaign-spend');
exception
    when others then null;
end $$;

select cron.schedule(
    'crm-accrue-campaign-spend',
    '20 0 * * *',
    $job$ select public.crm_accrue_campaign_spend(); $job$
);
