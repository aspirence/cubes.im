-- =============================================================================
-- Cubes CRM — lead tags (user-defined, many per lead)
-- =============================================================================
-- Replaces the fixed Bronze/Silver/Gold `tier` column from 20261117000000 with
-- something the team writes itself.
--
-- The tier column was one value from a vocabulary the product chose. What a
-- lead desk actually needs is the WhatsApp "add to list" shape: a team invents
-- its own labels — "Gold", "Hot", "Budget kam", "Call back Monday" — and puts
-- as many on a lead as fit. A single fixed enum cannot express "Gold AND
-- budget-conscious", and no vocabulary picked here survives contact with how a
-- particular team actually sorts its leads.
--
--   * app_crm_labels      — the team's tag vocabulary. Name + colour, exactly
--     the shape app_crm_stages already has, and managed in the same place
--     (CRM Settings) by the same people (is_crm_admin).
--   * app_crm_deal_labels — the join. One row per (deal, label); the PK is that
--     pair, so tagging twice is a no-op rather than a duplicate.
--
-- Why a CRM-owned table rather than reusing `team_labels`: that vocabulary is
-- the task board's, readable and writable by ANY team member. CRM records are
-- gated behind is_crm_admin, so reusing it would let someone with no CRM access
-- rename a label the lead desk depends on — and would put "bug" and "urgent" in
-- the picker next to "Gold". Two desks, two vocabularies.
--
-- Tagging is timeline-worthy for the same reason a status change is: "who put
-- this on the Gold list, and when" is a question the desk asks. Both directions
-- are logged — un-tagging is the interesting half.
--
-- Re-runnable: create table if not exists / do-block guarded constraints / drop
-- policy if exists / create or replace function / drop trigger if exists.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Stop the timeline trigger referencing tier
-- =============================================================================

-- This runs BEFORE the column is dropped, on purpose. 20261117000000 added a
-- `tier` branch here that reads old.tier/new.tier; drop the column first and any
-- deal update landing in the gap fires a trigger against a field that no longer
-- exists. Everything else is carried forward verbatim from 20261115000000, and
-- it is re-created wholesale because a trigger function has no partial form.
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
-- SECTION 2: Retire the tier column
-- =============================================================================

-- Guarded because 20261117000000 may never have reached this database — the
-- column was added and superseded inside one working session.
drop index if exists public.app_crm_deals_tier_idx;

alter table public.app_crm_deals
    drop constraint if exists app_crm_deals_tier_check;

alter table public.app_crm_deals
    drop column if exists tier;


-- =============================================================================
-- SECTION 3: Tables
-- =============================================================================

-- 3.1 app_crm_labels — the team's own tag vocabulary.
create table if not exists public.app_crm_labels (
    id         uuid                     default gen_random_uuid() not null,
    team_id    uuid                                               not null,
    name       text                                               not null,
    color      text                     default '#4a4ad0'         not null,
    -- Hand-orderable, so the picker can lead with the tags a team reaches for
    -- most instead of whatever it happened to create first.
    position   integer                  default 0                 not null,
    created_at timestamp with time zone default current_timestamp not null,
    created_by uuid,
    constraint app_crm_labels_pk primary key (id),
    constraint app_crm_labels_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_labels_name_check check (char_length(name) between 1 and 60)
);

-- Case-insensitive uniqueness per team: "Gold" and "gold" as two tags is a
-- mistake every time, and it splits a list someone is trying to work from.
create unique index if not exists app_crm_labels_team_name_uindex
    on public.app_crm_labels (team_id, lower(name));

-- 3.2 app_crm_deal_labels — the join.
create table if not exists public.app_crm_deal_labels (
    team_id    uuid                                               not null,
    deal_id    uuid                                               not null,
    label_id   uuid                                               not null,
    created_at timestamp with time zone default current_timestamp not null,
    created_by uuid,
    -- The pair IS the identity: tagging an already-tagged lead does nothing
    -- rather than stacking a second row nobody can see.
    constraint app_crm_deal_labels_pk primary key (deal_id, label_id),
    constraint app_crm_deal_labels_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_deal_labels_deal_id_fk
        foreign key (deal_id) references public.app_crm_deals (id) on delete cascade,
    -- Deleting a tag un-tags every lead carrying it. The alternative (refuse
    -- the delete) strands a tag nobody can remove once it is on a hundred rows.
    constraint app_crm_deal_labels_label_id_fk
        foreign key (label_id) references public.app_crm_labels (id) on delete cascade
);

-- "Which leads are on the Gold list" — the whole point of the join, and it is
-- always asked within one team.
create index if not exists app_crm_deal_labels_label_idx
    on public.app_crm_deal_labels (team_id, label_id);


-- =============================================================================
-- SECTION 4: RLS — the same is_crm_admin gate as every other CRM table
-- =============================================================================

alter table public.app_crm_labels      enable row level security;
alter table public.app_crm_deal_labels enable row level security;

drop policy if exists app_crm_labels_all on public.app_crm_labels;
create policy app_crm_labels_all on public.app_crm_labels
    for all to authenticated
    using (public.is_crm_admin(team_id))
    with check (public.is_crm_admin(team_id));

drop policy if exists app_crm_deal_labels_all on public.app_crm_deal_labels;
create policy app_crm_deal_labels_all on public.app_crm_deal_labels
    for all to authenticated
    using (public.is_crm_admin(team_id))
    with check (public.is_crm_admin(team_id));


-- =============================================================================
-- SECTION 5: Timeline — tagging and un-tagging are both events
-- =============================================================================

create or replace function public.app_crm_track_deal_label()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _team  uuid;
    _deal  uuid;
    _label uuid;
    _event text;
    _name  text;
begin
    -- Explicit branches rather than coalesce(new, old): those are record
    -- pseudo-variables, and folding them into one expression is the kind of
    -- thing that works until it meets a different plpgsql version.
    if tg_op = 'INSERT' then
        _team  := new.team_id;
        _deal  := new.deal_id;
        _label := new.label_id;
        _event := 'label_added';
    else
        _team  := old.team_id;
        _deal  := old.deal_id;
        _label := old.label_id;
        _event := 'label_removed';
    end if;

    select l.name into _name
    from public.app_crm_labels l where l.id = _label;

    insert into public.app_crm_activities (team_id, target_type, target_id, event, properties, actor_id)
    values (_team, 'deal', _deal, _event,
            -- The name is COPIED, not referenced: a tag deleted later would
            -- otherwise turn its own history into a row of blanks.
            jsonb_build_object('label', coalesce(_name, 'a tag'), 'label_id', _label),
            auth.uid());

    -- AFTER triggers ignore the return value; DELETE wants OLD by convention.
    if tg_op = 'INSERT' then
        return new;
    end if;
    return old;
end;
$$;

drop trigger if exists app_crm_deal_labels_track on public.app_crm_deal_labels;
create trigger app_crm_deal_labels_track
    after insert or delete on public.app_crm_deal_labels
    for each row execute function public.app_crm_track_deal_label();


-- =============================================================================
-- SECTION 6: Grants
-- =============================================================================

grant select, insert, update, delete on public.app_crm_labels      to authenticated;
grant select, insert, update, delete on public.app_crm_deal_labels to authenticated;

grant all on public.app_crm_labels      to service_role;
grant all on public.app_crm_deal_labels to service_role;

revoke all on public.app_crm_labels      from anon;
revoke all on public.app_crm_deal_labels from anon;
