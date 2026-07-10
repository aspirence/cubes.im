// Seed HR-4 payroll demo into Acme Inc. Inserts rows directly (service_role can't
// call the is_hr_admin-gated RPCs), mirroring the India-preset + compute_payslip math.
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const BASE = env.NEXT_PUBLIC_SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
const get = p => fetch(`${BASE}/rest/v1/${p}`, { headers: H }).then(r => r.json());
const ins = async (t, b) => { const r = await fetch(`${BASE}/rest/v1/${t}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(b) }); if (!r.ok) { console.error('INS ERR', t, r.status, (await r.text()).slice(0, 180)); return []; } return r.json(); };
const r2 = n => Math.round(n * 100) / 100;

const demoUser = (await get(`users?email=eq.demo@cubes.test&select=id,active_team`))[0];
const org = (await get(`teams?id=eq.${demoUser.active_team}&select=organization_id`))[0].organization_id;
const employees = await get(`hr_employees?org_id=eq.${org}&select=id,full_name,user_id&order=created_at`);
for (const t of ['hr_payslips', 'hr_payroll_runs', 'hr_salary_components', 'hr_salary_structures', 'hr_reimbursements', 'hr_loans_advances', 'hr_bank_details'])
  await fetch(`${BASE}/rest/v1/${t}?org_id=eq.${org}`, { method: 'DELETE', headers: H });

const ctcs = [180000, 132000, 96000, 120000, 84000, 72000, 66000];
// May 2026 weekdays (working days)
let wd = 0; for (let d = 1; d <= 31; d++) { const dow = new Date(2026, 4, d).getDay(); if (dow !== 0 && dow !== 6) wd++; }

const run = (await ins('hr_payroll_runs', { org_id: org, period_month: 5, period_year: 2026, status: 'finalized', run_by: demoUser.id, run_at: '2026-06-01T09:00:00Z', total_gross: 0, total_deductions: 0, total_net: 0, employee_count: 0 }))[0];

const structures = [], components = [], payslips = [];
let tg = 0, td = 0, tn = 0;
for (let i = 0; i < employees.length; i++) {
  const e = employees[i], ctc = ctcs[i % ctcs.length];
  const st = (await ins('hr_salary_structures', { org_id: org, employee_id: e.id, ctc, currency: 'USD', effective_from: '2026-01-01' }))[0];
  structures.push(st);
  const monthly = ctc / 12, basic = r2(monthly * 0.4), hra = r2(basic * 0.5), special = r2(monthly - basic - hra), pf = r2(basic * 0.12), pt = 200;
  components.push(
    { structure_id: st.id, org_id: org, employee_id: e.id, name: 'Basic', kind: 'earning', calc: 'percent_of_ctc', value: 40, is_basic: true, sort_order: 1 },
    { structure_id: st.id, org_id: org, employee_id: e.id, name: 'HRA', kind: 'earning', calc: 'percent_of_basic', value: 50, is_basic: false, sort_order: 2 },
    { structure_id: st.id, org_id: org, employee_id: e.id, name: 'Special Allowance', kind: 'earning', calc: 'fixed', value: special, is_basic: false, sort_order: 3 },
    { structure_id: st.id, org_id: org, employee_id: e.id, name: 'Provident Fund', kind: 'deduction', calc: 'percent_of_basic', value: 12, is_basic: false, sort_order: 4 },
    { structure_id: st.id, org_id: org, employee_id: e.id, name: 'Professional Tax', kind: 'deduction', calc: 'fixed', value: pt, is_basic: false, sort_order: 5 },
  );
  const gross = r2(basic + hra + special), ded = r2(pf + pt), net = r2(gross - ded);
  tg += gross; td += ded; tn += net;
  payslips.push({ payroll_run_id: run.id, org_id: org, employee_id: e.id, gross, total_deductions: ded, net, working_days: wd, paid_days: wd, lop_days: 0,
    earnings: [{ name: 'Basic', amount: basic }, { name: 'HRA', amount: hra }, { name: 'Special Allowance', amount: special }],
    deductions: [{ name: 'Provident Fund', amount: pf }, { name: 'Professional Tax', amount: pt }] });
}
await ins('hr_salary_components', components);
await ins('hr_payslips', payslips);
await fetch(`${BASE}/rest/v1/hr_payroll_runs?id=eq.${run.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ total_gross: r2(tg), total_deductions: r2(td), total_net: r2(tn), employee_count: payslips.length }) });

// bank details for user-linked employees
const linked = employees.filter(e => e.user_id);
await ins('hr_bank_details', linked.map((e, i) => ({ org_id: org, employee_id: e.id, account_name: e.full_name, account_number: '00012345' + String(6700 + i), ifsc: 'CHAS00' + (10 + i), bank_name: ['Chase', 'Bank of America', 'Wells Fargo'][i % 3] })));

// reimbursements: a mix of pending + approved (uniform keys)
const reimb = [];
for (let i = 0; i < Math.min(4, employees.length); i++) {
  const e = employees[i], approved = i % 2 === 0;
  reimb.push({ org_id: org, employee_id: e.id, category: ['Travel', 'Meals', 'Software', 'Training'][i % 4], amount: [320, 75, 120, 480][i % 4], date: '2026-06-0' + (i + 2), status: approved ? 'approved' : 'pending', receipt_path: null, approver_id: approved ? demoUser.id : null, decided_at: approved ? '2026-06-10T10:00:00Z' : null });
}
await ins('hr_reimbursements', reimb);

// one active loan
await ins('hr_loans_advances', { org_id: org, employee_id: employees[1].id, type: 'loan', principal: 6000, emi: 500, balance: 4500, status: 'active' });

console.log(`HR-4 seed: ${structures.length} salary structures, ${payslips.length} payslips (May 2026, gross ${r2(tg)}), ${linked.length} bank details, ${reimb.length} reimbursements, 1 loan. Org Acme Inc.`);
