// Seed HR-1 demo data into the existing demo org (Acme Inc). Run after seed-demo.mjs.
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const BASE = env.NEXT_PUBLIC_SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
const get = p => fetch(`${BASE}/rest/v1/${p}`, { headers: H }).then(r => r.json());
const ins = (t, b) => fetch(`${BASE}/rest/v1/${t}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(b) }).then(r => r.json());

const demoUser = (await get(`users?email=eq.demo@cubes.test&select=id,active_team`))[0];
const team = demoUser.active_team;
const org = (await get(`teams?id=eq.${team}&select=organization_id`))[0].organization_id;
// clean prior HR demo rows for idempotency
for (const t of ['hr_documents', 'hr_employees', 'hr_admins', 'hr_departments', 'hr_designations'])
  await fetch(`${BASE}/rest/v1/${t}?org_id=eq.${org}`, { method: 'DELETE', headers: H });

const members = await get(`team_members?team_id=eq.${team}&active=eq.true&select=user_id,users(name,email)&order=created_at`);
const people = members.filter(m => m.user_id).map(m => ({ id: m.user_id, name: m.users?.name || 'Member', email: m.users?.email }));

const depts = await ins('hr_departments', ['Engineering', 'Design', 'Marketing', 'Operations'].map(n => ({ org_id: org, name: n })));
const desigs = await ins('hr_designations', [['Head of Engineering', 5], ['Senior Engineer', 3], ['Product Designer', 3], ['Marketing Lead', 4], ['Operations Associate', 2]].map(([t, l]) => ({ org_id: org, title: t, level: l })));
const D = Object.fromEntries(depts.map(d => [d.name, d.id]));
const G = Object.fromEntries(desigs.map(d => [d.title, d.id]));

const plan = [
  { dept: 'Engineering', desig: 'Head of Engineering', type: 'full_time', status: 'active', loc: 'San Francisco', doj: '2021-03-15', manager: true },
  { dept: 'Engineering', desig: 'Senior Engineer', type: 'full_time', status: 'active', loc: 'Remote', doj: '2022-07-01' },
  { dept: 'Design', desig: 'Product Designer', type: 'full_time', status: 'probation', loc: 'New York', doj: '2026-05-20' },
  { dept: 'Marketing', desig: 'Marketing Lead', type: 'full_time', status: 'active', loc: 'Austin', doj: '2023-01-10' },
  { dept: 'Operations', desig: 'Operations Associate', type: 'contract', status: 'active', loc: 'Remote', doj: '2024-09-05' },
];
let managerEmpId = null;
const created = [];
for (let i = 0; i < people.length; i++) {
  const p = people[i], pl = plan[i % plan.length];
  const [emp] = await ins('hr_employees', {
    org_id: org, user_id: p.id, full_name: p.name, work_email: p.email,
    employee_code: 'EMP' + String(i + 1).padStart(3, '0'),
    department_id: D[pl.dept], designation_id: G[pl.desig], employment_type: pl.type, status: pl.status,
    date_of_joining: pl.doj, date_of_birth: `199${i}-0${(i % 8) + 1}-1${i}`, gender: i % 2 ? 'female' : 'male',
    phone: '+1 555 010' + i, work_location: pl.loc, personal_email: p.email,
    manager_id: pl.manager ? null : managerEmpId,
  });
  if (pl.manager) managerEmpId = emp.id;
  created.push(emp.id);
}
// add a couple record-only (no login) employees
await ins('hr_employees', [
  { org_id: org, full_name: 'Priya Sharma', employee_code: 'EMP010', department_id: D['Design'], designation_id: G['Product Designer'], employment_type: 'contract', status: 'active', work_location: 'Remote', date_of_joining: '2025-02-01', manager_id: managerEmpId },
  { org_id: org, full_name: 'Tom Becker', employee_code: 'EMP011', department_id: D['Operations'], designation_id: G['Operations Associate'], employment_type: 'intern', status: 'probation', work_location: 'Berlin', date_of_joining: '2026-06-01', manager_id: managerEmpId },
]);
console.log(`HR seed: ${depts.length} departments, ${desigs.length} designations, ${created.length + 2} employees (incl 2 record-only). Org Acme Inc.`);
