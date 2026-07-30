import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://txrpnoxwczodnzafjozl.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4cnBub3h3Y3pvZG56YWZqb3psIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NTU4MTMsImV4cCI6MjA5NzUzMTgxM30.MELH__fRZehgxNJBPK1cI9ivafOnr1gha7YK8zGLiDM';
const APP = 'http://localhost:3000';
const DIR = '/tmp/wl_screens';
fs.mkdirSync(DIR, { recursive: true });

const email = `uitest+${Date.now()}@cubes.test`;
const pw = 'Test1234!';
const errors = [];

async function api(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, opts);
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

// ---- 1. seed a demo account + data via the API ----
const su = await api('/auth/v1/signup', { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw, data: { name: 'Uma Tester' } }) });
const token = su.access_token, uid = su.user.id;
const H = { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
await api('/rest/v1/rpc/complete_account_setup', { method: 'POST', headers: H, body: JSON.stringify({ p_team_name: 'Acme Inc' }) });
const team = (await api(`/rest/v1/users?id=eq.${uid}&select=active_team`, { headers: H }))[0].active_team;
const pid = await api('/rest/v1/rpc/create_project', { method: 'POST', headers: H, body: JSON.stringify({ p_name: 'Website Redesign', p_team_id: team }) });
for (const n of ['Design mockups', 'Build homepage', 'QA pass', 'Launch']) {
  await api('/rest/v1/rpc/create_task', { method: 'POST', headers: H, body: JSON.stringify({ p_name: n, p_project_id: pid }) });
}
await api('/rest/v1/project_comments', { method: 'POST', headers: H, body: JSON.stringify({ project_id: pid, content: 'Kickoff meeting Monday 🎉', created_by: uid }) });
console.log('seeded', email, 'project', pid);

// ---- 2. browser: log in, screenshot every route ----
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
await page.locator('input#email, input[type="email"], input[placeholder*="mail" i]').first().fill(email);
await page.locator('input#password, input[type="password"]').first().fill(pw);
await page.getByRole('button', { name: /sign in|log ?in/i }).first().click();
await page.waitForURL('**/home', { timeout: 20000 }).catch(() => errors.push('did not reach /home after login (url=' + page.url() + ')'));

async function shot(name, url) {
  try {
    if (url) await page.goto(`${APP}${url}`, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2500);
    // detect Next error overlay
    const overlay = await page.locator('nextjs-portal, [data-nextjs-dialog]').count().catch(() => 0);
    if (overlay) errors.push(`${name}: Next error overlay present`);
    await page.screenshot({ path: `${DIR}/${name}.png` });
    console.log('shot', name, url || '(current)');
  } catch (e) { errors.push(`${name}: ${e.message}`); }
}

await shot('01-home', '/home');
await shot('02-projects', '/projects');
await shot('03-tasks', `/projects/${pid}?tab=tasks`);
await shot('04-board', `/projects/${pid}?tab=board`);
await shot('05-roadmap', `/projects/${pid}?tab=roadmap`);
await shot('06-updates', `/projects/${pid}?tab=updates`);
await shot('07-reporting', '/reporting/overview');
await shot('08-schedule', '/schedule');
await shot('09-settings-profile', '/settings/profile');
await shot('10-settings-templates', '/settings/templates');
await shot('11-admin-overview', '/admin-center/overview');
await shot('12-settings-members', '/settings/members');
await shot('13-settings-account', '/settings/account');

// open a task drawer
await page.goto(`${APP}/projects/${pid}?tab=tasks`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.getByText('Design mockups', { exact: false }).first().click().catch(() => errors.push('could not click task'));
await page.waitForTimeout(2500);
await shot('14-task-drawer', null);

await browser.close();
fs.writeFileSync(`${DIR}/errors.json`, JSON.stringify(errors, null, 2));
console.log('DONE. errors:', errors.length);
errors.forEach(e => console.log(' -', e));
console.log('email:', email, 'uid:', uid);
