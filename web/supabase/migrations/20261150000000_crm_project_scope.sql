-- =============================================================================
-- CRM by project
-- =============================================================================
-- The CRM is worked per project: a deal, a person and a company are filed
-- under the project they belong to, the /crm switcher picks the project, and a
-- project's CRM view shows exactly its records. Tasks, notes, reminders and
-- activity follow their targets (a task on a deal is in the deal's project).
--
-- project_id is nullable: records filed under no project yet stay reachable
-- through the switcher's "No project" entry. ON DELETE SET NULL, so deleting a
-- project never deletes sales data — it becomes unfiled.
--
-- Same-team guard: a record may only be filed under a project of its own
-- team (the CRM is team-wide; a project id from another workspace would leak
-- the record into that workspace's project view).
--
-- Re-runnable: add column if not exists / create or replace / drop trigger if
-- exists. RLS is unchanged (is_crm_admin on every table).
-- =============================================================================

alter table public.app_crm_deals     add column if not exists project_id uuid;
alter table public.app_crm_people    add column if not exists project_id uuid;
alter table public.app_crm_companies add column if not exists project_id uuid;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'app_crm_deals_project_fk') then
        alter table public.app_crm_deals add constraint app_crm_deals_project_fk
            foreign key (project_id) references public.projects (id) on delete set null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'app_crm_people_project_fk') then
        alter table public.app_crm_people add constraint app_crm_people_project_fk
            foreign key (project_id) references public.projects (id) on delete set null;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'app_crm_companies_project_fk') then
        alter table public.app_crm_companies add constraint app_crm_companies_project_fk
            foreign key (project_id) references public.projects (id) on delete set null;
    end if;
end $$;

create index if not exists app_crm_deals_project_idx     on public.app_crm_deals (team_id, project_id);
create index if not exists app_crm_people_project_idx    on public.app_crm_people (team_id, project_id);
create index if not exists app_crm_companies_project_idx on public.app_crm_companies (team_id, project_id);

create or replace function public.app_crm_project_same_team()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
begin
    if new.project_id is not null and not exists (
        select 1 from public.projects p
         where p.id = new.project_id and p.team_id = new.team_id
    ) then
        raise exception 'project % does not belong to team %', new.project_id, new.team_id
            using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

revoke all on function public.app_crm_project_same_team() from public, anon, authenticated;

drop trigger if exists app_crm_deals_project_same_team on public.app_crm_deals;
create trigger app_crm_deals_project_same_team
    before insert or update of project_id, team_id on public.app_crm_deals
    for each row execute function public.app_crm_project_same_team();

drop trigger if exists app_crm_people_project_same_team on public.app_crm_people;
create trigger app_crm_people_project_same_team
    before insert or update of project_id, team_id on public.app_crm_people
    for each row execute function public.app_crm_project_same_team();

drop trigger if exists app_crm_companies_project_same_team on public.app_crm_companies;
create trigger app_crm_companies_project_same_team
    before insert or update of project_id, team_id on public.app_crm_companies
    for each row execute function public.app_crm_project_same_team();

-- Workflow events carry the deal's project too, so a workflow can act per
-- project ("a deal in Project X was won").
do $$
declare
    _def text;
begin
    if to_regprocedure('public.app_crm_deal_event_payload(jsonb)') is null then
        return;
    end if;
    _def := pg_get_functiondef('public.app_crm_deal_event_payload(jsonb)'::regprocedure);
    if position('''project_id''' in _def) = 0 then
        _def := replace(_def, '''deal_id'',       _d -> ''id'',',
                        '''deal_id'',       _d -> ''id'',' || chr(10) || '        ''project_id'',    _d -> ''project_id'',');
        execute _def;
    end if;
end $$;
