-- =============================================================================
-- Celebrations — per-team success-event config (confetti dialogs + templates).
--
-- Mirrors the cube_rules pattern (20261068000000): a per-team event registry,
-- seeded on team creation, member-readable, admin-writable via SECURITY
-- DEFINER RPCs only. Points are NOT stored here — they live in cube_rules and
-- are awarded server-side by the existing accrual trigger; celebrations are
-- purely cosmetic, so nothing here can mint cubes.
--
-- v1 seeds only events something actually fires (task_completed, and the
-- client-derived cube_milestone which pays nothing). New events are later
-- seed additions — no dead toggles.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. celebration_rules — which events celebrate + which template, per team
-- -----------------------------------------------------------------------------
create table if not exists public.celebration_rules (
    id         uuid default gen_random_uuid() not null,
    team_id    uuid not null,
    event_key  text not null,
    label      text not null,
    enabled    boolean not null default true,
    template   text not null default 'burst',
    updated_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint celebration_rules_pk primary key (id),
    constraint celebration_rules_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint celebration_rules_updated_by_fk
        foreign key (updated_by) references public.users (id) on delete set null,
    constraint celebration_rules_unique unique (team_id, event_key),
    constraint celebration_rules_template_ck
        check (template in ('burst', 'glow', 'stats'))
);

alter table public.celebration_rules enable row level security;

drop policy if exists celebration_rules_select on public.celebration_rules;
create policy celebration_rules_select on public.celebration_rules
    for select to authenticated
    using (public.is_team_member(team_id));

-- Supabase default privileges auto-grant ALL to authenticated at CREATE TABLE;
-- writes must flow through the admin-gated RPCs below, so strip them.
revoke insert, update, delete on public.celebration_rules from authenticated, anon;
revoke all on public.celebration_rules from anon;
grant select on public.celebration_rules to authenticated;
grant all on public.celebration_rules to service_role;

-- -----------------------------------------------------------------------------
-- 2. Seeding — defaults for every team, now and on future team creation
-- -----------------------------------------------------------------------------
create or replace function public.seed_celebration_rules(p_team_id uuid)
    returns void language plpgsql security definer set search_path = public, extensions
as
$$
begin
    insert into public.celebration_rules (team_id, event_key, label, enabled, template)
    values
        (p_team_id, 'task_completed', 'Task completed', true, 'burst'),
        (p_team_id, 'cube_milestone', 'Cube milestone reached', true, 'stats')
    on conflict (team_id, event_key) do nothing;
end;
$$;
revoke all on function public.seed_celebration_rules(uuid) from public, anon, authenticated;

create or replace function public.on_team_created_celebration_rules()
    returns trigger language plpgsql security definer set search_path = public, extensions
as
$$
begin
    perform public.seed_celebration_rules(new.id);
    return null;
exception when others then
    -- Seeding must never block team creation.
    return null;
end;
$$;

drop trigger if exists on_team_created_celebration_rules on public.teams;
create trigger on_team_created_celebration_rules
    after insert on public.teams
    for each row execute function public.on_team_created_celebration_rules();

select public.seed_celebration_rules(t.id) from public.teams t;

-- -----------------------------------------------------------------------------
-- 3. Client RPCs (mirror list_cube_rules / set_cube_rule)
-- -----------------------------------------------------------------------------
create or replace function public.list_celebration_rules(p_team_id uuid)
    returns setof public.celebration_rules
    language sql stable security definer set search_path = public
as
$$
    select *
    from public.celebration_rules
    where team_id = p_team_id
      and public.is_team_member(p_team_id)
    order by case event_key
                 when 'task_completed' then 1
                 when 'cube_milestone' then 2
                 else 9
             end,
             label;
$$;
revoke all on function public.list_celebration_rules(uuid) from public;
grant execute on function public.list_celebration_rules(uuid) to authenticated;

create or replace function public.set_celebration_rule(
    p_team_id uuid, p_event_key text, p_enabled boolean, p_template text
)
    returns void language plpgsql security definer set search_path = public, extensions
as
$$
begin
    if not public.is_team_admin(p_team_id) then
        raise exception 'set_celebration_rule: not permitted';
    end if;
    if p_template is not null and p_template not in ('burst', 'glow', 'stats') then
        raise exception 'set_celebration_rule: unknown template %', p_template;
    end if;

    update public.celebration_rules
       set enabled    = coalesce(p_enabled, enabled),
           template   = coalesce(p_template, template),
           updated_by = auth.uid(),
           updated_at = now()
     where team_id = p_team_id
       and event_key = p_event_key;

    if not found then
        raise exception 'set_celebration_rule: unknown rule %', p_event_key;
    end if;
end;
$$;
revoke all on function public.set_celebration_rule(uuid, text, boolean, text) from public;
grant execute on function public.set_celebration_rule(uuid, text, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Personal mute — per user+team, alongside the other notification prefs
-- -----------------------------------------------------------------------------
alter table public.notification_settings
    add column if not exists celebrations_muted boolean not null default false;
