-- Removes the demo CRM data seeded by scripts/seed-crm-demo.sql, and nothing
-- else (see the markers there). Re-runnable.
--
--   psql "$SUPABASE_DB_URL" -X -1 -v ON_ERROR_STOP=1 -f scripts/remove-crm-demo.sql

create temp table if not exists _crm_demo_ids (target_type text, id uuid) on commit drop;
delete from _crm_demo_ids;
insert into _crm_demo_ids
    select 'deal', id from public.app_crm_deals where source_ref ->> 'seed' = 'crm-demo'
    union all select 'person', id from public.app_crm_people where email like '%@example.com'
    union all select 'company', id from public.app_crm_companies where domain like '%.example';

delete from public.app_crm_reminders r using _crm_demo_ids x where r.target_type = x.target_type and r.target_id = x.id;
delete from public.app_crm_tasks t where exists (
    select 1 from public.app_crm_task_targets tt join _crm_demo_ids x on x.target_type = tt.target_type and x.id = tt.target_id where tt.task_id = t.id);
delete from public.app_crm_notes n where exists (
    select 1 from public.app_crm_note_targets nt join _crm_demo_ids x on x.target_type = nt.target_type and x.id = nt.target_id where nt.note_id = n.id);
delete from public.app_crm_activities a using _crm_demo_ids x where a.target_type = x.target_type and a.target_id = x.id;
delete from public.app_crm_deals where source_ref ->> 'seed' = 'crm-demo';
delete from public.app_crm_people where email like '%@example.com';
delete from public.app_crm_companies where domain like '%.example';
delete from public.app_crm_campaigns where notes = 'crm-demo';
