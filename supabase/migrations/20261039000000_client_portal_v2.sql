-- =============================================================================
-- Client Portal v2 — templates, client work requests, and billing/invoices.
--
-- Adds to the existing portal (20261029):
--   * portal presentation: a `template` (which client-facing layout to render),
--     a `logo_url`, and section toggles (reviews / billing / requests).
--   * app_client_portal_requests : work the CLIENT asks for (submitted from the
--     public portal via a SECURITY DEFINER RPC — the client has no login).
--   * app_client_portal_invoices : billing the client can see (admin-authored).
--
-- The get_client_portal() RPC is extended in a follow-up migration so it can
-- surface reviews/invoices/requests alongside the existing project data.
-- =============================================================================

-- ---- portal presentation ----------------------------------------------------
alter table public.app_client_portal_portals
    add column if not exists template      text    not null default 'dashboard',
    add column if not exists logo_url       text,
    add column if not exists show_reviews   boolean not null default true,
    add column if not exists show_billing   boolean not null default true,
    add column if not exists allow_requests boolean not null default true;

alter table public.app_client_portal_portals
    drop constraint if exists app_client_portal_portals_template_check;
alter table public.app_client_portal_portals
    add constraint app_client_portal_portals_template_check
    check (template in ('dashboard', 'sheet', 'board', 'timeline', 'minimal'));

-- ---- client work requests ---------------------------------------------------
create table if not exists public.app_client_portal_requests (
    id         uuid                     default gen_random_uuid() not null,
    portal_id  uuid                                               not null,
    title      text                                               not null,
    details    text,
    priority   text                     default 'normal'          not null,
    status     text                     default 'new'             not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint app_client_portal_requests_pk primary key (id),
    constraint app_client_portal_requests_portal_fk
        foreign key (portal_id) references public.app_client_portal_portals (id) on delete cascade,
    constraint app_client_portal_requests_title_check check (char_length(title) between 1 and 200),
    constraint app_client_portal_requests_details_check check (char_length(details) <= 8000),
    constraint app_client_portal_requests_priority_check
        check (priority in ('low', 'normal', 'high')),
    constraint app_client_portal_requests_status_check
        check (status in ('new', 'accepted', 'declined', 'done'))
);
create index if not exists app_client_portal_requests_portal_index
    on public.app_client_portal_requests (portal_id, created_at desc);

-- ---- client-visible invoices ------------------------------------------------
create table if not exists public.app_client_portal_invoices (
    id           uuid                     default gen_random_uuid() not null,
    portal_id    uuid                                               not null,
    number       text                                               not null,
    title        text,
    amount_cents bigint                   default 0                 not null,
    currency     text                     default 'USD'             not null,
    status       text                     default 'draft'           not null,
    issued_on    date,
    due_on       date,
    note         text,
    created_by   uuid,
    created_at   timestamp with time zone default current_timestamp not null,
    constraint app_client_portal_invoices_pk primary key (id),
    constraint app_client_portal_invoices_portal_fk
        foreign key (portal_id) references public.app_client_portal_portals (id) on delete cascade,
    constraint app_client_portal_invoices_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_client_portal_invoices_number_check check (char_length(number) between 1 and 60),
    constraint app_client_portal_invoices_amount_check check (amount_cents >= 0),
    constraint app_client_portal_invoices_status_check
        check (status in ('draft', 'sent', 'paid', 'overdue'))
);
create index if not exists app_client_portal_invoices_portal_index
    on public.app_client_portal_invoices (portal_id, created_at desc);

-- ---- RLS --------------------------------------------------------------------
alter table public.app_client_portal_requests enable row level security;
alter table public.app_client_portal_invoices enable row level security;

-- Admins (team members of the portal) manage both tables. The client never
-- touches them directly — reads come through get_client_portal() and writes
-- come through submit_client_portal_request(), both SECURITY DEFINER.
drop policy if exists app_client_portal_requests_all on public.app_client_portal_requests;
create policy app_client_portal_requests_all on public.app_client_portal_requests
    for all to authenticated
    using (public.client_portal_can_access(portal_id))
    with check (public.client_portal_can_access(portal_id));

drop policy if exists app_client_portal_invoices_all on public.app_client_portal_invoices;
create policy app_client_portal_invoices_all on public.app_client_portal_invoices
    for all to authenticated
    using (public.client_portal_can_access(portal_id))
    with check (public.client_portal_can_access(portal_id));

revoke all on public.app_client_portal_requests from public, anon;
revoke all on public.app_client_portal_invoices from public, anon;
grant select, insert, update, delete on public.app_client_portal_requests to authenticated;
grant select, insert, update, delete on public.app_client_portal_invoices to authenticated;
grant all on public.app_client_portal_requests to service_role;
grant all on public.app_client_portal_invoices to service_role;

-- ---- client submits a work request (no login) -------------------------------
create or replace function public.submit_client_portal_request(
    p_token   uuid,
    p_title   text,
    p_details text default null,
    p_priority text default 'normal'
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    v_portal uuid;
    v_id     uuid;
begin
    -- Resolve the live portal from its share token; only if it accepts requests.
    select id into v_portal
    from public.app_client_portal_portals
    where share_token = p_token
      and status = 'live'
      and allow_requests is true;

    if v_portal is null then
        raise exception 'portal not found or not accepting requests';
    end if;

    if coalesce(btrim(p_title), '') = '' then
        raise exception 'title required';
    end if;

    insert into public.app_client_portal_requests (portal_id, title, details, priority)
    values (
        v_portal,
        left(btrim(p_title), 200),
        nullif(left(coalesce(p_details, ''), 8000), ''),
        case when p_priority in ('low', 'normal', 'high') then p_priority else 'normal' end
    )
    returning id into v_id;

    return v_id;
end;
$$;
revoke all on function public.submit_client_portal_request(uuid, text, text, text) from public;
grant execute on function public.submit_client_portal_request(uuid, text, text, text) to anon, authenticated;
