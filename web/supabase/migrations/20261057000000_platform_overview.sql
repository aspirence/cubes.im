-- ============================================================================
-- Superadmin (platform founder) global analytics. is_platform_admin only.
-- SECURITY DEFINER so it can read across all tenants (the ONLY cross-tenant
-- superadmin surface; RLS elsewhere is untouched).
-- ============================================================================
create or replace function public.platform_overview()
    returns json
    language plpgsql stable security definer set search_path = public, extensions
as
$$
declare
    _r json;
begin
    if not public.is_platform_admin() then
        raise exception 'forbidden: platform superadmins only';
    end if;

    select json_build_object(
        'orgs',        (select count(*) from public.organizations),
        'users',       (select count(*) from public.users),
        'workspaces',  (select count(*) from public.teams),
        'projects',    (select count(*) from public.projects),
        'tasks',       (select count(*) from public.tasks),
        'members',     (select count(*) from public.team_members where active is true),
        'guests',      (select count(*) from public.team_members where active is true and member_type = 'guest'),
        'signups_7d',  (select count(*) from public.users where created_at > now() - interval '7 days'),
        'signups_30d', (select count(*) from public.users where created_at > now() - interval '30 days'),
        'plan_free',   (select count(*) from public.team_subscriptions where plan = 'free'),
        'plan_cloud',  (select count(*) from public.team_subscriptions where plan <> 'free'),
        'superadmins', (select count(*) from public.platform_admins),
        'recent_orgs', (
            select coalesce(json_agg(row_to_json(o2)), '[]'::json) from (
                select
                    org.organization_name                                                as name,
                    u.email                                                              as owner_email,
                    org.subscription_status                                              as status,
                    org.created_at                                                       as created_at,
                    (select count(*) from public.teams t where t.organization_id = org.id) as workspaces,
                    (select count(*) from public.team_members tm
                     join public.teams t on t.id = tm.team_id
                     where t.organization_id = org.id and tm.active is true)             as members
                from public.organizations org
                join public.users u on u.id = org.user_id
                order by org.created_at desc nulls last
                limit 12
            ) o2
        )
    ) into _r;

    return _r;
end;
$$;

grant execute on function public.platform_overview() to authenticated;
