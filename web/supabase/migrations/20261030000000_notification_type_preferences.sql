-- =============================================================================
-- Personalized notifications — per-category opt-out.
-- =============================================================================
-- Until now each user had three coarse switches (email / pop-up / daily digest,
-- see phase2 notification_settings) and the in-app choke-point
-- `create_notification` only honoured the pop-up master switch. This adds
-- fine-grained control: a user can mute individual notification CATEGORIES
-- (assignment / comment / mention / info) while leaving the rest on.
--
-- Model: an OPT-OUT list `muted_types text[]` on notification_settings (per
-- (user, team), matching the existing row grain). Empty (the default) = every
-- category is delivered, so existing users and any future notification type are
-- ON by default — muting is always an explicit choice. Enforcement stays at the
-- single SECURITY DEFINER choke-point every trigger/RPC already routes through,
-- so no call site changes and no bespoke checks leak into feature code.

-- -----------------------------------------------------------------------------
-- 1. Column
-- -----------------------------------------------------------------------------
alter table public.notification_settings
    add column if not exists muted_types text[] default '{}'::text[] not null;

-- -----------------------------------------------------------------------------
-- 2. create_notification — now also respects the recipient's muted categories
-- -----------------------------------------------------------------------------
-- Identical 7-arg signature (grants + all existing callers unchanged). Two
-- guards run only when a team context is present (muting is per-team, like the
-- pop-up switch): the master pop-up switch, then the per-category opt-out.
create or replace function public.create_notification(
    p_user_id    uuid,
    p_message    text,
    p_type       text default 'info',
    p_url        text default null,
    p_team_id    uuid default null,
    p_task_id    uuid default null,
    p_project_id uuid default null
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _message text := trim(coalesce(p_message, ''));
    _type    text := coalesce(nullif(trim(p_type), ''), 'info');
    _popup   boolean;
    _muted   text[];
    _id      uuid;
begin
    if p_user_id is null or _message = '' then
        return null;
    end if;

    -- Respect the recipient's per-team preferences. Absence of a settings row
    -- => notify (defaults: popup on, nothing muted).
    if p_team_id is not null then
        select ns.popup_notifications_enabled, ns.muted_types
            into _popup, _muted
            from public.notification_settings ns
            where ns.user_id = p_user_id and ns.team_id = p_team_id;
        -- Master in-app switch off => skip everything.
        if _popup is false then
            return null;
        end if;
        -- Per-category opt-out: the recipient muted this notification type.
        if _muted is not null and _type = any(_muted) then
            return null;
        end if;
    end if;

    insert into public.user_notifications (user_id, team_id, message, type, url, task_id, project_id)
    values (p_user_id, p_team_id, _message, _type, p_url, p_task_id, p_project_id)
    returning id into _id;

    return _id;
end;
$$;

-- `create or replace` preserves the existing grants (authenticated / service_role)
-- and the search_path; the signature is unchanged so every caller stays bound.
