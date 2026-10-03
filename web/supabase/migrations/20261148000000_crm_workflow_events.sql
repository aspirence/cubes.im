-- =============================================================================
-- CRM ↔ Workflows: where a deal came from, and the CRM speaking back
-- =============================================================================
-- The CRM states facts as events and offers app steps (crm.create_deal,
-- crm.update_deal, crm.find_deal); a workflow — a web-form webhook, a
-- schedule, another app's event — is where anything reaches it. See
-- docs/CRM_WORKFLOWS.md for the contract this migration serves.
--
--  2. app_crm_deals.source / source_ref — where a deal came from. The CRM had
--     only campaign_id; a lead that arrived from a form or a webhook kept no
--     trace of it.
--  3. crm.deal_status_changed and crm.deal_stage_changed — the CRM's second and
--     third events. Until now only the insert spoke; a deal moving to
--     "converted" was visible in app_crm_activities and nowhere a workflow
--     could hear it.
--  4. crm.deal_created — same payload as before plus the contact's email and
--     the new source columns, built by the shared helper the new events use.
--
-- DEFENSIVE, like 20261140000000: the CRM tables, workflow_events and
-- wf_emit_event each belong to migrations a database may lack. Every part is
-- guarded by to_regclass / to_regprocedure, reads later-added columns out of
-- to_jsonb(row), and an emitter can never fail the write it rides on.
-- Re-runnable: create or replace / if not exists / drop … if exists.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 2. app_crm_deals.source / source_ref
-- -----------------------------------------------------------------------------
-- `source` is a short machine word ("website", "webhook", "workflow",
-- "manual"); `source_ref` is whatever the origin knew — UTM tags,
-- the form and ad, UTM tags from a website form, the workflow run that wrote
-- the deal. Free-shaped on purpose: an origin we have not met yet must still
-- be able to leave its trace.
do $$
begin
    if to_regclass('public.app_crm_deals') is null then
        return;
    end if;
    alter table public.app_crm_deals add column if not exists source     text;
    alter table public.app_crm_deals add column if not exists source_ref jsonb not null default '{}'::jsonb;
    if not exists (select 1 from pg_constraint where conname = 'app_crm_deals_source_check') then
        alter table public.app_crm_deals
            add constraint app_crm_deals_source_check
            check (source is null or char_length(source) <= 60);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'app_crm_deals_source_ref_check') then
        alter table public.app_crm_deals
            add constraint app_crm_deals_source_ref_check
            check (jsonb_typeof(source_ref) = 'object');
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3. The deal payload every CRM event carries
-- -----------------------------------------------------------------------------
-- One shape for created / status_changed / stage_changed, so a workflow built
-- against one event's sample reads the others without surprises. The first
-- keys are the ones the catalog samples have always published (deal_id, name,
-- stage, value, currency, campaign_id, source, created_at); the rest is what
-- a following step needs to act — ids to write back to, names for a message,
-- the contact's email and phone to reach them.
--
-- `source` stays the CRM campaign's channel ("meta", "google", …) because
-- saved workflows and the catalog sample already call it that; the deal's own
-- origin word is `deal_source`, its detail `source_ref`.
create or replace function public.app_crm_deal_event_payload(_d jsonb)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _stage_id  uuid := nullif(_d ->> 'stage_id', '')::uuid;
    _campaign  uuid := nullif(_d ->> 'campaign_id', '')::uuid;
    _contact   uuid := nullif(_d ->> 'contact_id', '')::uuid;
    _stage     text;
    _cname     text;
    _channel   text;
    _email     text;
    _phone     text;
    _first     text;
    _last      text;
begin
    if _stage_id is not null then
        begin
            select s.name into _stage from public.app_crm_stages s where s.id = _stage_id;
        exception when others then
            _stage := null;
        end;
    end if;
    if _campaign is not null then
        begin
            select c.name, c.channel into _cname, _channel
              from public.app_crm_campaigns c where c.id = _campaign;
        exception when others then
            _cname := null; _channel := null;
        end;
    end if;
    if _contact is not null then
        begin
            select p.email, p.phone, p.first_name, p.last_name into _email, _phone, _first, _last
              from public.app_crm_people p where p.id = _contact;
        exception when others then
            _email := null; _phone := null; _first := null; _last := null;
        end;
    end if;

    return jsonb_build_object(
        'deal_id',       _d -> 'id',
        'name',          _d -> 'name',
        'stage',         _stage,
        'stage_id',      _stage_id,
        'status',        _d -> 'status',
        'value',         _d -> 'amount',
        'amount',        _d -> 'amount',
        'currency',      _d -> 'currency_code',
        'campaign_id',   _campaign,
        'campaign_name', _cname,
        'source',        _channel,
        'deal_source',   _d -> 'source',
        'source_ref',    coalesce(_d -> 'source_ref', '{}'::jsonb),
        'company_id',    _d -> 'company_id',
        'contact_id',    _contact,
        'contact_name',  nullif(trim(coalesce(_first, '') || ' ' || coalesce(_last, '')), ''),
        'email',         _email,
        'phone',         coalesce(nullif(_d ->> 'phone', ''), _phone),
        'owner_id',      _d -> 'owner_id',
        'created_by',    _d -> 'created_by',
        'close_date',    _d -> 'close_date',
        'created_at',    _d -> 'created_at'
    );
end;
$$;

revoke all on function public.app_crm_deal_event_payload(jsonb) from public, anon, authenticated;

-- True when an enabled workflow in this team listens for the key. wf_emit_event
-- asks the same question and is the real gate; asking first keeps a workspace
-- with no CRM workflows from building a payload on every row of an import.
create or replace function public.app_crm_event_has_listener(_team_id uuid, _key text)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select exists (
        select 1 from public.workflows w
         where w.team_id = _team_id
           and w.enabled
           and w.trigger_type = 'event'
           and coalesce(w.trigger_config ->> 'event_key', '') = _key
    );
$$;

revoke all on function public.app_crm_event_has_listener(uuid, text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 4. crm.deal_created (re-based on the shared payload)
-- -----------------------------------------------------------------------------
create or replace function public.app_crm_deals_emit_created()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
begin
    if new.team_id is null
       or to_regprocedure('public.wf_emit_event(uuid, text, jsonb)') is null then
        return new;
    end if;
    begin
        if not public.app_crm_event_has_listener(new.team_id, 'crm.deal_created') then
            return new;
        end if;
        perform public.wf_emit_event(
            new.team_id, 'crm.deal_created', public.app_crm_deal_event_payload(to_jsonb(new)));
    exception when others then
        -- A deal is never lost over an automation that could not hear about it.
        null;
    end;
    return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- 5. crm.deal_status_changed / crm.deal_stage_changed
-- -----------------------------------------------------------------------------
-- Status is how the LEAD is doing (new → contacted → … → converted / junk);
-- stage is where the card sits on the board. Two events, because a workflow
-- that celebrates a conversion must not also fire for a drag between columns.
create or replace function public.app_crm_deals_emit_changed()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _old       jsonb := to_jsonb(old);
    _new       jsonb := to_jsonb(new);
    _payload   jsonb;
    _from_name text;
begin
    if new.team_id is null
       or to_regprocedure('public.wf_emit_event(uuid, text, jsonb)') is null then
        return new;
    end if;

    begin
        if (_old ->> 'status') is distinct from (_new ->> 'status')
           and public.app_crm_event_has_listener(new.team_id, 'crm.deal_status_changed') then
            _payload := public.app_crm_deal_event_payload(_new) || jsonb_build_object(
                'from_status', _old -> 'status',
                'to_status',   _new -> 'status',
                'changed_at',  now()
            );
            perform public.wf_emit_event(new.team_id, 'crm.deal_status_changed', _payload);
        end if;
    exception when others then
        null;
    end;

    begin
        if (_old ->> 'stage_id') is distinct from (_new ->> 'stage_id')
           and public.app_crm_event_has_listener(new.team_id, 'crm.deal_stage_changed') then
            _from_name := null;
            if nullif(_old ->> 'stage_id', '') is not null then
                select s.name into _from_name
                  from public.app_crm_stages s
                 where s.id = (_old ->> 'stage_id')::uuid;
            end if;
            _payload := public.app_crm_deal_event_payload(_new);
            _payload := _payload || jsonb_build_object(
                'from_stage',    _from_name,
                'from_stage_id', nullif(_old ->> 'stage_id', ''),
                'to_stage',      _payload -> 'stage',
                'to_stage_id',   nullif(_new ->> 'stage_id', ''),
                'changed_at',    now()
            );
            perform public.wf_emit_event(new.team_id, 'crm.deal_stage_changed', _payload);
        end if;
    exception when others then
        null;
    end;

    return new;
end;
$$;

do $$
begin
    if to_regclass('public.app_crm_deals') is null then
        return;
    end if;
    if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'app_crm_deals' and column_name = 'status'
    ) then
        return;
    end if;
    drop trigger if exists app_crm_deals_emit_changed on public.app_crm_deals;
    create trigger app_crm_deals_emit_changed
        after update of status, stage_id on public.app_crm_deals
        for each row
        when (new.deleted_at is null)
        execute function public.app_crm_deals_emit_changed();
end $$;
