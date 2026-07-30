-- Seed HR-5 demo data into Acme Inc: birthdays + work anniversaries within the
-- next ~30 days (so the dashboard widgets populate) and onboarding/offboarding
-- checklists. Dates are relative to the DB current_date.
--   psql "$SUPABASE_DB_URL" -f scripts/seed-hr5-demo.sql
do $$
declare
  oid uuid;
  bob uuid; carol uuid; alice uuid; demo uuid; dave uuid; tom uuid; priya uuid;
begin
  select organization_id into oid from teams where id=(select active_team from users where email='demo@cubes.test');
  select id into bob   from hr_employees where org_id=oid and full_name='Bob Lee';
  select id into carol from hr_employees where org_id=oid and full_name='Carol Diaz';
  select id into alice from hr_employees where org_id=oid and full_name='Alice Ng';
  select id into demo  from hr_employees where org_id=oid and full_name='Demo Owner';
  select id into dave  from hr_employees where org_id=oid and full_name='Dave Kim';
  select id into tom   from hr_employees where org_id=oid and full_name='Tom Becker';
  select id into priya from hr_employees where org_id=oid and full_name='Priya Sharma';

  -- birthdays within the next ~30 days (keep a realistic birth year)
  update hr_employees set date_of_birth = make_date(1991, extract(month from current_date+5)::int,  extract(day from current_date+5)::int)  where id=bob;
  update hr_employees set date_of_birth = make_date(1993, extract(month from current_date+13)::int, extract(day from current_date+13)::int) where id=carol;
  update hr_employees set date_of_birth = make_date(1989, extract(month from current_date+22)::int, extract(day from current_date+22)::int) where id=alice;

  -- work anniversaries within the next ~30 days (>=1 year tenure)
  update hr_employees set date_of_joining = make_date(extract(year from current_date)::int-3, extract(month from current_date+8)::int,  extract(day from current_date+8)::int)  where id=demo;
  update hr_employees set date_of_joining = make_date(extract(year from current_date)::int-2, extract(month from current_date+18)::int, extract(day from current_date+18)::int) where id=dave;

  -- onboarding checklist for Tom (intern), offboarding for Priya
  delete from hr_onboarding_tasks where org_id=oid;
  insert into hr_onboarding_tasks (org_id, employee_id, kind, title, status, sort_order)
  select oid, tom, 'onboarding', t.title, t.st, t.ord from (values
    ('Sign offer letter','done',1),('Complete paperwork','done',2),('Set up workstation & accounts','done',3),
    ('Add to payroll','in_progress',4),('Assign onboarding buddy','pending',5),('Day-1 orientation','pending',6),('30-day check-in','pending',7)
  ) t(title,st,ord);
  insert into hr_onboarding_tasks (org_id, employee_id, kind, title, status, sort_order)
  select oid, priya, 'offboarding', t.title, t.st, t.ord from (values
    ('Knowledge transfer','in_progress',1),('Revoke system access','pending',2),('Collect company assets','pending',3),
    ('Final payroll settlement','pending',4),('Exit interview','pending',5)
  ) t(title,st,ord);
end $$;
