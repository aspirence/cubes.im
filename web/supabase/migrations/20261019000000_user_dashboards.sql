-- =============================================================================
-- Personalized Home dashboards.
-- =============================================================================
-- Each user arranges their own Home: which widgets show and in what order.
-- `layout` is an ordered JSONB array of widget keys from the code registry
-- (src/features/home/widgets.tsx); unknown keys are ignored by the renderer so
-- registry changes never break stored layouts. One row per user, upserted.

create table if not exists public.user_dashboards (
    user_id    uuid                                               not null,
    layout     jsonb                    default '[]'::jsonb       not null,
    updated_at timestamp with time zone default current_timestamp not null,
    constraint user_dashboards_pk primary key (user_id),
    constraint user_dashboards_user_id_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint user_dashboards_layout_is_array
        check (jsonb_typeof(layout) = 'array')
);

alter table public.user_dashboards enable row level security;

-- Strictly personal: every operation is scoped to the caller's own row.
drop policy if exists user_dashboards_select on public.user_dashboards;
create policy user_dashboards_select on public.user_dashboards
    for select to authenticated
    using (user_id = auth.uid());

drop policy if exists user_dashboards_insert on public.user_dashboards;
create policy user_dashboards_insert on public.user_dashboards
    for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists user_dashboards_update on public.user_dashboards;
create policy user_dashboards_update on public.user_dashboards
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists user_dashboards_delete on public.user_dashboards;
create policy user_dashboards_delete on public.user_dashboards
    for delete to authenticated
    using (user_id = auth.uid());

revoke all on public.user_dashboards from public, anon;
grant select, insert, update, delete on public.user_dashboards to authenticated;
grant all on public.user_dashboards to service_role;
