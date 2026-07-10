-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 2: Settings + Onboarding
-- =============================================================================
-- Builds on Phase 1 (20260101000000_phase1_identity_tenancy.sql). Adds the
-- team-scoped configuration tables (clients, labels, project categories),
-- the email-invitation table, per-user notification settings, an onboarding
-- survey-responses table, plus the two onboarding/invite RPC functions.
--
-- Ported faithfully from the legacy Cubes Postgres schema
-- (cubes-backend/database/sql/{1_tables,4_functions}.sql), with the SAME
-- Supabase adaptations Phase 1 established:
--   * uuid_generate_v4()  ->  extensions.gen_random_uuid() (relied on via the
--     column DEFAULT, never cast explicitly in a function body)
--   * the legacy WL_EMAIL text+regex domain -> citext (case-insensitive email)
--   * the legacy WL_HEX_COLOR domain -> plain text + an inline CHECK with the
--     same regex (keeps this migration self-contained; no cross-phase domain)
--   * RLS is enforced in the database; Phase 1's helper funcs are REUSED
--     (public.is_team_member / is_team_admin — NOT recreated here).
--
-- Re-runnable where practical (IF NOT EXISTS / CREATE OR REPLACE /
-- DROP POLICY IF EXISTS / guarded ALTERs).
-- =============================================================================


-- =============================================================================
-- SECTION 1: Team-scoped configuration tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 clients (legacy: clients). Team-scoped. <=60-char name check (legacy).
-- -----------------------------------------------------------------------------
create table if not exists public.clients (
    id         uuid                     default gen_random_uuid() not null,
    name       text                                               not null,
    team_id    uuid                                               not null,
    created_at timestamp with time zone default current_timestamp not null,
    updated_at timestamp with time zone default current_timestamp not null,
    constraint clients_pk primary key (id),
    constraint clients_team_id_fk foreign key (team_id) references public.teams (id) on delete cascade,
    constraint clients_name_check check (char_length(name) <= 60)
);

-- -----------------------------------------------------------------------------
-- 1.2 team_labels (legacy: team_labels). Task labels; members may create them.
--     color_code: legacy WL_HEX_COLOR domain -> text + inline hex CHECK.
-- -----------------------------------------------------------------------------
create table if not exists public.team_labels (
    id         uuid                     default gen_random_uuid() not null,
    name       text                                               not null,
    color_code text                                               not null,
    team_id    uuid                                               not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint team_labels_pk primary key (id),
    constraint team_labels_team_id_fk foreign key (team_id) references public.teams (id) on delete cascade,
    constraint team_labels_color_code_check
        check (color_code ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
);

-- -----------------------------------------------------------------------------
-- 1.3 project_categories (legacy: project_categories). Admin-managed.
--     legacy color_code default '#70a6f3'; created_by -> users.
-- -----------------------------------------------------------------------------
create table if not exists public.project_categories (
    id         uuid                     default gen_random_uuid()       not null,
    name       text                                                     not null,
    color_code text                     default '#70a6f3'::text         not null,
    team_id    uuid                                                     not null,
    created_by uuid                                                     not null,
    created_at timestamp with time zone default current_timestamp       not null,
    updated_at timestamp with time zone default current_timestamp       not null,
    constraint project_categories_pk primary key (id),
    constraint project_categories_team_id_fk foreign key (team_id) references public.teams (id) on delete cascade,
    constraint project_categories_created_by_fk foreign key (created_by) references public.users (id),
    constraint project_categories_color_code_check
        check (color_code ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
);


-- =============================================================================
-- SECTION 2: Invitations
-- =============================================================================
-- -----------------------------------------------------------------------------
-- 2.1 email_invitations (legacy: email_invitations).
--     Legacy columns: id, name, email (WL_EMAIL), team_id, team_member_id.
--     Adaptations: email -> citext (matches Phase 1 users.email); ADD role_id
--     (per Phase 2 brief — legacy had no role_id and instead pre-created a
--     pending team_members row). team_member_id remains nullable (pure email
--     invite, no pre-created membership row).
-- -----------------------------------------------------------------------------
create table if not exists public.email_invitations (
    id             uuid                     default gen_random_uuid() not null,
    team_id        uuid                                               not null,
    team_member_id uuid,
    email          citext                                             not null,
    name           text                                               not null,
    role_id        uuid,
    created_at     timestamp with time zone default current_timestamp not null,
    updated_at     timestamp with time zone default current_timestamp not null,
    constraint email_invitations_pk primary key (id),
    constraint email_invitations_team_id_fk foreign key (team_id) references public.teams (id) on delete cascade,
    constraint email_invitations_team_member_id_fk
        foreign key (team_member_id) references public.team_members (id) on delete cascade,
    constraint email_invitations_role_id_fk foreign key (role_id) references public.roles (id) on delete set null
);


-- =============================================================================
-- SECTION 3: Per-user settings + onboarding
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1 notification_settings (legacy: notification_settings).
--     Legacy PK was (user_id, team_id). Here we keep a surrogate id PK and a
--     UNIQUE(user_id, team_id) so the row can be referenced/upserted cleanly,
--     and we add created_at/updated_at (the orchestrator may want timestamps).
--     Legacy show_unread_items_count is dropped (out of Phase 2 brief scope).
-- -----------------------------------------------------------------------------
create table if not exists public.notification_settings (
    id                          uuid                     default gen_random_uuid() not null,
    user_id                     uuid                                               not null,
    team_id                     uuid                                               not null,
    email_notifications_enabled boolean                  default true              not null,
    popup_notifications_enabled boolean                  default true              not null,
    daily_digest_enabled        boolean                  default false             not null,
    created_at                  timestamp with time zone default current_timestamp not null,
    updated_at                  timestamp with time zone default current_timestamp not null,
    constraint notification_settings_pk primary key (id),
    constraint notification_settings_user_team_unique unique (user_id, team_id),
    constraint notification_settings_user_id_fk foreign key (user_id) references public.users (id) on delete cascade,
    constraint notification_settings_team_id_fk foreign key (team_id) references public.teams (id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- 3.2 survey_responses (onboarding survey — SIMPLIFIED).
--     The legacy schema modelled onboarding as four tables
--     (surveys / survey_questions / survey_responses / survey_answers). For
--     Phase 2 we collapse that into ONE table holding the raw answers as jsonb;
--     the questionnaire is currently app-side static, so a single response row
--     per submission is sufficient. organization_id is nullable (the survey can
--     be answered before/independently of an org).
-- -----------------------------------------------------------------------------
create table if not exists public.survey_responses (
    id              uuid                     default gen_random_uuid() not null,
    user_id         uuid                                               not null,
    organization_id uuid,
    response        jsonb                    default '{}'::jsonb        not null,
    created_at      timestamp with time zone default current_timestamp not null,
    constraint survey_responses_pk primary key (id),
    constraint survey_responses_user_id_fk foreign key (user_id) references public.users (id) on delete cascade,
    constraint survey_responses_organization_id_fk
        foreign key (organization_id) references public.organizations (id) on delete set null
);


-- =============================================================================
-- SECTION 4: Indexes
-- =============================================================================
create index if not exists clients_team_id_index
    on public.clients (team_id);
create unique index if not exists clients_name_team_id_uindex
    on public.clients (lower(name), team_id);

create index if not exists team_labels_team_id_index
    on public.team_labels (team_id);
create unique index if not exists team_labels_name_team_id_uindex
    on public.team_labels (lower(name), team_id);

create index if not exists project_categories_team_id_index
    on public.project_categories (team_id);
create unique index if not exists project_categories_name_team_id_uindex
    on public.project_categories (lower(name), team_id);

create index if not exists email_invitations_team_id_index
    on public.email_invitations (team_id);
create index if not exists email_invitations_email_index
    on public.email_invitations (email);
create index if not exists email_invitations_team_member_id_index
    on public.email_invitations (team_member_id);

create index if not exists notification_settings_user_id_index
    on public.notification_settings (user_id);
create index if not exists notification_settings_team_id_index
    on public.notification_settings (team_id);

create index if not exists survey_responses_user_id_index
    on public.survey_responses (user_id);


-- =============================================================================
-- SECTION 5: Enable Row Level Security
-- =============================================================================
alter table public.clients               enable row level security;
alter table public.team_labels           enable row level security;
alter table public.project_categories    enable row level security;
alter table public.email_invitations     enable row level security;
alter table public.notification_settings enable row level security;
alter table public.survey_responses      enable row level security;


-- =============================================================================
-- SECTION 6: RLS policies
-- =============================================================================
-- Convention (matches Phase 1): drop-then-create so the migration is
-- re-runnable; policies target the `authenticated` role; service_role bypasses
-- RLS. Helper funcs public.is_team_member / public.is_team_admin are REUSED.

-- -------------------------------------------------------------------
-- 6.1 clients — members read; admins write
-- -------------------------------------------------------------------
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
    for insert to authenticated
    with check (public.is_team_admin(team_id));

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
    for update to authenticated
    using (public.is_team_admin(team_id))
    with check (public.is_team_admin(team_id));

drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients
    for delete to authenticated
    using (public.is_team_admin(team_id));

-- -------------------------------------------------------------------
-- 6.2 team_labels — members read AND write (members create labels)
-- -------------------------------------------------------------------
drop policy if exists team_labels_select on public.team_labels;
create policy team_labels_select on public.team_labels
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists team_labels_insert on public.team_labels;
create policy team_labels_insert on public.team_labels
    for insert to authenticated
    with check (public.is_team_member(team_id));

drop policy if exists team_labels_update on public.team_labels;
create policy team_labels_update on public.team_labels
    for update to authenticated
    using (public.is_team_member(team_id))
    with check (public.is_team_member(team_id));

drop policy if exists team_labels_delete on public.team_labels;
create policy team_labels_delete on public.team_labels
    for delete to authenticated
    using (public.is_team_member(team_id));

-- -------------------------------------------------------------------
-- 6.3 project_categories — members read; admins write
-- -------------------------------------------------------------------
drop policy if exists project_categories_select on public.project_categories;
create policy project_categories_select on public.project_categories
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists project_categories_insert on public.project_categories;
create policy project_categories_insert on public.project_categories
    for insert to authenticated
    with check (public.is_team_admin(team_id));

drop policy if exists project_categories_update on public.project_categories;
create policy project_categories_update on public.project_categories
    for update to authenticated
    using (public.is_team_admin(team_id))
    with check (public.is_team_admin(team_id));

drop policy if exists project_categories_delete on public.project_categories;
create policy project_categories_delete on public.project_categories
    for delete to authenticated
    using (public.is_team_admin(team_id));

-- -------------------------------------------------------------------
-- 6.4 email_invitations — team members OR the invitee read; admins write
--     The invitee predicate lets a not-yet-member user discover and accept
--     an invite addressed to their own email. The email is compared against
--     the caller's profile email (citext = citext is case-insensitive).
-- -------------------------------------------------------------------
drop policy if exists email_invitations_select on public.email_invitations;
create policy email_invitations_select on public.email_invitations
    for select to authenticated
    using (
        public.is_team_member(team_id)
        or email = (select u.email from public.users u where u.id = auth.uid())
    );

drop policy if exists email_invitations_insert on public.email_invitations;
create policy email_invitations_insert on public.email_invitations
    for insert to authenticated
    with check (public.is_team_admin(team_id));

drop policy if exists email_invitations_delete on public.email_invitations;
create policy email_invitations_delete on public.email_invitations
    for delete to authenticated
    using (public.is_team_admin(team_id));

-- -------------------------------------------------------------------
-- 6.5 notification_settings — strictly user-private (all ops)
-- -------------------------------------------------------------------
drop policy if exists notification_settings_select on public.notification_settings;
create policy notification_settings_select on public.notification_settings
    for select to authenticated
    using (user_id = auth.uid());

drop policy if exists notification_settings_insert on public.notification_settings;
create policy notification_settings_insert on public.notification_settings
    for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists notification_settings_update on public.notification_settings;
create policy notification_settings_update on public.notification_settings
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists notification_settings_delete on public.notification_settings;
create policy notification_settings_delete on public.notification_settings
    for delete to authenticated
    using (user_id = auth.uid());

-- -------------------------------------------------------------------
-- 6.6 survey_responses — strictly user-private (all ops)
-- -------------------------------------------------------------------
drop policy if exists survey_responses_select on public.survey_responses;
create policy survey_responses_select on public.survey_responses
    for select to authenticated
    using (user_id = auth.uid());

drop policy if exists survey_responses_insert on public.survey_responses;
create policy survey_responses_insert on public.survey_responses
    for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists survey_responses_update on public.survey_responses;
create policy survey_responses_update on public.survey_responses
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists survey_responses_delete on public.survey_responses;
create policy survey_responses_delete on public.survey_responses
    for delete to authenticated
    using (user_id = auth.uid());


-- =============================================================================
-- SECTION 7: Onboarding / invite RPC functions (SECURITY DEFINER)
-- =============================================================================
-- Both are SECURITY DEFINER with a pinned search_path. They act on behalf of
-- auth.uid() and write across tenant tables, so they bypass RLS by design;
-- internal predicates restrict what each caller can actually do.

-- -----------------------------------------------------------------------------
-- 7.1 complete_account_setup(p_team_name, p_organization_name)
--     Renames the caller's ACTIVE team and its organization, then marks the
--     caller's profile setup_completed = true. Returns the team id.
--
--     SIMPLIFIED vs legacy complete_account_setup(_user_id, _team_id, _body):
--     the legacy version also created a project, task_statuses, project_members,
--     tasks, tasks_assignees and invited team members. Those tables DO NOT EXIST
--     yet (projects/tasks are a later phase), so that work is DEFERRED. Only the
--     team rename + org rename + setup flag are performed here.
-- -----------------------------------------------------------------------------
create or replace function public.complete_account_setup(
    p_team_name         text,
    p_organization_name text default null
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id  uuid := auth.uid();
    _team_id  uuid;
    _org_id   uuid;
    _new_name text;
    _new_org  text;
begin
    if _user_id is null then
        raise exception 'complete_account_setup: no authenticated user';
    end if;

    _new_name := left(trim(coalesce(p_team_name, '')), 55);
    if _new_name = '' then
        raise exception 'complete_account_setup: team name is required';
    end if;

    -- Resolve the caller's active team; fall back to a team they OWN.
    select u.active_team into _team_id from public.users u where u.id = _user_id;
    if _team_id is null then
        select t.id into _team_id
        from public.teams t
        where t.user_id = _user_id
        order by t.created_at
        limit 1;
    end if;

    if _team_id is null then
        raise exception 'complete_account_setup: no team found for user %', _user_id;
    end if;

    -- Org name defaults to the team name when not supplied.
    _new_org := left(trim(coalesce(nullif(trim(p_organization_name), ''), _new_name)), 255);

    -- Rename the team (only if the caller owns it — guards against renaming a
    -- team the user merely belongs to).
    update public.teams
    set name = _new_name, updated_at = current_timestamp
    where id = _team_id and user_id = _user_id;

    -- Rename the owning organization (caller must be the org owner).
    select t.organization_id into _org_id from public.teams t where t.id = _team_id;
    if _org_id is not null then
        update public.organizations
        set organization_name = _new_org, updated_at = current_timestamp
        where id = _org_id and user_id = _user_id;
    end if;

    -- Mark onboarding complete.
    update public.users
    set setup_completed = true, updated_at = current_timestamp
    where id = _user_id;

    return _team_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7.2 accept_invitation(p_invitation_id)
--     For the current auth user: looks up the email_invitations row, verifies
--     the invite email matches the caller's profile email, then inserts a
--     team_members row linking auth.uid() to the invite's team with the invite's
--     role (defaulting to the team's default Member role when role_id is null).
--     Guards against duplicate membership, then deletes the invitation.
--     Returns the team id.
--
--     Re-homed from legacy accept_invitation(_email,_team_member_id,_user_id):
--     legacy attached the user to a PRE-CREATED pending team_members row; here
--     a pure email invite has no such row, so we INSERT the membership.
-- -----------------------------------------------------------------------------
create or replace function public.accept_invitation(p_invitation_id uuid)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id     uuid := auth.uid();
    _user_email  citext;
    _team_id     uuid;
    _role_id     uuid;
    _invite_role uuid;
    _existing    uuid;
begin
    if _user_id is null then
        raise exception 'accept_invitation: no authenticated user';
    end if;

    select u.email into _user_email from public.users u where u.id = _user_id;
    if _user_email is null then
        raise exception 'accept_invitation: caller has no profile';
    end if;

    -- Load the invitation.
    select ei.team_id, ei.role_id
    into _team_id, _invite_role
    from public.email_invitations ei
    where ei.id = p_invitation_id
      and ei.email = _user_email;

    if _team_id is null then
        raise exception 'accept_invitation: invitation % not found for this user', p_invitation_id;
    end if;

    -- Resolve the role: invite role, else the team's default (Member) role.
    _role_id := _invite_role;
    if _role_id is null then
        select r.id into _role_id
        from public.roles r
        where r.team_id = _team_id and r.default_role is true
        limit 1;
    end if;

    if _role_id is null then
        raise exception 'accept_invitation: no role resolvable for team %', _team_id;
    end if;

    -- Guard against duplicate membership: if already a member, just (re)activate
    -- and clean up the invite.
    select tm.id into _existing
    from public.team_members tm
    where tm.team_id = _team_id and tm.user_id = _user_id;

    if _existing is not null then
        update public.team_members
        set active = true, updated_at = current_timestamp
        where id = _existing;
    else
        insert into public.team_members (user_id, team_id, role_id, active)
        values (_user_id, _team_id, _role_id, true);
    end if;

    -- Consume the invitation.
    delete from public.email_invitations where id = p_invitation_id;

    return _team_id;
end;
$$;


-- =============================================================================
-- SECTION 8: Function execute grants
-- =============================================================================
grant execute on function public.complete_account_setup(text, text) to authenticated;
grant execute on function public.accept_invitation(uuid)             to authenticated;


-- =============================================================================
-- SECTION 9: Table privileges for the API roles
-- =============================================================================
-- RLS (above) governs which ROWS are visible/mutable; these grants govern
-- TABLE-level access. Without them every query fails with "permission denied"
-- before RLS is even evaluated. (Phase 1's blanket grants cover *existing*
-- tables; these target the new Phase 2 tables explicitly so the migration is
-- self-sufficient if applied in isolation.)
grant select, insert, update, delete on public.clients               to authenticated;
grant select, insert, update, delete on public.team_labels           to authenticated;
grant select, insert, update, delete on public.project_categories    to authenticated;
grant select, insert, update, delete on public.email_invitations     to authenticated;
grant select, insert, update, delete on public.notification_settings to authenticated;
grant select, insert, update, delete on public.survey_responses      to authenticated;

grant all on public.clients               to service_role;
grant all on public.team_labels           to service_role;
grant all on public.project_categories    to service_role;
grant all on public.email_invitations     to service_role;
grant all on public.notification_settings to service_role;
grant all on public.survey_responses      to service_role;

-- =============================================================================
-- END Phase 2
-- =============================================================================
