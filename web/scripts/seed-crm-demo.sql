-- Demo CRM data for one project (dev only). Re-running first removes the
-- previous demo rows (scripts/remove-crm-demo.sql does the same on its own).
--
--   psql "$SUPABASE_DB_URL" -X -1 -v ON_ERROR_STOP=1 -f scripts/seed-crm-demo.sql
--
-- Markers, so nothing real is ever touched by the cleanup:
--   deals      source_ref ->> 'seed' = 'crm-demo'
--   people     email ends with '@example.com'
--   companies  domain ends with '.example'
--   campaign   notes = 'crm-demo'
--   tasks, notes, reminders: the ones pointing at the rows above.

\ir remove-crm-demo.sql

do $$
declare
    _team    uuid := 'd2d4e65e-c1f3-4c08-962b-4027ee42ebcc';  -- Aspirence
    _project uuid := '3c01bf47-a00b-4145-8df0-53801e540e39';  -- Dr. Samyak Tiwari
    _vinay   uuid := 'cefa7385-7799-4857-80ce-f9916b98a060';  -- vinay@aspirence.com (owner)
    _hr      uuid := 'c1f707c6-564b-4351-9f93-a7519386bd9c';  -- hr@aspirence.com (CRM access)
    s_new uuid; s_screen uuid; s_meet uuid; s_prop uuid; s_cust uuid;
    _gold uuid;
    _camp uuid;
    c_infosys uuid; c_tata uuid; c_medi uuid;
    p_rohit uuid; p_priya uuid; p_anjali uuid; p_meera uuid; p_karan uuid;
    p_sneha uuid; p_amit uuid; p_neha uuid;
    d uuid;
    d_rohit uuid; d_priya uuid; d_anjali uuid; d_infosys uuid; d_meera uuid; d_tata uuid;
    t uuid;
    n uuid;
begin
    select id into s_new    from public.app_crm_stages where team_id = _team and name = 'New';
    select id into s_screen from public.app_crm_stages where team_id = _team and name = 'Screening';
    select id into s_meet   from public.app_crm_stages where team_id = _team and name = 'Meeting';
    select id into s_prop   from public.app_crm_stages where team_id = _team and name = 'Proposal';
    select id into s_cust   from public.app_crm_stages where team_id = _team and name = 'Customer';
    select id into _gold    from public.app_crm_labels where team_id = _team and name = 'Gold' limit 1;

    -- A lead-source campaign (the CRM's campaigns are workspace-wide).
    insert into public.app_crm_campaigns (team_id, name, channel, status, currency_code, started_on, daily_budget, notes, created_by)
    values (_team, 'Implant awareness — Meta', 'Meta', 'active', 'INR', current_date - 21, 1500, 'crm-demo', _vinay)
    returning id into _camp;

    -- Companies: corporate tie-ups and an insurer.
    insert into public.app_crm_companies (team_id, project_id, name, domain, address_city, address_country, currency_code, employees, icp, account_owner_id, created_by)
    values (_team, _project, 'Infosys Pune — Corporate Wellness', 'infosys-wellness.example', 'Pune', 'India', 'INR', 12000, true, _vinay, _vinay)
    returning id into c_infosys;
    insert into public.app_crm_companies (team_id, project_id, name, domain, address_city, address_country, currency_code, employees, icp, account_owner_id, created_by)
    values (_team, _project, 'Tata Motors — Employee Health', 'tatamotors-health.example', 'Pune', 'India', 'INR', 8000, true, _hr, _vinay)
    returning id into c_tata;
    insert into public.app_crm_companies (team_id, project_id, name, domain, address_city, address_country, currency_code, employees, icp, account_owner_id, created_by)
    values (_team, _project, 'MediAssist TPA', 'mediassist.example', 'Bengaluru', 'India', 'INR', 1500, false, _hr, _vinay)
    returning id into c_medi;

    -- People: patients from the ads, and HR contacts at the tie-ups.
    insert into public.app_crm_people (team_id, project_id, first_name, last_name, email, phone, job_title, city, company_id, created_by) values
        (_team, _project, 'Rohit',  'Sharma',   'rohit.sharma@example.com',  '+91 98220 11234', null,                  'Pune',   null,      _vinay) returning id into p_rohit;
    insert into public.app_crm_people (team_id, project_id, first_name, last_name, email, phone, job_title, city, company_id, created_by) values
        (_team, _project, 'Priya',  'Deshmukh', 'priya.deshmukh@example.com','+91 98900 22345', null,                  'Pune',   null,      _vinay) returning id into p_priya;
    insert into public.app_crm_people (team_id, project_id, first_name, last_name, email, phone, job_title, city, company_id, created_by) values
        (_team, _project, 'Anjali', 'Kulkarni', 'anjali.k@example.com',      '+91 97650 33456', null,                  'Pimpri', null,      _hr)    returning id into p_anjali;
    insert into public.app_crm_people (team_id, project_id, first_name, last_name, email, phone, job_title, city, company_id, created_by) values
        (_team, _project, 'Meera',  'Joshi',    'meera.joshi@example.com',   '+91 99230 44567', null,                  'Pune',   null,      _vinay) returning id into p_meera;
    insert into public.app_crm_people (team_id, project_id, first_name, last_name, email, phone, job_title, city, company_id, created_by) values
        (_team, _project, 'Karan',  'Mehta',    'karan.mehta@example.com',   '+91 98810 55678', 'HR Business Partner', 'Pune',   c_infosys, _vinay) returning id into p_karan;
    insert into public.app_crm_people (team_id, project_id, first_name, last_name, email, phone, job_title, city, company_id, created_by) values
        (_team, _project, 'Sneha',  'Patil',    'sneha.patil@example.com',   '+91 90110 66789', 'Wellness Lead',       'Pune',   c_tata,    _hr)    returning id into p_sneha;
    insert into public.app_crm_people (team_id, project_id, first_name, last_name, email, phone, job_title, city, company_id, created_by) values
        (_team, _project, 'Amit',   'Verma',    'amit.verma@example.com',    '+91 98450 77890', 'Network Manager',     'Bengaluru', c_medi, _hr)    returning id into p_amit;
    insert into public.app_crm_people (team_id, project_id, first_name, last_name, email, phone, job_title, city, company_id, created_by) values
        (_team, _project, 'Neha',   'Gupta',    'neha.gupta@example.com',    '+91 97300 88901', null,                  'Pune',   null,      _vinay) returning id into p_neha;

    -- Deals, across the board.
    insert into public.app_crm_deals (team_id, project_id, name, amount, currency_code, close_date, stage_id, status, company_id, contact_id, owner_id, position, phone, campaign_id, source, source_ref, created_by, created_at)
    values (_team, _project, 'Rohit Sharma — Dental implant', 65000, 'INR', current_date + 12, s_meet, 'qualified', null, p_rohit, _vinay, 1, '+91 98220 11234', _camp, 'meta_lead_ads', '{"seed":"crm-demo","form":"Implant consultation"}', _vinay, now() - interval '9 days')
    returning id into d_rohit;
    insert into public.app_crm_deals (team_id, project_id, name, amount, currency_code, close_date, stage_id, status, company_id, contact_id, owner_id, position, phone, campaign_id, source, source_ref, created_by, created_at)
    values (_team, _project, 'Priya Deshmukh — Clear aligners', 120000, 'INR', current_date + 20, s_prop, 'qualified', null, p_priya, _vinay, 1, '+91 98900 22345', _camp, 'meta_lead_ads', '{"seed":"crm-demo","form":"Aligner enquiry"}', _vinay, now() - interval '14 days')
    returning id into d_priya;
    insert into public.app_crm_deals (team_id, project_id, name, amount, currency_code, close_date, stage_id, status, company_id, contact_id, owner_id, position, phone, campaign_id, source, source_ref, created_by, created_at)
    values (_team, _project, 'Anjali Kulkarni — Root canal + crown', 18000, 'INR', current_date + 4, s_screen, 'follow_up', null, p_anjali, _hr, 1, '+91 97650 33456', _camp, 'meta_lead_ads', '{"seed":"crm-demo"}', _hr, now() - interval '5 days')
    returning id into d_anjali;
    insert into public.app_crm_deals (team_id, project_id, name, amount, currency_code, close_date, stage_id, status, company_id, contact_id, owner_id, position, phone, campaign_id, source, source_ref, created_by, created_at)
    values (_team, _project, 'Infosys — Corporate dental camp (2 days)', 250000, 'INR', current_date + 30, s_prop, 'qualified', c_infosys, p_karan, _vinay, 2, '+91 98810 55678', null, 'referral', '{"seed":"crm-demo"}', _vinay, now() - interval '18 days')
    returning id into d_infosys;
    insert into public.app_crm_deals (team_id, project_id, name, amount, currency_code, close_date, stage_id, status, company_id, contact_id, owner_id, position, phone, campaign_id, source, source_ref, created_by, created_at)
    values (_team, _project, 'Meera Joshi — Teeth whitening', 8000, 'INR', current_date - 3, s_cust, 'converted', null, p_meera, _vinay, 1, '+91 99230 44567', _camp, 'meta_lead_ads', '{"seed":"crm-demo"}', _vinay, now() - interval '24 days')
    returning id into d_meera;
    insert into public.app_crm_deals (team_id, project_id, name, amount, currency_code, close_date, stage_id, status, company_id, contact_id, owner_id, position, phone, campaign_id, source, source_ref, created_by, created_at)
    values (_team, _project, 'Tata Motors — Annual employee check-ups', 180000, 'INR', current_date - 8, s_cust, 'converted', c_tata, p_sneha, _hr, 2, '+91 90110 66789', null, 'referral', '{"seed":"crm-demo"}', _hr, now() - interval '28 days')
    returning id into d_tata;
    insert into public.app_crm_deals (team_id, project_id, name, amount, currency_code, close_date, stage_id, status, company_id, contact_id, owner_id, position, phone, campaign_id, source, source_ref, created_by, created_at)
    values (_team, _project, 'MediAssist — Cashless network empanelment', 0, 'INR', current_date + 45, s_meet, 'contacted', c_medi, p_amit, _hr, 2, '+91 98450 77890', null, 'website', '{"seed":"crm-demo"}', _hr, now() - interval '7 days')
    returning id into d;
    insert into public.app_crm_deals (team_id, project_id, name, amount, currency_code, close_date, stage_id, status, company_id, contact_id, owner_id, position, phone, campaign_id, source, source_ref, created_by, created_at)
    values (_team, _project, 'Neha Gupta — Braces consultation', 45000, 'INR', current_date + 9, s_screen, 'contacted', null, p_neha, _vinay, 2, '+91 97300 88901', _camp, 'meta_lead_ads', '{"seed":"crm-demo"}', _vinay, now() - interval '3 days')
    returning id into d;
    insert into public.app_crm_deals (team_id, project_id, name, amount, currency_code, close_date, stage_id, status, owner_id, position, phone, campaign_id, source, source_ref, created_by, created_at) values
        (_team, _project, 'Walk-in — Wisdom tooth extraction', 9000,  'INR', current_date + 2, s_new,    'new',            _vinay, 1, '+91 98600 12121', null,  'website',       '{"seed":"crm-demo"}', _vinay, now() - interval '1 day'),
        (_team, _project, 'Instagram DM — Smile makeover',     95000, 'INR', current_date + 25, s_new,   'new',            _hr,    2, '+91 91580 34343', _camp, 'meta_lead_ads', '{"seed":"crm-demo"}', _hr,    now() - interval '2 days'),
        (_team, _project, 'Lead form — Kids dental check-up',  2500,  'INR', current_date + 6, s_new,    'new',            _vinay, 3, '+91 99700 56565', _camp, 'meta_lead_ads', '{"seed":"crm-demo"}', _vinay, now() - interval '6 hours'),
        (_team, _project, 'Lead form — Price only, no reply',   0,    'INR', null,             s_screen, 'not_interested', _hr,    3, '+91 90000 78787', _camp, 'meta_lead_ads', '{"seed":"crm-demo"}', _hr,    now() - interval '11 days'),
        (_team, _project, 'Spam — Test submission',             0,    'INR', null,             s_new,    'junk',           _vinay, 4, '+91 90000 00000', _camp, 'meta_lead_ads', '{"seed":"crm-demo"}', _vinay, now() - interval '12 days');

    -- Tags on the two biggest.
    if _gold is not null then
        insert into public.app_crm_deal_labels (team_id, deal_id, label_id, created_by) values
            (_team, d_infosys, _gold, _vinay), (_team, d_priya, _gold, _vinay)
        on conflict do nothing;
    end if;

    -- CRM tasks (some for each CRM member, so "My open tasks" has rows for whoever is looking).
    insert into public.app_crm_tasks (team_id, title, body, due_at, status, assignee_id, created_by)
    values (_team, 'Call Rohit back about implant EMI options', 'He asked for a 6-month plan.', date_trunc('day', now()) + interval '17 hours', 'TODO', _vinay, _vinay) returning id into t;
    insert into public.app_crm_task_targets (team_id, task_id, target_type, target_id) values (_team, t, 'deal', d_rohit);
    insert into public.app_crm_tasks (team_id, title, body, due_at, status, assignee_id, created_by)
    values (_team, 'Send the aligner quote to Priya', 'Include the 3-scan package and the refinement cost.', now() + interval '1 day', 'TODO', _vinay, _vinay) returning id into t;
    insert into public.app_crm_task_targets (team_id, task_id, target_type, target_id) values (_team, t, 'deal', d_priya);
    insert into public.app_crm_tasks (team_id, title, body, due_at, status, assignee_id, created_by)
    values (_team, 'Confirm Anjali''s consultation slot', null, now() - interval '1 day', 'TODO', _hr, _hr) returning id into t;
    insert into public.app_crm_task_targets (team_id, task_id, target_type, target_id) values (_team, t, 'person', p_anjali);
    insert into public.app_crm_tasks (team_id, title, body, due_at, status, assignee_id, created_by)
    values (_team, 'Share the corporate camp deck with Infosys HR', 'Karan wants it before their Friday review.', now() + interval '2 days', 'IN_PROGRESS', _vinay, _vinay) returning id into t;
    insert into public.app_crm_task_targets (team_id, task_id, target_type, target_id) values (_team, t, 'company', c_infosys), (_team, t, 'person', p_karan);
    insert into public.app_crm_tasks (team_id, title, body, due_at, status, assignee_id, created_by)
    values (_team, 'Collect a Google review from Meera', null, now() - interval '2 days', 'DONE', _hr, _vinay) returning id into t;
    insert into public.app_crm_task_targets (team_id, task_id, target_type, target_id) values (_team, t, 'deal', d_meera);
    insert into public.app_crm_tasks (team_id, title, body, due_at, status, assignee_id, created_by)
    values (_team, 'Book the camp dates with Tata''s wellness team', null, now() + interval '4 days', 'TODO', _hr, _hr) returning id into t;
    insert into public.app_crm_task_targets (team_id, task_id, target_type, target_id) values (_team, t, 'deal', d_tata);

    -- Notes.
    insert into public.app_crm_notes (team_id, title, body, created_by)
    values (_team, 'First call', '<p>Missing tooth on the lower left. Wants an implant, worried about cost. Open to EMI.</p>', _vinay) returning id into n;
    insert into public.app_crm_note_targets (team_id, note_id, target_type, target_id) values (_team, n, 'deal', d_rohit);
    insert into public.app_crm_notes (team_id, title, body, created_by)
    values (_team, 'Scope agreed', '<p>2-day camp at Hinjewadi, ~400 employees, screening + cleaning. Follow-up treatment at the clinic at a corporate rate.</p>', _vinay) returning id into n;
    insert into public.app_crm_note_targets (team_id, note_id, target_type, target_id) values (_team, n, 'company', c_infosys), (_team, n, 'deal', d_infosys);
    insert into public.app_crm_notes (team_id, title, body, created_by)
    values (_team, 'Why she chose us', '<p>Saw the before/after reel on Instagram. Booked the same week.</p>', _hr) returning id into n;
    insert into public.app_crm_note_targets (team_id, note_id, target_type, target_id) values (_team, n, 'deal', d_meera);
    insert into public.app_crm_notes (team_id, title, body, created_by)
    values (_team, 'Aligner options shared', '<p>Compared two brands; she prefers the one with fewer aligner changes.</p>', _vinay) returning id into n;
    insert into public.app_crm_note_targets (team_id, note_id, target_type, target_id) values (_team, n, 'person', p_priya);

    -- Reminders. The overdue one is marked notified so the 5-minute sweep
    -- does not ring anyone's bell for demo data.
    insert into public.app_crm_reminders (team_id, target_type, target_id, remind_at, note, user_id, created_by, notified_at) values
        (_team, 'deal',    d_rohit,   now() - interval '3 hours', 'Rohit said to call after lunch',          _vinay, _vinay, now()),
        (_team, 'deal',    d_priya,   now() + interval '3 hours', 'Nudge Priya if the quote is unopened',    _vinay, _vinay, null),
        (_team, 'company', c_infosys, now() + interval '1 day',   'Karan: deck before Friday',               _vinay, _vinay, null),
        (_team, 'person',  p_anjali,  now() + interval '1 day',   'Confirm the slot or offer Saturday',      _hr,    _hr,    null),
        (_team, 'deal',    d_tata,    now() + interval '3 days',  'Share the camp report with Sneha',        _hr,    _hr,    null);
end $$;
