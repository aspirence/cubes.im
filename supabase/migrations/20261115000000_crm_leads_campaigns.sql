-- =============================================================================
-- Cubes CRM — marketing lead management: lead status, campaigns, reminders
-- =============================================================================
-- The CRM is worked as a MARKETING LEAD desk: leads arrive from paid campaigns,
-- the team calls them, and someone wants to know what a lead actually cost. Three
-- additions on top of 20261110000000_app_crm.sql, none of which rename anything —
-- deals stay Deals:
--
--   * app_crm_deals.status — the LEAD's own health, deliberately SEPARATE from
--     stage_id. Stage answers "where is this card on the board" (per-team,
--     user-configurable); status answers "how is this lead doing" and is a FIXED
--     vocabulary the whole product can reason about (dashboards, filters,
--     cost-per-lead). Two axes, two columns; folding them together would make
--     the pipeline un-editable or the reporting un-comparable.
--
--   * app_crm_campaigns + app_crm_campaign_spend — a campaign is the source of
--     leads; spend is recorded as ONE ROW PER CAMPAIGN PER DAY (that is what ad
--     platforms report and what a human types in). UNIQUE (campaign_id,
--     spend_on) makes re-entering a day an upsert rather than a duplicate.
--     app_crm_deals.campaign_id closes the loop: cost-per-lead is
--     sum(spend) / count(deals) over any window, derived, never stored.
--
--   * app_crm_reminders — "remind ME about this record at this time". NOT a CRM
--     task: a task is work assigned to someone with a lifecycle (TODO →  DONE)
--     and lives in the task list; a reminder is a private nudge attached to one
--     record that FIRES once and then goes quiet. Different grain, different
--     table. Delivery is server-side (crm_fire_due_reminders + pg_cron below) so
--     it works with the tab closed — a client-side timer would not. The sweep
--     only fires at a LIVE record for someone who can still open it, and
--     dismissed reminders are swept away after ninety days.
--
-- One thing this migration also re-creates: app_crm_track_record() from
-- 20261110000000, so that a deal's `status` change gets its own timeline event
-- with from/to, the way a stage move already does (SECTION 7).
--
-- Money note: deals carry no amount in this product. CAMPAIGN SPEND (here) and
-- company annual revenue are the only money in the CRM.
--
-- Re-runnable: add column if not exists / create table if not exists / do-block
-- guarded constraints / drop policy if exists / create or replace function.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Lead status on the deal
-- =============================================================================

alter table public.app_crm_deals
    add column if not exists status text default 'new' not null;

-- Fixed vocabulary — NOT user-configurable (that is what stages are for).
-- 'converted' is the happy end; 'junk' and 'not_interested' are distinct on
-- purpose: junk pollutes cost-per-lead, not-interested does not.
do $$
begin
    alter table public.app_crm_deals
        add constraint app_crm_deals_status_check
        check (status in ('new', 'contacted', 'follow_up', 'qualified',
                          'not_interested', 'junk', 'converted'));
exception
    when duplicate_object then null;
end $$;

create index if not exists app_crm_deals_status_idx
    on public.app_crm_deals (team_id, status);


-- =============================================================================
-- SECTION 2: Campaigns + daily spend
-- =============================================================================

-- 2.1 app_crm_campaigns — the lead source. `channel` is free text (the UI offers
--     Meta / Google / LinkedIn / WhatsApp / Referral / Offline / Other) because
--     ad platforms multiply faster than migrations do. Soft delete like every
--     other CRM object, so a deleted campaign never orphans its history.
create table if not exists public.app_crm_campaigns (
    id            uuid                     default gen_random_uuid() not null,
    team_id       uuid                                               not null,
    name          text                                               not null,
    channel       text,
    status        text                     default 'active'          not null,
    currency_code text                     default 'INR'             not null,
    started_on    date,
    ended_on      date,
    notes         text,
    created_by    uuid,
    created_at    timestamp with time zone default current_timestamp not null,
    updated_at    timestamp with time zone default current_timestamp not null,
    deleted_at    timestamp with time zone,
    constraint app_crm_campaigns_pk primary key (id),
    constraint app_crm_campaigns_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_campaigns_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_crm_campaigns_name_check check (char_length(name) between 1 and 200),
    constraint app_crm_campaigns_status_check
        check (status in ('draft', 'active', 'paused', 'ended'))
);

-- 2.2 app_crm_campaign_spend — one row per campaign per DAY. The UNIQUE below is
--     the whole design: the app upserts on (campaign_id, spend_on), so typing
--     today's number twice corrects it instead of double-counting it.
create table if not exists public.app_crm_campaign_spend (
    id          uuid                     default gen_random_uuid() not null,
    team_id     uuid                                               not null,
    campaign_id uuid                                               not null,
    spend_on    date                                               not null,
    amount      numeric                                            not null,
    note        text,
    created_by  uuid,
    created_at  timestamp with time zone default current_timestamp not null,
    constraint app_crm_campaign_spend_pk primary key (id),
    constraint app_crm_campaign_spend_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_campaign_spend_campaign_id_fk
        foreign key (campaign_id) references public.app_crm_campaigns (id) on delete cascade,
    constraint app_crm_campaign_spend_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_crm_campaign_spend_amount_check check (amount >= 0),
    constraint app_crm_campaign_spend_day_uindex unique (campaign_id, spend_on)
);

-- 2.3 Deal → campaign. SET NULL: a deal outlives the campaign that sourced it
--     (the lead is still real), it just stops counting toward that campaign.
alter table public.app_crm_deals
    add column if not exists campaign_id uuid references public.app_crm_campaigns (id) on delete set null;

-- 2.4 Same-team guard for spend. RLS only checks `team_id`, and the UNIQUE above
--     is on (campaign_id, spend_on) WITHOUT team_id — so without this a CRM
--     admin of team A could insert `team_id = A, campaign_id = <team B's>` and
--     permanently squat the (campaign, day) slot team B's upsert needs, on a row
--     team B's policy cannot see or update. Cheap trigger, closes it at the
--     source rather than widening the key the app upserts on.
create or replace function public.app_crm_campaign_spend_same_team()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
begin
    if not exists (
        select 1
        from public.app_crm_campaigns c
        where c.id = new.campaign_id
          and c.team_id = new.team_id
    ) then
        raise exception 'campaign % does not belong to team %',
            new.campaign_id, new.team_id
            using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

drop trigger if exists app_crm_campaign_spend_same_team on public.app_crm_campaign_spend;
create trigger app_crm_campaign_spend_same_team
    before insert or update of campaign_id, team_id on public.app_crm_campaign_spend
    for each row execute function public.app_crm_campaign_spend_same_team();

create index if not exists app_crm_campaigns_team_idx
    on public.app_crm_campaigns (team_id);
create index if not exists app_crm_campaign_spend_team_idx
    on public.app_crm_campaign_spend (team_id, spend_on);
create index if not exists app_crm_deals_campaign_idx
    on public.app_crm_deals (campaign_id);


-- =============================================================================
-- SECTION 3: Reminders
-- =============================================================================

-- Polymorphic target with no FK on target_id — exactly like app_crm_task_targets
-- (it points at people OR companies OR deals). user_id is WHO gets reminded and
-- CASCADEs: a reminder for a departed user is noise nobody will ever read.
-- done_at = dismissed by the human; notified_at = stamped by the sweep so a
-- reminder fires exactly once.
create table if not exists public.app_crm_reminders (
    id          uuid                     default gen_random_uuid() not null,
    team_id     uuid                                               not null,
    target_type text                                               not null,
    target_id   uuid                                               not null,
    remind_at   timestamp with time zone                           not null,
    note        text,
    user_id     uuid                                               not null,
    done_at     timestamp with time zone,
    notified_at timestamp with time zone,
    created_by  uuid,
    created_at  timestamp with time zone default current_timestamp not null,
    constraint app_crm_reminders_pk primary key (id),
    constraint app_crm_reminders_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_reminders_user_id_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint app_crm_reminders_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_crm_reminders_type_check
        check (target_type in ('person', 'company', 'deal'))
);

create index if not exists app_crm_reminders_team_idx
    on public.app_crm_reminders (team_id, remind_at);

-- The sweep's index: partial, so it stays tiny no matter how much reminder
-- history piles up — only rows that can still fire are in it.
create index if not exists app_crm_reminders_due_idx
    on public.app_crm_reminders (remind_at)
    where notified_at is null and done_at is null;


-- =============================================================================
-- SECTION 4: Triggers — updated_at
-- =============================================================================

drop trigger if exists app_crm_campaigns_set_updated_at on public.app_crm_campaigns;
create trigger app_crm_campaigns_set_updated_at
    before update on public.app_crm_campaigns
    for each row execute function public.set_row_updated_at();


-- =============================================================================
-- SECTION 5: RLS
-- =============================================================================

alter table public.app_crm_campaigns      enable row level security;
alter table public.app_crm_campaign_spend enable row level security;
alter table public.app_crm_reminders      enable row level security;

-- Same shape as every other CRM object: full CRUD for CRM admins (team owner +
-- granted members). A reminder is personal but not secret — the team that can
-- see the lead can see the nudge on it.
drop policy if exists app_crm_campaigns_all on public.app_crm_campaigns;
create policy app_crm_campaigns_all on public.app_crm_campaigns
    for all to authenticated
    using (public.is_crm_admin(team_id))
    with check (public.is_crm_admin(team_id));

drop policy if exists app_crm_campaign_spend_all on public.app_crm_campaign_spend;
create policy app_crm_campaign_spend_all on public.app_crm_campaign_spend
    for all to authenticated
    using (public.is_crm_admin(team_id))
    with check (public.is_crm_admin(team_id));

drop policy if exists app_crm_reminders_all on public.app_crm_reminders;
create policy app_crm_reminders_all on public.app_crm_reminders
    for all to authenticated
    using (public.is_crm_admin(team_id))
    with check (public.is_crm_admin(team_id));


-- =============================================================================
-- SECTION 6: Reminder delivery — crm_fire_due_reminders() + pg_cron
-- =============================================================================

-- is_crm_admin() is unusable from cron: it reads auth.uid(), which is null in a
-- scheduled job. This is the same rule (team owner, or a live grant backed by an
-- ACTIVE membership) taking the user as an argument, so the sweep can ask "can
-- this recipient still open the record I am about to ping them about?".
create or replace function public.crm_user_is_admin(_team_id uuid, _user_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select exists (
        select 1
        from public.team_members tm
        join public.roles ro on ro.id = tm.role_id
        where tm.team_id = _team_id
          and tm.user_id = _user_id
          and tm.active is true
          and ro.owner is true
    )
    or (
        exists (
            select 1 from public.app_crm_admins a
            where a.team_id = _team_id
              and a.user_id = _user_id
        )
        and exists (
            select 1 from public.team_members tm
            where tm.team_id = _team_id
              and tm.user_id = _user_id
              and tm.active is true
        )
    );
$$;

-- SECURITY DEFINER because it runs from cron with no auth.uid() and must both
-- read reminders across teams and write notifications on behalf of the
-- recipient. Routed through create_notification so the recipient's per-team
-- pop-up switch and muted_types still apply — a muted 'crm_reminder' silently
-- drops, and the row is still stamped notified_at so it never retries.
--
-- notified_at is stamped inside the loop (not one bulk update at the end) so a
-- failure mid-sweep cannot re-send what already went out.
--
-- Two guards live in the WHERE rather than the loop body, on purpose: a row that
-- fails them is left UN-notified (restore the lead, or re-grant the person CRM
-- access, and the nudge still fires) and, because it never enters the result
-- set, it also never eats one of the 500 slots.
--   * the recipient must still be a CRM admin of that team — reminders cascade
--     from public.users, not from team_members, so removing someone from the
--     team or revoking their CRM grant would otherwise keep pinging them at a
--     record that now shows them the lock screen;
--   * the target record must still exist and not be soft-deleted — a deleted
--     lead's reminder pointed at a row you can only find under "Deleted".
create or replace function public.crm_fire_due_reminders()
    returns integer
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _r     record;
    _count integer := 0;
begin
    for _r in
        select r.id, r.team_id, r.user_id, r.note, r.target_type, r.target_id
        from public.app_crm_reminders r
        where r.remind_at <= now()
          and r.notified_at is null
          and r.done_at is null
          and public.crm_user_is_admin(r.team_id, r.user_id)
          and case r.target_type
                  when 'person' then exists (
                      select 1 from public.app_crm_people p
                      where p.id = r.target_id and p.deleted_at is null)
                  when 'company' then exists (
                      select 1 from public.app_crm_companies c
                      where c.id = r.target_id and c.deleted_at is null)
                  else exists (
                      select 1 from public.app_crm_deals d
                      where d.id = r.target_id and d.deleted_at is null)
              end
        order by r.remind_at
        limit 500 -- a backlog drains over the next few sweeps; no run runs long
    loop
        perform public.create_notification(
            _r.user_id,
            coalesce('Reminder: ' || nullif(trim(coalesce(_r.note, '')), ''),
                     'Follow up on this lead'),
            'crm_reminder',
            case _r.target_type
                when 'person'  then '/crm/people?m='    || _r.target_id
                when 'company' then '/crm/companies?m=' || _r.target_id
                else                '/crm/deals?m='     || _r.target_id
            end,
            _r.team_id,
            null,
            null);

        update public.app_crm_reminders
            set notified_at = now()
            where id = _r.id;

        _count := _count + 1;
    end loop;

    return _count;
end;
$$;

-- Every 5 minutes: fine enough that "remind me at 3:00" lands by 3:05, cheap
-- enough that the partial index above makes an empty sweep near-free.
create extension if not exists pg_cron;

-- Re-runnable: drop any previous schedule of the same name first.
do $$
begin
    perform cron.unschedule('crm-fire-due-reminders');
exception
    when others then null; -- not scheduled yet
end;
$$;

select cron.schedule(
    'crm-fire-due-reminders',
    '*/5 * * * *',
    $job$ select public.crm_fire_due_reminders() $job$
);

-- Retention, same idea as `cleanup-cleared-notifications`: a dismissed reminder
-- is history, not an archive. Nothing in the product reads a reminder more than
-- a quarter after it was cleared, and `useCrmReminders()` fetches the team's
-- whole table — so ninety days after done_at the row goes. Open and unfired
-- reminders are never touched, however old.
do $$
begin
    perform cron.unschedule('crm-cleanup-done-reminders');
exception
    when others then null; -- not scheduled yet
end;
$$;

select cron.schedule(
    'crm-cleanup-done-reminders',
    '20 3 * * *',
    $job$
        delete from public.app_crm_reminders
        where done_at is not null
          and done_at < now() - interval '90 days'
    $job$
);


-- =============================================================================
-- SECTION 7: Timeline — promote a lead-status change to its own event
-- =============================================================================

-- `app_crm_track_record` (20261110000000) already promotes a deal's stage move
-- to 'stage_changed' with from/to names; every other column falls through to the
-- generic 'updated' branch, which renders as "updated status" with no before or
-- after. On a lead desk "when did this go from contacted to junk" is the single
-- most-asked timeline question, so `status` gets the same treatment. Raw values
-- are stored — the client already has `crmLeadStatusMeta` to label them.
--
-- Re-created wholesale (create or replace) rather than patched, because a
-- trigger function has no partial form. Only the deal/status block below is new.
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
        end if;
    end if;

    insert into public.app_crm_activities (team_id, target_type, target_id, event, properties, actor_id)
    values (new.team_id, _target, new.id, _event, _props, auth.uid());
    return new;
end;
$$;


-- =============================================================================
-- SECTION 8: Grants
-- =============================================================================

grant select, insert, update, delete on public.app_crm_campaigns      to authenticated;
grant select, insert, update, delete on public.app_crm_campaign_spend to authenticated;
grant select, insert, update, delete on public.app_crm_reminders      to authenticated;

grant all on public.app_crm_campaigns      to service_role;
grant all on public.app_crm_campaign_spend to service_role;
grant all on public.app_crm_reminders      to service_role;

revoke all on public.app_crm_campaigns      from anon;
revoke all on public.app_crm_campaign_spend from anon;
revoke all on public.app_crm_reminders      from anon;

-- The sweep is infrastructure, not an app call: cron and service_role only. The
-- same goes for its access helper — the app already has `is_crm_admin()`, which
-- answers the same question about the caller and cannot be pointed at anyone
-- else.
revoke all on function public.crm_fire_due_reminders() from public;
grant execute on function public.crm_fire_due_reminders() to service_role;

revoke all on function public.crm_user_is_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_user_is_admin(uuid, uuid) to service_role;

-- =============================================================================
-- END CRM leads / campaigns / reminders
-- =============================================================================
