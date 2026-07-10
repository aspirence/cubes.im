-- =============================================================================
-- Cubes — Workspace details (company profile per team)
-- =============================================================================
-- Every workspace (team) carries its own company profile, collected during
-- onboarding and when an owner creates an additional workspace: industry,
-- size, website, contacts, and the full billing/registered address.
--
--   * Workspace members can read their workspace's details.
--   * Only workspace admins/owners can create, edit, or delete them.

create table if not exists public.team_details (
    team_id        uuid primary key references public.teams (id) on delete cascade,
    company_name   text,
    industry       text,
    company_size   text,
    website        text,
    contact_email  text,
    contact_number text,
    address_line_1 text,
    address_line_2 text,
    city           text,
    state          text,
    country        text,
    postal_code    text,
    tax_id         text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

alter table public.team_details enable row level security;

drop policy if exists team_details_select on public.team_details;
create policy team_details_select on public.team_details
    for select using (public.is_team_member(team_id));

drop policy if exists team_details_insert on public.team_details;
create policy team_details_insert on public.team_details
    for insert with check (public.is_team_admin(team_id));

drop policy if exists team_details_update on public.team_details;
create policy team_details_update on public.team_details
    for update using (public.is_team_admin(team_id))
    with check (public.is_team_admin(team_id));

drop policy if exists team_details_delete on public.team_details;
create policy team_details_delete on public.team_details
    for delete using (public.is_team_admin(team_id));

create or replace function public.set_team_details_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists team_details_set_updated_at on public.team_details;
create trigger team_details_set_updated_at
    before update on public.team_details
    for each row
    execute function public.set_team_details_updated_at();
