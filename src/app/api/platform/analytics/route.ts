import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizePlatform } from "@/lib/email/server";
import { serviceClient } from "@/lib/apps/server";

/**
 * Company-wide analytics for the platform super-admin home dashboard. This is a
 * cross-tenant read, so it runs with the service role (RLS would otherwise scope
 * everything to the caller's own workspace) AFTER the cookie session is verified
 * to belong to a platform admin. Nothing here mutates state.
 *
 * Revenue caveat: actual subscription charges live in Dodo, not our DB — so MRR
 * and next-month numbers are ESTIMATES computed with the app's own pricing
 * formula. The only realized money in-DB is device pre-orders
 * (early_access_requests), reported separately as "collected".
 */

export const runtime = "nodejs";

// Mirror of src/features/billing/use-pricing.ts (that module is "use client").
interface Pricing {
  base_price_cents: number;
  price_per_user_cents: number;
  base_storage_gb: number;
  price_per_gb_cents: number;
  currency: string;
}
const DEFAULT_PRICING: Pricing = {
  base_price_cents: 0,
  price_per_user_cents: 100,
  base_storage_gb: 100,
  price_per_gb_cents: 20,
  currency: "USD",
};
const storageOverageCents = (p: Pricing, gb: number) =>
  Math.max(0, gb - p.base_storage_gb) * p.price_per_gb_cents;
const monthlyCents = (p: Pricing, gb: number, seats: number) =>
  p.base_price_cents + Math.max(0, seats) * p.price_per_user_cents + storageOverageCents(p, gb);

const DAY = 86_400_000;

export async function GET() {
  const auth = await authorizePlatform(true);
  if (!auth.ok) return auth.response;

  const admin = serviceClient() as unknown as SupabaseClient | null;
  if (!admin) {
    return NextResponse.json({ error: "Service role not configured." }, { status: 500 });
  }

  // Pull the tenancy graph + billing rows in parallel. Counts are small (tens of
  // orgs); a generous cap guards against silent 1000-row truncation as it grows.
  const CAP = 10_000;
  const [orgsR, usersR, teamsR, membersR, foldersR, projectsR, subsR, pricingR, ordersR] =
    await Promise.all([
      admin.from("organizations").select("id, organization_name, user_id, subscription_status, created_at").limit(CAP),
      admin.from("users").select("id, email, name, created_at").limit(CAP),
      admin.from("teams").select("id, name, organization_id, created_at").limit(CAP),
      admin.from("team_members").select("team_id, user_id, active, member_type").limit(CAP),
      admin.from("project_folders").select("id, team_id").limit(CAP),
      admin.from("projects").select("id, team_id").limit(CAP),
      admin.from("team_subscriptions").select("team_id, plan, status, storage_gb, current_period_end").limit(CAP),
      admin.from("platform_pricing").select("*").maybeSingle(),
      admin
        .from("early_access_requests")
        .select("name, email, company, amount_cents, payment_status, paid_at, provider")
        .eq("payment_status", "paid")
        .limit(CAP),
    ]);

  const firstErr = [orgsR, usersR, teamsR, membersR, foldersR, projectsR, subsR].find((r) => r.error);
  if (firstErr?.error) {
    return NextResponse.json({ error: firstErr.error.message }, { status: 500 });
  }

  const orgs = orgsR.data ?? [];
  const users = usersR.data ?? [];
  const teams = teamsR.data ?? [];
  const members = membersR.data ?? [];
  const folders = foldersR.data ?? [];
  const projects = projectsR.data ?? [];
  const subs = subsR.data ?? [];
  const pricing: Pricing = pricingR.data
    ? {
        base_price_cents: Number(pricingR.data.base_price_cents ?? 0),
        price_per_user_cents: Number(pricingR.data.price_per_user_cents ?? 100),
        base_storage_gb: Number(pricingR.data.base_storage_gb ?? 100),
        price_per_gb_cents: Number(pricingR.data.price_per_gb_cents ?? 20),
        currency: pricingR.data.currency ?? "USD",
      }
    : DEFAULT_PRICING;
  const orders = ordersR.error ? [] : ordersR.data ?? [];

  // Indexes.
  const usersById = new Map(users.map((u) => [u.id, u]));
  const teamsByOrg = new Map<string, typeof teams>();
  for (const t of teams) {
    if (!t.organization_id) continue;
    const arr = teamsByOrg.get(t.organization_id) ?? [];
    arr.push(t);
    teamsByOrg.set(t.organization_id, arr);
  }
  const activeMembersByTeam = new Map<string, { total: number; guests: number }>();
  for (const m of members) {
    if (!m.active) continue;
    const cur = activeMembersByTeam.get(m.team_id) ?? { total: 0, guests: 0 };
    cur.total += 1;
    if (m.member_type === "guest") cur.guests += 1;
    activeMembersByTeam.set(m.team_id, cur);
  }
  const foldersByTeam = new Map<string, number>();
  for (const f of folders) foldersByTeam.set(f.team_id, (foldersByTeam.get(f.team_id) ?? 0) + 1);
  const projectsByTeam = new Map<string, number>();
  for (const p of projects) projectsByTeam.set(p.team_id, (projectsByTeam.get(p.team_id) ?? 0) + 1);
  const subByTeam = new Map(subs.map((s) => [s.team_id, s]));

  const now = Date.now();
  const teamIsPaid = (s: (typeof subs)[number] | undefined) =>
    !!s &&
    s.plan === "cloud" &&
    s.status === "active" &&
    (!s.current_period_end || new Date(s.current_period_end).getTime() > now);

  // Per-owner rows.
  const owners = orgs.map((org) => {
    const owner = usersById.get(org.user_id);
    const orgTeams = teamsByOrg.get(org.id) ?? [];
    let membersCount = 0;
    let guestsCount = 0;
    let spaces = 0;
    let projectCount = 0;
    let estMonthly = 0;
    let paidTeams = 0;
    let nextRenewal: number | null = null;
    for (const t of orgTeams) {
      const mm = activeMembersByTeam.get(t.id) ?? { total: 0, guests: 0 };
      membersCount += mm.total;
      guestsCount += mm.guests;
      spaces += foldersByTeam.get(t.id) ?? 0;
      projectCount += projectsByTeam.get(t.id) ?? 0;
      const sub = subByTeam.get(t.id);
      if (teamIsPaid(sub)) {
        paidTeams += 1;
        const seats = Math.max(1, mm.total - mm.guests);
        estMonthly += monthlyCents(pricing, Number(sub?.storage_gb ?? pricing.base_storage_gb), seats);
        const cpe = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : null;
        if (cpe && (nextRenewal === null || cpe < nextRenewal)) nextRenewal = cpe;
      }
    }
    return {
      orgId: org.id,
      workspace: org.organization_name ?? "—",
      ownerEmail: owner?.email ?? "—",
      ownerName: owner?.name ?? null,
      createdAt: org.created_at,
      workspaces: orgTeams.length,
      members: membersCount,
      guests: guestsCount,
      spaces,
      projects: projectCount,
      plan: paidTeams > 0 ? "cloud" : "free",
      paidTeams,
      estMonthlyCents: estMonthly,
      nextRenewal: nextRenewal ? new Date(nextRenewal).toISOString() : null,
    };
  });

  // Totals.
  const activeMemberRows = members.filter((m) => m.active);
  const totals = {
    owners: orgs.length,
    users: users.length,
    workspaces: teams.length,
    members: activeMemberRows.filter((m) => m.member_type !== "guest").length,
    guests: activeMemberRows.filter((m) => m.member_type === "guest").length,
    spaces: folders.length,
    projects: projects.length,
    signups7d: users.filter((u) => u.created_at && now - new Date(u.created_at).getTime() < 7 * DAY).length,
    signups30d: users.filter((u) => u.created_at && now - new Date(u.created_at).getTime() < 30 * DAY).length,
    paidWorkspaces: subs.filter((s) => teamIsPaid(s)).length,
    freeWorkspaces: teams.length - subs.filter((s) => teamIsPaid(s)).length,
  };

  // Revenue.
  const estMrrCents = owners.reduce((sum, o) => sum + o.estMonthlyCents, 0);
  const nextMonthCents = owners.reduce((sum, o) => {
    // Teams renewing within the next 31 days contribute their estimated charge.
    if (o.nextRenewal && new Date(o.nextRenewal).getTime() - now < 31 * DAY) return sum + o.estMonthlyCents;
    return sum + o.estMonthlyCents; // recurring by default
  }, 0);
  const deviceCollectedCents = orders.reduce((sum, o) => sum + Number(o.amount_cents ?? 0), 0);

  const statusBreakdown = {
    active: subs.filter((s) => s.status === "active").length,
    paused: subs.filter((s) => s.status === "paused").length,
    canceled: subs.filter((s) => s.status === "canceled").length,
    cloud: subs.filter((s) => s.plan === "cloud").length,
    free: subs.filter((s) => s.plan !== "cloud").length,
  };

  const recentSignups = [...users]
    .filter((u) => u.created_at)
    .sort((a, b) => new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime())
    .slice(0, 8)
    .map((u) => ({ email: u.email, name: u.name, createdAt: u.created_at }));

  const recentPayments = [...orders]
    .filter((o) => o.paid_at)
    .sort((a, b) => new Date(b.paid_at!).getTime() - new Date(a.paid_at!).getTime())
    .slice(0, 8)
    .map((o) => ({
      amountCents: Number(o.amount_cents ?? 0),
      paidAt: o.paid_at,
      who: o.company || o.name || o.email || "—",
      provider: o.provider,
    }));

  return NextResponse.json({
    currency: pricing.currency,
    totals,
    revenue: {
      estMrrCents,
      nextMonthCents,
      deviceCollectedCents,
      deviceOrders: orders.length,
    },
    statusBreakdown,
    owners: owners.sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    }),
    recentSignups,
    recentPayments,
    generatedAt: new Date().toISOString(),
  });
}
