-- =============================================================================
-- Two advertised workflow triggers that never fired
-- =============================================================================
-- src/lib/workflows/app-action-catalog.ts has offered `crm.deal_created` and
-- `sheets.row_created` as event triggers since Workflows shipped, and the
-- builder maps the whole catalog into the trigger Select unfiltered. Nothing
-- has ever emitted either key under any name, so a member could pick "A CRM
-- deal was created", save an ENABLED workflow, and watch it never run — the
-- one failure mode worse than the trigger not being offered at all.
--
-- Both are emitted from a row trigger rather than from the route that writes
-- the row, for the reason src/lib/workflows/events.ts states: an emitter that
-- shares the writer's transaction cannot leave an event behind for a write
-- that rolled back, and it catches every writer at once. A deal arrives from
-- the CRM board, the deal drawer and the CRM's own imports; a custom sheet row
-- arrives from the grid, the rows route and the Google pull, all three of
-- which all go through app_sheet_rows_patch.
--
-- DEFENSIVE:
-- workflow_events and wf_emit_event belong to 20261132000000, which a database
-- may not have yet, and the lookups that enrich a deal's payload belong to CRM
-- migrations added over time. Neither may ever fail the insert the member
-- actually asked for, so the emit is wrapped and the enrichment is wrapped
-- inside it — losing a campaign's name is not a reason to lose the event, and
-- losing the event is never a reason to lose the deal.
--
-- Columns added after a base table (deals: status, phone, campaign_id) are
-- read out of to_jsonb(new) rather than as new.<col>: PL/pgSQL resolves a
-- record field at run time and raises on a database whose CRM stopped at an
-- earlier migration, which is exactly the database this guard exists for.
--
-- Re-runnable: create or replace function / drop trigger if exists, and each
-- trigger is only attached where its table exists. Purely additive — no table,
-- column, policy or grant on anything that already exists.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. crm.deal_created
-- -----------------------------------------------------------------------------
-- The payload leads with the keys the catalog's sample publishes (deal_id,
-- name, stage, value, currency, campaign_id, source, created_at), because that
-- sample is the field picker's only description of this event and the builder
-- tells the member "real runs carry the same fields". Everything after them is
-- what a following step needs to act: the ids to write back to, the campaign's
-- name for a message, and the phone a lead-routing step sends to.
create or replace function public.app_crm_deals_emit_created()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _d        jsonb := to_jsonb(new);
    _campaign uuid;
    _cname    text;
    _source   text;
    _stage    text;
begin
    -- Cheap gates first: no workspace, or a database without the event bus.
    if new.team_id is null
       or to_regprocedure('public.wf_emit_event(uuid, text, jsonb)') is null then
        return new;
    end if;

    begin
        -- wf_emit_event asks this again and is the real gate; asking here too
        -- keeps a workspace with no deal workflow from paying for two lookups
        -- on every row of a lead import.
        if not exists (
            select 1 from public.workflows w
             where w.team_id = new.team_id
               and w.enabled
               and w.trigger_type = 'event'
               and coalesce(w.trigger_config ->> 'event_key', '') = 'crm.deal_created'
        ) then
            return new;
        end if;

        begin
            select s.name into _stage
              from public.app_crm_stages s
             where s.id = new.stage_id;
        exception when others then
            _stage := null;
        end;

        _campaign := nullif(_d ->> 'campaign_id', '')::uuid;
        if _campaign is not null then
            begin
                select c.name, c.channel into _cname, _source
                  from public.app_crm_campaigns c
                 where c.id = _campaign;
            exception when others then
                _cname := null;
                _source := null;
            end;
        end if;

        perform public.wf_emit_event(
            new.team_id,
            'crm.deal_created',
            jsonb_build_object(
                'deal_id', new.id,
                'name', new.name,
                -- The stage's NAME: it is what the sample shows and what a
                -- condition step gets written against. The id rides along for
                -- a step that has to move the deal.
                'stage', _stage,
                'stage_id', new.stage_id,
                'status', _d -> 'status',
                -- `value` is the catalog's name for it, `amount` the column's.
                -- Both, so neither a sample-reader nor a schema-reader is wrong.
                'value', new.amount,
                'amount', new.amount,
                'currency', new.currency_code,
                'campaign_id', _campaign,
                'campaign_name', _cname,
                -- The channel the campaign was booked on ("meta", "google", …),
                -- which is the catalog's `source`. Null for a deal that came in
                -- without a campaign, and there is nothing else it could mean.
                'source', _source,
                'company_id', new.company_id,
                'contact_id', new.contact_id,
                'owner_id', new.owner_id,
                'created_by', new.created_by,
                'close_date', new.close_date,
                'phone', _d -> 'phone',
                'created_at', new.created_at
            )
        );
    exception when others then
        -- The bus is absent, or shaped differently than this expects. A deal is
        -- never lost over an automation that could not hear about it.
        null;
    end;

    return new;
end;
$$;

revoke all on function public.app_crm_deals_emit_created() from public, anon, authenticated;

do
$$
begin
    if to_regclass('public.app_crm_deals') is not null then
        drop trigger if exists app_crm_deals_emit_created on public.app_crm_deals;
        -- AFTER, so the event describes a deal that really exists, and only for
        -- a live one: an import that lands a row already soft-deleted has not
        -- created a deal anybody should be told about.
        create trigger app_crm_deals_emit_created
            after insert on public.app_crm_deals
            for each row
            when (new.deleted_at is null)
            execute function public.app_crm_deals_emit_created();
    end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- 2. sheets.row_created
-- -----------------------------------------------------------------------------
create or replace function public.app_sheet_rows_emit_created()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _sheet  record;
    _values jsonb;
begin
    if new.team_id is null
       or to_regprocedure('public.wf_emit_event(uuid, text, jsonb)') is null then
        return new;
    end if;

    begin
        if not exists (
            select 1 from public.workflows w
             where w.team_id = new.team_id
               and w.enabled
               and w.trigger_type = 'event'
               and coalesce(w.trigger_config ->> 'event_key', '') = 'sheets.row_created'
        ) then
            return new;
        end if;

        select s.name, s.source, s.project_id, s.columns
          into _sheet
          from public.app_sheets s
         where s.id = new.sheet_id;
        if not found then
            return new;
        end if;

        -- Only a CUSTOM sheet's rows ARE rows. On a bound sheet (tasks, content
        -- items, insights, campaigns) the record lives in its own table and
        -- app_sheet_rows holds nothing but that record's custom-column values,
        -- written the first time somebody types in one of those columns — so
        -- "a row was added to a sheet" there would be a lie the member has no
        -- way to debug. Those sources have their own events to grow.
        if _sheet.source is distinct from 'custom' then
            return new;
        end if;

        -- The sample the field picker publishes keys the values by the column's
        -- LABEL, which is also what someone writing {{trigger.values.Email}}
        -- expects; app_sheet_rows.data is keyed by the column id. Every column
        -- appears, empty ones as null, so the shape of `values` is the sheet
        -- rather than whatever this one row happened to fill in. Two columns
        -- sharing a label would collide on the way in, so the leftmost wins and
        -- the id-keyed original rides along as `data`.
        select coalesce(jsonb_object_agg(t.label, t.value), '{}'::jsonb)
          into _values
          from (
              select distinct on (btrim(e.col ->> 'label'))
                     btrim(e.col ->> 'label')                          as label,
                     coalesce(new.data -> (e.col ->> 'id'), 'null'::jsonb) as value
                from jsonb_array_elements(coalesce(_sheet.columns, '[]'::jsonb))
                     with ordinality as e(col, ord)
               where jsonb_typeof(e.col) = 'object'
                 and nullif(btrim(coalesce(e.col ->> 'label', '')), '') is not null
                 and nullif(coalesce(e.col ->> 'id', ''), '') is not null
               order by btrim(e.col ->> 'label'), e.ord
          ) t;

        perform public.wf_emit_event(
            new.team_id,
            'sheets.row_created',
            jsonb_build_object(
                'sheet_id', new.sheet_id,
                'sheet_name', _sheet.name,
                'sheet_source', _sheet.source,
                'project_id', _sheet.project_id,
                'row_id', new.id,
                -- What the rows route takes back to update or delete this row.
                'record_key', new.record_key,
                'values', _values,
                'data', new.data,
                'position', new.position,
                'created_by', new.created_by,
                'created_at', new.created_at
            )
        );
    exception when others then
        null;
    end;

    return new;
end;
$$;

revoke all on function public.app_sheet_rows_emit_created() from public, anon, authenticated;

do
$$
begin
    if to_regclass('public.app_sheet_rows') is not null then
        drop trigger if exists app_sheet_rows_emit_created on public.app_sheet_rows;
        create trigger app_sheet_rows_emit_created
            after insert on public.app_sheet_rows
            for each row execute function public.app_sheet_rows_emit_created();
    end if;
end;
$$;
