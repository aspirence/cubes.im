// Seed a rich demo dataset into the cloud project. Uses the service-role key
// (bypasses RLS). Login afterwards as demo@cubes.test / Demo1234!
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };

async function call(path, opts = {}) {
  const r = await fetch(BASE + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) console.error('ERR', opts.method || 'GET', path, r.status, String(t).slice(0, 160));
  return j;
}
const get = p => call('/rest/v1/' + p);
const ins = (table, body) => call('/rest/v1/' + table, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
const patch = (p, body) => call('/rest/v1/' + p, { method: 'PATCH', body: JSON.stringify(body) });
const rand = a => a[Math.floor(Math.random() * a.length)];
const pickN = (a, n) => { const c = [...a]; const o = []; for (let i = 0; i < n && c.length; i++) o.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]); return o; };
const daysFromNow = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString(); };

// ---- 0. clean any prior demo users (cascade removes their data) ----
const existing = await call('/auth/v1/admin/users?per_page=200');
for (const u of (existing.users || [])) {
  if ((u.email || '').endsWith('@cubes.test')) await call('/auth/v1/admin/users/' + u.id, { method: 'DELETE' });
}

// ---- 1. create 5 users (Demo + 4 teammates) ----
const people = [
  { email: 'demo@cubes.test', name: 'Demo Owner' },
  { email: 'alice@cubes.test', name: 'Alice Ng' },
  { email: 'bob@cubes.test', name: 'Bob Lee' },
  { email: 'carol@cubes.test', name: 'Carol Diaz' },
  { email: 'dave@cubes.test', name: 'Dave Kim' },
];
const ids = {};
for (const p of people) {
  const u = await call('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: p.email, password: 'Demo1234!', email_confirm: true, user_metadata: { name: p.name } }) });
  ids[p.email] = u.id;
}
const demo = ids['demo@cubes.test'];
await new Promise(r => setTimeout(r, 800)); // let triggers settle

// ---- 2. demo's auto-provisioned team/org + roles ----
const team = (await get(`users?id=eq.${demo}&select=active_team`))[0].active_team;
const org = (await get(`teams?id=eq.${team}&select=organization_id`))[0].organization_id;
const roles = await get(`roles?team_id=eq.${team}&select=id,default_role`);
const memberRole = (roles.find(r => r.default_role) || roles[0]).id;
await patch(`organizations?id=eq.${org}`, { organization_name: 'Acme Inc' });
await patch(`teams?id=eq.${team}`, { name: 'Acme Inc' });
await patch(`users?id=eq.${demo}`, { setup_completed: true });

// ---- 3. add the 4 teammates to Acme Inc ----
for (const email of ['alice@cubes.test', 'bob@cubes.test', 'carol@cubes.test', 'dave@cubes.test']) {
  await ins('team_members', { user_id: ids[email], team_id: team, role_id: memberRole, active: true });
}
const tms = await get(`team_members?team_id=eq.${team}&active=eq.true&select=id,user_id`);
const members = tms.map(t => ({ teamMemberId: t.id, userId: t.user_id }));
const userIds = members.map(m => m.userId);

// ---- 4. team-scoped settings data ----
await ins('clients', [{ team_id: team, name: 'Globex Corp' }, { team_id: team, name: 'Initech' }, { team_id: team, name: 'Umbrella Co' }]);
const clients = await get(`clients?team_id=eq.${team}&select=id`);
const labels = await ins('team_labels', [
  { team_id: team, name: 'Bug', color_code: '#f5222d' }, { team_id: team, name: 'Feature', color_code: '#52c41a' },
  { team_id: team, name: 'Design', color_code: '#722ed1' }, { team_id: team, name: 'Urgent', color_code: '#fa8c16' },
  { team_id: team, name: 'Backend', color_code: '#1890ff' },
]);
await ins('project_categories', [
  { team_id: team, name: 'Engineering', created_by: demo, color_code: '#1890ff' },
  { team_id: team, name: 'Marketing', created_by: demo, color_code: '#fa8c16' },
  { team_id: team, name: 'Design', created_by: demo, color_code: '#722ed1' },
]);
const cats = await get(`project_categories?team_id=eq.${team}&select=id,name`);
await ins('job_titles', [{ team_id: team, name: 'Engineer' }, { team_id: team, name: 'Designer' }, { team_id: team, name: 'PM' }]);
const sysStatuses = await get('sys_project_statuses?select=id,name');
const sysHealths = await get('sys_project_healths?select=id,name');
const priorities = await get('task_priorities?select=id,name,value&order=value');

// ---- 5. projects + tasks ----
const projDefs = [
  { name: 'Website Redesign', key: 'WEB', color: '#3b7ddd', cat: 'Design', tasks: ['Audit current site', 'Wireframes', 'Design mockups', 'Build homepage', 'Build pricing page', 'Responsive pass', 'SEO meta', 'Accessibility review', 'QA pass', 'Launch'] },
  { name: 'Mobile App v2', key: 'APP', color: '#52c41a', cat: 'Engineering', tasks: ['Spec API', 'Auth flow', 'Onboarding screens', 'Push notifications', 'Offline cache', 'Crash reporting', 'Beta release', 'App store assets', 'Submit to review'] },
  { name: 'Marketing Q3', key: 'MKT', color: '#fa8c16', cat: 'Marketing', tasks: ['Campaign brief', 'Landing page copy', 'Email sequence', 'Social calendar', 'Ad creatives', 'Webinar', 'Analytics dashboard', 'Wrap-up report'] },
  { name: 'Internal Tools', key: 'TOOL', color: '#722ed1', cat: 'Engineering', tasks: ['Admin dashboard', 'Bulk import', 'Role permissions', 'Audit log', 'Export to CSV', 'Slack integration', 'On-call rotation'] },
  { name: 'Customer Portal', key: 'PORT', color: '#eb2f96', cat: 'Engineering', tasks: ['Billing page', 'Invoices', 'Support tickets', 'Knowledge base', 'SSO', 'Usage metrics', 'Dark mode', 'Profile settings'] },
];
const comments = ['Looks good, ship it 🚀', 'Can we revisit the spacing here?', 'Blocked on the API — pinging backend.', 'Done, moved to review.', 'Nice work on this!', 'Added a few edge cases to test.'];
let taskCount = 0;
for (const pd of projDefs) {
  const cat = cats.find(c => c.name === pd.cat);
  const [proj] = await ins('projects', {
    name: pd.name, key: pd.key, team_id: team, owner_id: demo, color_code: pd.color,
    category_id: cat?.id, client_id: rand(clients).id, status_id: rand(sysStatuses).id,
    health_id: rand(sysHealths).id, start_date: daysFromNow(-20), end_date: daysFromNow(40),
  });
  const pid = proj.id;
  const statuses = await get(`task_statuses?project_id=eq.${pid}&select=id,sort_order,sys_task_status_categories(is_todo,is_doing,is_done)&order=sort_order`);
  const todo = statuses.find(s => s.sys_task_status_categories.is_todo)?.id;
  const doing = statuses.find(s => s.sys_task_status_categories.is_doing)?.id;
  const done = statuses.find(s => s.sys_task_status_categories.is_done)?.id;
  await ins('project_members', members.map(m => ({ project_id: pid, team_member_id: m.teamMemberId })));
  await ins('project_phases', [
    { project_id: pid, name: 'Discovery', sort_index: 0, color_code: '#1890ff' },
    { project_id: pid, name: 'Build', sort_index: 1, color_code: '#52c41a' },
    { project_id: pid, name: 'Launch', sort_index: 2, color_code: '#fa8c16' },
  ]);
  let i = 0;
  for (const name of pd.tasks) {
    const bucket = i < pd.tasks.length * 0.45 ? todo : i < pd.tasks.length * 0.75 ? doing : done;
    const reporter = rand(members);
    const [task] = await ins('tasks', {
      project_id: pid, name, status_id: bucket, priority_id: rand(priorities).id,
      reporter_id: reporter.userId, description: '',
      start_date: daysFromNow(-10 + i), end_date: daysFromNow((i % 3 === 0 ? -2 : 5) + i * 2),
    });
    taskCount++;
    const assignees = pickN(members, 1 + (i % 2));
    await ins('tasks_assignees', assignees.map(m => ({ task_id: task.id, team_member_id: m.teamMemberId, assigned_by: demo })));
    const labs = pickN(labels, i % 3);
    if (labs.length) await ins('task_labels', labs.map(l => ({ task_id: task.id, label_id: l.id })));
    if (i % 3 === 0) {
      await ins('tasks', [
        { project_id: pid, name: `${name} — part A`, parent_task_id: task.id, status_id: todo, reporter_id: demo },
        { project_id: pid, name: `${name} — part B`, parent_task_id: task.id, status_id: doing, reporter_id: demo },
      ]);
    }
    if (i % 2 === 0) await ins('task_comments', { task_id: task.id, content: rand(comments), created_by: rand(members).userId });
    if (i % 2 === 1) await ins('task_work_log', { task_id: task.id, user_id: rand(members).userId, time_spent: (30 + (i * 25) % 180) * 60, is_billable: i % 2 === 0, description: 'Worked on this' });
    i++;
  }
  await ins('project_comments', [
    { project_id: pid, content: `Kicked off ${pd.name} 🎉 — target launch in 6 weeks.`, created_by: demo },
    { project_id: pid, content: 'Weekly sync moved to Thursdays.', created_by: rand(members).userId },
  ]);
}

// ---- 6. personal todos + notifications for demo ----
await ins('personal_todo_list', ['Review Alice\'s PR', 'Prep Monday standup', 'Email Globex about scope', 'Book design review'].map((n, i) => ({ user_id: demo, name: n, index: i, done: i === 1 })));
await ins('user_notifications', [
  { user_id: demo, team_id: team, message: 'Alice assigned you to "Build homepage"', type: 'assignment', read: false },
  { user_id: demo, team_id: team, message: 'Bob commented on "QA pass"', type: 'comment', read: false },
  { user_id: demo, team_id: team, message: 'Carol mentioned you in a project update', type: 'mention', read: true },
]);

console.log(`DONE. ${projDefs.length} projects, ${taskCount} top-level tasks, ${members.length} members.`);
console.log('Login: demo@cubes.test / Demo1234!');
