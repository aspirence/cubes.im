// Additive seed: extra Spaces (project folders, some nested) + projects with
// tasks, into the existing demo (Acme) team. Idempotent for its own data
// (deletes projects/folders it owns by key/name, then recreates). Does NOT
// touch the original demo projects. Run: node scripts/seed-more-workspace.mjs
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BASE = env.NEXT_PUBLIC_SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
async function call(path, opts = {}) {
  const r = await fetch(BASE + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) console.error('ERR', opts.method || 'GET', path, r.status, String(t).slice(0, 160));
  return j;
}
const get = p => call('/rest/v1/' + p);
const ins = (t, b) => call('/rest/v1/' + t, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(b) });
const del = p => call('/rest/v1/' + p, { method: 'DELETE' });
const rand = a => a[Math.floor(Math.random() * a.length)];
const pickN = (a, n) => { const c = [...a]; const o = []; for (let i = 0; i < n && c.length; i++) o.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]); return o; };
const daysFromNow = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString(); };

// ---- context (existing Acme team) ----
const demo = (await get(`users?email=eq.demo@cubes.test&select=id`))[0].id;
const team = (await get(`users?id=eq.${demo}&select=active_team`))[0].active_team;
const tms = await get(`team_members?team_id=eq.${team}&active=eq.true&select=id,user_id`);
const members = tms.map(t => ({ teamMemberId: t.id, userId: t.user_id }));
const clients = await get(`clients?team_id=eq.${team}&select=id`);
const cats = await get(`project_categories?team_id=eq.${team}&select=id,name`);
const sysStatuses = await get('sys_project_statuses?select=id,name');
const sysHealths = await get('sys_project_healths?select=id,name');
const priorities = await get('task_priorities?select=id,name,value&order=value');
const catBy = n => cats.find(c => c.name === n)?.id ?? rand(cats).id;

// ---- spaces (folders) ----
const TOP = [
  { name: 'Marketing', key: 'MKTG', color: '#fa8c16' },
  { name: 'Product', key: 'PROD', color: '#5a5ad6' },
  { name: 'Design', key: 'DSGN', color: '#8b6fd6' },
  { name: 'Operations', key: 'OPS', color: '#2f9c9c' },
  { name: 'Sales', key: 'SALE', color: '#3a9d6e' },
];
const NESTED = [{ name: 'Campaigns', key: 'CMPG', color: '#e0663f', parent: 'Marketing' }];
const folderNames = [...TOP, ...NESTED].map(f => f.name);

// ---- projects ----
const PROJECTS = [
  { name: 'Brand Refresh', key: 'BRND', color: '#d96a8f', cat: 'Marketing', space: 'Marketing', tasks: ['Brand audit', 'Logo explorations', 'Color system', 'Typography', 'Brand guidelines', 'Rollout plan'] },
  { name: 'Content Engine', key: 'CNTN', color: '#e0a83e', cat: 'Marketing', space: 'Marketing', tasks: ['Editorial calendar', 'SEO keyword map', 'Blog templates', 'Newsletter setup', 'Guest posts', 'Repurpose to social'] },
  { name: 'Q4 Launch Campaign', key: 'Q4LC', color: '#e0663f', cat: 'Marketing', space: 'Campaigns', tasks: ['Campaign brief', 'Landing page', 'Ad creatives', 'Email drip', 'Influencer outreach', 'Launch day checklist', 'Post-mortem'] },
  { name: 'Holiday Promo', key: 'HOLI', color: '#c0453c', cat: 'Marketing', space: 'Campaigns', tasks: ['Offer strategy', 'Banner set', 'Countdown emails', 'Retargeting ads', 'Wrap-up report'] },
  { name: 'Analytics Suite', key: 'ANLY', color: '#5a5ad6', cat: 'Engineering', space: 'Product', tasks: ['Metrics spec', 'Event tracking', 'Dashboard v1', 'Funnels', 'Cohort retention', 'Export API', 'Alerts'] },
  { name: 'Mobile App v3', key: 'APP3', color: '#3a9d6e', cat: 'Engineering', space: 'Product', tasks: ['Design refresh', 'Offline sync', 'Biometric login', 'Widgets', 'Deep links', 'Performance pass', 'Store submission'] },
  { name: 'Payments V2', key: 'PAY2', color: '#2f9c9c', cat: 'Engineering', space: 'Product', tasks: ['Provider eval', 'Checkout redesign', 'Wallets', 'Refunds flow', 'Fraud checks', 'Reconciliation'] },
  { name: 'Design System', key: 'DSYS', color: '#8b6fd6', cat: 'Design', space: 'Design', tasks: ['Token audit', 'Core components', 'Icon set', 'Docs site', 'Dark mode', 'Adoption guide'] },
  { name: 'Marketing Site', key: 'MSIT', color: '#4a4ad0', cat: 'Design', space: 'Design', tasks: ['Sitemap', 'Homepage', 'Pricing page', 'Case studies', 'CMS setup', 'Launch QA'] },
  { name: 'Onboarding Revamp', key: 'ONBD', color: '#2f9c9c', cat: 'Engineering', space: 'Operations', tasks: ['Journey map', 'Welcome flow', 'Checklist widget', 'Sample data', 'Empty states', 'A/B test'] },
  { name: 'Support Portal', key: 'SUPP', color: '#b8842a', cat: 'Engineering', space: 'Operations', tasks: ['Ticket model', 'Inbox UI', 'SLA rules', 'Macros', 'CSAT survey', 'Knowledge base'] },
  { name: 'CRM Integration', key: 'CRM', color: '#3a9d6e', cat: 'Engineering', space: 'Sales', tasks: ['Field mapping', 'Two-way sync', 'Lead scoring', 'Pipeline views', 'Reports'] },
  { name: 'Partner Deals', key: 'PART', color: '#e0a83e', cat: 'Marketing', space: 'Sales', tasks: ['Partner tiers', 'Deal registration', 'Co-marketing kit', 'Portal access', 'Quarterly review'] },
];

// ---- idempotency: remove our own prior data ----
const keys = PROJECTS.map(p => `"${p.key}"`).join(',');
await del(`projects?team_id=eq.${team}&key=in.(${keys})`);
for (const name of folderNames) await del(`project_folders?team_id=eq.${team}&name=eq.${encodeURIComponent(name)}`);

// ---- create folders ----
const folderId = {};
for (const f of TOP) {
  const [row] = await ins('project_folders', { name: f.name, key: f.key, color_code: f.color, team_id: team, created_by: demo });
  folderId[f.name] = row.id;
}
for (const f of NESTED) {
  const [row] = await ins('project_folders', { name: f.name, key: f.key, color_code: f.color, team_id: team, created_by: demo, parent_folder_id: folderId[f.parent] });
  folderId[f.name] = row.id;
}

// ---- create projects + tasks ----
let taskCount = 0;
const createdProjectIds = [];
for (const pd of PROJECTS) {
  const [proj] = await ins('projects', {
    name: pd.name, key: pd.key, team_id: team, owner_id: demo, color_code: pd.color,
    category_id: catBy(pd.cat), client_id: rand(clients).id, status_id: rand(sysStatuses).id,
    health_id: rand(sysHealths).id, folder_id: folderId[pd.space],
    start_date: daysFromNow(-20), end_date: daysFromNow(40),
  });
  const pid = proj.id; createdProjectIds.push(pid);
  const statuses = await get(`task_statuses?project_id=eq.${pid}&select=id,sys_task_status_categories(is_todo,is_doing,is_done)&order=sort_order`);
  const todo = statuses.find(s => s.sys_task_status_categories.is_todo)?.id;
  const doing = statuses.find(s => s.sys_task_status_categories.is_doing)?.id;
  const done = statuses.find(s => s.sys_task_status_categories.is_done)?.id;
  await ins('project_members', members.map(m => ({ project_id: pid, team_member_id: m.teamMemberId })));
  let i = 0;
  for (const name of pd.tasks) {
    const bucket = i < pd.tasks.length * 0.45 ? todo : i < pd.tasks.length * 0.75 ? doing : done;
    const [task] = await ins('tasks', {
      project_id: pid, name, status_id: bucket, priority_id: rand(priorities).id,
      reporter_id: rand(members).userId, description: '',
      start_date: daysFromNow(-8 + i), end_date: daysFromNow((i % 3 === 0 ? -2 : 6) + i * 2),
    });
    taskCount++;
    const assignees = pickN(members, 1 + (i % 2));
    await ins('tasks_assignees', assignees.map(m => ({ task_id: task.id, team_member_id: m.teamMemberId, assigned_by: demo })));
    i++;
  }
}

// ---- favorite a couple of the new projects ----
for (const pid of [createdProjectIds[0], createdProjectIds[4]].filter(Boolean)) {
  await ins('favorite_projects', { user_id: demo, project_id: pid });
}

console.log(`Seeded ${TOP.length + NESTED.length} spaces (1 nested), ${PROJECTS.length} projects, ${taskCount} tasks into Acme Inc.`);
