// Seed HR-2 attendance demo data into Acme Inc. Run after seed-hr-demo.mjs.
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const BASE = env.NEXT_PUBLIC_SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
const get = p => fetch(`${BASE}/rest/v1/${p}`, { headers: H }).then(r => r.json());
const ins = async (t, b) => {
  const r = await fetch(`${BASE}/rest/v1/${t}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(b) });
  if (!r.ok) { console.error('INS ERR', t, r.status, (await r.text()).slice(0, 200)); return []; }
  return r.json();
};
const pad = n => String(n).padStart(2, '0');

const demoUser = (await get(`users?email=eq.demo@cubes.test&select=active_team`))[0];
const org = (await get(`teams?id=eq.${demoUser.active_team}&select=organization_id`))[0].organization_id;
const employees = await get(`hr_employees?org_id=eq.${org}&user_id=not.is.null&select=id,full_name`);
// clean prior HR-2 demo rows
for (const t of ['hr_attendance', 'hr_attendance_regularizations', 'hr_employee_shifts', 'hr_shifts', 'hr_holidays'])
  await fetch(`${BASE}/rest/v1/${t}?org_id=eq.${org}`, { method: 'DELETE', headers: H });

// NOTE: PostgREST bulk insert requires EVERY object in an array to have the
// SAME keys (PGRST102), so keep keys uniform across rows.
await ins('hr_shifts', [
  { org_id: org, name: 'General (9–6)', start_time: '09:00', end_time: '18:00', break_minutes: 60, working_days: [1, 2, 3, 4, 5], is_default: true },
  { org_id: org, name: 'Early (7–4)', start_time: '07:00', end_time: '16:00', break_minutes: 45, working_days: [1, 2, 3, 4, 5], is_default: false },
]);
await ins('hr_holidays', [
  { org_id: org, date: '2026-07-04', name: 'Independence Day', optional: false },
  { org_id: org, date: '2026-09-07', name: 'Labor Day', optional: false },
  { org_id: org, date: '2026-12-25', name: 'Christmas', optional: false },
  { org_id: org, date: '2026-06-19', name: 'Company Offsite', optional: true },
]);

// attendance for the last ~30 days for each user-linked employee (uniform keys)
const today = new Date();
const rows = [];
for (const emp of employees) {
  for (let d = 0; d < 30; d++) {
    const dt = new Date(today); dt.setDate(today.getDate() - d);
    const dow = dt.getDay();
    const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    let status, mins = null, cin = null, cout = null;
    if (dow === 0 || dow === 6) status = 'weekend';
    else {
      const r = Math.random();
      if (r < 0.12) { status = 'wfh'; mins = 480 + Math.floor(Math.random() * 60); cin = `09:0${d % 6}`; cout = `18:0${d % 6}`; }
      else if (r < 0.16) status = 'absent';
      else if (r < 0.22) status = 'leave';
      else { status = 'present'; mins = 510 + Math.floor(Math.random() * 60); cin = `09:0${d % 6}`; cout = `18:0${d % 6}`; }
    }
    rows.push({
      org_id: org, employee_id: emp.id, date: dateStr, status, source: 'system',
      clock_in: cin ? `${dateStr}T${cin}:00Z` : null,
      clock_out: cout ? `${dateStr}T${cout}:00Z` : null,
      work_minutes: mins,
    });
  }
}
// insert in chunks
for (let i = 0; i < rows.length; i += 100) await ins('hr_attendance', rows.slice(i, i + 100));
console.log(`HR-2 seed: 2 shifts, 4 holidays, ${rows.length} attendance rows for ${employees.length} employees (~30 days each).`);
