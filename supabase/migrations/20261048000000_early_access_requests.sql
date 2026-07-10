-- =============================================================================
-- Early-access requests — public founding-member sign-up form.
--
--   The /early-access marketing form lets ANYONE (logged out included) request a
--   founding-member spot. Submissions are insert-only from the public: the anon
--   role may INSERT but never SELECT, so requests can't be read back by the
--   browser. Only platform admins can read them (mirrors platform_pricing's
--   public-surface RLS + is_platform_admin()).
-- =============================================================================

create table if not exists public.early_access_requests (
    id         uuid                     primary key default gen_random_uuid(),
    name       text                     not null,
    email      text                     not null,
    company    text,
    team_size  text,
    note       text,
    created_at timestamp with time zone not null default current_timestamp,
    constraint early_access_name_len  check (char_length(name) between 1 and 120),
    constraint early_access_email_len check (char_length(email) between 3 and 200),
    constraint early_access_email_fmt check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    constraint early_access_company_len check (company is null or char_length(company) <= 160),
    constraint early_access_note_len  check (note is null or char_length(note) <= 2000)
);
alter table public.early_access_requests enable row level security;

-- Anyone may submit (public marketing form — no login required).
drop policy if exists early_access_insert on public.early_access_requests;
create policy early_access_insert on public.early_access_requests
    for insert to anon, authenticated
    with check (true);

-- Only platform admins may read submissions.
drop policy if exists early_access_select on public.early_access_requests;
create policy early_access_select on public.early_access_requests
    for select to authenticated
    using (public.is_platform_admin());

revoke all on public.early_access_requests from public, anon;
grant insert on public.early_access_requests to anon, authenticated;
grant select on public.early_access_requests to authenticated;
grant all on public.early_access_requests to service_role;

create index if not exists early_access_requests_created_idx
    on public.early_access_requests (created_at desc);
