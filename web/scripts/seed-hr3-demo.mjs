// Seed HR-3 leave demo data into Acme Inc. Run after seed-hr-demo.mjs.
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const BASE = env.NEXT_PUBLIC_SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
const get = p => fetch(`${BASE}/rest/v1/${p}`, { headers: H }).then(r => r.json());
const ins = async (t, b) => { const r = await fetch(`${BASE}/rest/v1/${t}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(b) }); if (!r.ok) { console.error('INS ERR', t, r.status, (await r.text()).slice(0, 160)); return []; } return r.json(); };
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const YEAR = 2026;

const demoUser = (await get(`users?email=eq.demo@cubes.test&select=id,active_team`))[0];
const org = (await get(`teams?id=eq.${demoUser.active_team}&select=organization_id`))[0].organization_id;
const employees = await get(`hr_employees?org_id=eq.${org}&user_id=not.is.null&select=id,full_name,user_id`);
const demoEmp = employees.find(e => e.user_id === demoUser.id);
for (const t of ['hr_leave_requests', 'hr_leave_balances', 'hr_leave_types'])
  await fetch(`${BASE}/rest/v1/${t}?org_id=eq.${org}`, { method: 'DELETE', headers: H });

const types = await ins('hr_leave_types', [
  { org_id: org, name: 'Casual Leave', code: 'CL', paid: true, annual_quota: 12, accrual: 'monthly', carry_forward: false, max_carry_forward: 0, color: '#1890ff' },
  { org_id: org, name: 'Sick Leave', code: 'SL', paid: true, annual_quota: 8, accrual: 'annual', carry_forward: false, max_carry_forward: 0, color: '#fa8c16' },
  { org_id: org, name: 'Earned Leave', code: 'EL', paid: true, annual_quota: 15, accrual: 'monthly', carry_forward: true, max_carry_forward: 30, color: '#52c41a' },
  { org_id: org, name: 'Unpaid Leave', code: 'LOP', paid: false, annual_quota: 0, accrual: 'annual', carry_forward: false, max_carry_forward: 0, color: '#8c8c8c' },
]);
const paid = types.filter(t => t.paid);

// balances for every user-linked employee × paid type (uniform keys)
const balances = [];
for (const e of employees) for (const t of paid) {
  const used = ri(0, Math.min(5, t.annual_quota)), pending = ri(0, 2);
  balances.push({ org_id: org, employee_id: e.id, leave_type_id: t.id, year: YEAR, allotted: t.annual_quota, used, pending, carried_forward: 0 });
}
await ins('hr_leave_balances', balances);

// a few requests: pending ones (others) so demo sees them in Approvals + approved history
const reqs = [];
const cl = types.find(t => t.code === 'CL'), el = types.find(t => t.code === 'EL'), sl = types.find(t => t.code === 'SL');
for (const e of employees.filter(e => e.id !== demoEmp?.id).slice(0, 3)) {
  reqs.push({ org_id: org, employee_id: e.id, leave_type_id: cl.id, from_date: '2026-07-06', to_date: '2026-07-08', days: 3, reason: 'Family function', status: 'pending', approver_id: null, decided_at: null, note: null });
}
if (demoEmp) {
  reqs.push({ org_id: org, employee_id: demoEmp.id, leave_type_id: el.id, from_date: '2026-05-18', to_date: '2026-05-22', days: 5, reason: 'Vacation', status: 'approved', approver_id: demoUser.id, decided_at: '2026-05-10T10:00:00Z', note: 'Enjoy!' });
  reqs.push({ org_id: org, employee_id: demoEmp.id, leave_type_id: sl.id, from_date: '2026-06-15', to_date: '2026-06-15', days: 1, reason: 'Doctor', status: 'approved', approver_id: demoUser.id, decided_at: '2026-06-15T08:00:00Z', note: null });
  reqs.push({ org_id: org, employee_id: demoEmp.id, leave_type_id: cl.id, from_date: '2026-07-20', to_date: '2026-07-21', days: 2, reason: 'Personal', status: 'pending', approver_id: null, decided_at: null, note: null });
}
await ins('hr_leave_requests', reqs);
console.log(`HR-3 seed: ${types.length} leave types, ${balances.length} balances, ${reqs.length} requests. Org Acme Inc.`);
