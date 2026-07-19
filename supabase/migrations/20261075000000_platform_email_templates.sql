-- =============================================================================
-- Platform email templates — super-admin-editable subject/body per scenario.
-- =============================================================================
-- Until now email content was hard-coded. This table lets a platform admin
-- override the subject + INNER body html for any registered trigger from
-- Admin → Email; the branded outer shell and {{variable}} rendering live in
-- app code (src/lib/email/templates.ts). No row = the code default is used;
-- deleting a row resets to default.
--
-- Variables are simple {{name}} placeholders substituted (HTML-escaped) at
-- send time. Which variables exist depends on the scenario (e.g. the signup
-- welcome gets {{name}}, {{email}}, {{app_url}}).

create table if not exists public.platform_email_templates (
    event_key  text                                               not null,
    subject    text                                               not null,
    body_html  text                                               not null,
    updated_by uuid,
    created_at timestamp with time zone default current_timestamp not null,
    updated_at timestamp with time zone default current_timestamp not null,
    constraint platform_email_templates_pk primary key (event_key),
    constraint platform_email_templates_event_key_fk
        foreign key (event_key) references public.platform_email_triggers (event_key)
            on delete cascade,
    constraint platform_email_templates_updated_by_fk
        foreign key (updated_by) references public.users (id) on delete set null,
    constraint platform_email_templates_subject_check
        check (char_length(subject) between 1 and 500),
    constraint platform_email_templates_body_check
        check (char_length(body_html) between 1 and 100000)
);

alter table public.platform_email_templates enable row level security;

drop policy if exists platform_email_templates_select on public.platform_email_templates;
create policy platform_email_templates_select on public.platform_email_templates
    for select to authenticated
    using (public.is_platform_admin());

drop policy if exists platform_email_templates_write on public.platform_email_templates;
create policy platform_email_templates_write on public.platform_email_templates
    for all to authenticated
    using (public.is_platform_admin())
    with check (public.is_platform_admin());

grant select, insert, update, delete on public.platform_email_templates to authenticated;
grant all on public.platform_email_templates to service_role;
revoke all on public.platform_email_templates from anon;

-- =============================================================================
-- END platform email templates
-- =============================================================================
