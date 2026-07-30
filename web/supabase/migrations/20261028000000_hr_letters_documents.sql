-- =============================================================================
-- Cubes Greenfield Rebuild — HR-6: Letters / document templates + generated
--   employee documents
-- =============================================================================
-- Adds:
--   * hr_letter_templates      — org-scoped HR-authored templates
--   * hr_generated_documents   — immutable generated snapshots per employee
--   * set_hr_letters_updated_at() trigger fn for updated_at columns
--   * RLS + grants mirroring the existing HR module
--
-- Notes:
--   * Generated documents store a template snapshot (`template_name`,
--     `template_title_template`, `template_body_template`) so future template
--     edits never mutate already-generated letters.
--   * PDF bytes are not persisted in v1; the generated snapshot is the durable
--     source of truth and the UI can export PDF on demand.
-- =============================================================================

create table if not exists public.hr_letter_templates (
    id             uuid                     default gen_random_uuid() not null,
    org_id         uuid                                               not null,
    name           text                                               not null,
    document_type  text                                               not null,
    title_template text                                               not null,
    body_template  text                                               not null,
    is_active      boolean                  default true              not null,
    is_default     boolean                  default false             not null,
    sort_order     integer                  default 0                 not null,
    created_by     uuid,
    updated_by     uuid,
    created_at     timestamp with time zone default current_timestamp not null,
    updated_at     timestamp with time zone default current_timestamp not null,
    constraint hr_letter_templates_pk primary key (id),
    constraint hr_letter_templates_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_letter_templates_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint hr_letter_templates_updated_by_fk
        foreign key (updated_by) references public.users (id) on delete set null,
    constraint hr_letter_templates_name_check check (char_length(name) <= 200),
    constraint hr_letter_templates_document_type_check check (char_length(document_type) <= 100),
    constraint hr_letter_templates_org_name_uindex unique (org_id, name)
);

create table if not exists public.hr_generated_documents (
    id                       uuid                     default gen_random_uuid() not null,
    org_id                   uuid                                               not null,
    employee_id              uuid                                               not null,
    template_id              uuid,
    document_type            text                                               not null,
    title                    text                                               not null,
    status                   text                     default 'generated'       not null,
    template_name            text                                               not null,
    template_title_template  text                                               not null,
    template_body_template   text                                               not null,
    merge_payload            jsonb                    default '{}'::jsonb       not null,
    merged_text              text                                               not null,
    merged_html              text                                               not null,
    generated_by             uuid,
    created_at               timestamp with time zone default current_timestamp not null,
    updated_at               timestamp with time zone default current_timestamp not null,
    constraint hr_generated_documents_pk primary key (id),
    constraint hr_generated_documents_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_generated_documents_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_generated_documents_template_id_fk
        foreign key (template_id) references public.hr_letter_templates (id) on delete set null,
    constraint hr_generated_documents_generated_by_fk
        foreign key (generated_by) references public.users (id) on delete set null,
    constraint hr_generated_documents_document_type_check check (char_length(document_type) <= 100),
    constraint hr_generated_documents_title_check check (char_length(title) <= 255),
    constraint hr_generated_documents_status_check
        check (status in ('generated', 'issued', 'signed', 'cancelled'))
);

create index if not exists hr_letter_templates_org_id_index
    on public.hr_letter_templates (org_id);
create index if not exists hr_letter_templates_document_type_index
    on public.hr_letter_templates (document_type);
create index if not exists hr_letter_templates_sort_order_index
    on public.hr_letter_templates (org_id, sort_order, created_at);

create index if not exists hr_generated_documents_org_id_index
    on public.hr_generated_documents (org_id);
create index if not exists hr_generated_documents_employee_id_index
    on public.hr_generated_documents (employee_id);
create index if not exists hr_generated_documents_document_type_index
    on public.hr_generated_documents (document_type);
create index if not exists hr_generated_documents_template_id_index
    on public.hr_generated_documents (template_id);
create index if not exists hr_generated_documents_status_index
    on public.hr_generated_documents (status);

create or replace function public.set_hr_letters_updated_at()
    returns trigger
    language plpgsql
    set search_path = public
as
$$
begin
    new.updated_at := current_timestamp;
    return new;
end;
$$;

drop trigger if exists hr_letter_templates_set_updated_at on public.hr_letter_templates;
create trigger hr_letter_templates_set_updated_at
    before update on public.hr_letter_templates
    for each row
    execute function public.set_hr_letters_updated_at();

drop trigger if exists hr_generated_documents_set_updated_at on public.hr_generated_documents;
create trigger hr_generated_documents_set_updated_at
    before update on public.hr_generated_documents
    for each row
    execute function public.set_hr_letters_updated_at();

alter table public.hr_letter_templates enable row level security;
alter table public.hr_generated_documents enable row level security;

drop policy if exists hr_letter_templates_select on public.hr_letter_templates;
create policy hr_letter_templates_select on public.hr_letter_templates
    for select to authenticated
    using (public.is_hr_admin(org_id));

drop policy if exists hr_letter_templates_insert on public.hr_letter_templates;
create policy hr_letter_templates_insert on public.hr_letter_templates
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_letter_templates_update on public.hr_letter_templates;
create policy hr_letter_templates_update on public.hr_letter_templates
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_letter_templates_delete on public.hr_letter_templates;
create policy hr_letter_templates_delete on public.hr_letter_templates
    for delete to authenticated
    using (public.is_hr_admin(org_id));

drop policy if exists hr_generated_documents_select on public.hr_generated_documents;
create policy hr_generated_documents_select on public.hr_generated_documents
    for select to authenticated
    using (
        public.is_hr_admin(org_id)
        or exists (
            select 1 from public.hr_employees e
            where e.id = hr_generated_documents.employee_id
              and e.user_id = auth.uid()
        )
    );

drop policy if exists hr_generated_documents_insert on public.hr_generated_documents;
create policy hr_generated_documents_insert on public.hr_generated_documents
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_generated_documents_update on public.hr_generated_documents;
create policy hr_generated_documents_update on public.hr_generated_documents
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_generated_documents_delete on public.hr_generated_documents;
create policy hr_generated_documents_delete on public.hr_generated_documents
    for delete to authenticated
    using (public.is_hr_admin(org_id));

grant select, insert, update, delete on public.hr_letter_templates to authenticated;
grant select, insert, update, delete on public.hr_generated_documents to authenticated;

grant all on public.hr_letter_templates to service_role;
grant all on public.hr_generated_documents to service_role;

