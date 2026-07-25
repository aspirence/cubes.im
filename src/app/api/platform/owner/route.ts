import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizePlatform } from "@/lib/email/server";
import { serviceClient } from "@/lib/apps/server";

/**
 * Full drill-down for ONE owner/organization, for the super-admin dashboard:
 * business details, workspaces, members, projects/spaces, billing and recent
 * activity. Cross-tenant, so service-role — gated on a verified platform admin.
 * Read-only. Scoped to a single org, so the queries stay cheap.
 */

export const runtime = "nodejs";

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
const monthlyCents = (p: Pricing, gb: number, seats: number) =>
  p.base_price_cents +
  Math.max(0, seats) * p.price_per_user_cents +
  Math.max(0, gb - p.base_storage_gb) * p.price_per_gb_cents;

export async function GET(request: NextRequest) {
  const auth = await authorizePlatform(true);
  if (!auth.ok) return auth.response;

  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  if (!orgId) return NextResponse.json({ error: "orgId is required." }, { status: 400 });

  const admin = serviceClient() as unknown as SupabaseClient | null;
  if (!admin) return NextResponse.json({ error: "Service role not configured." }, { status: 500 });

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select(
      "id, organization_name, contact_number, contact_number_secondary, address_line_1, address_line_2, city, state, postal_code, country, trial_in_progress, trial_expire_date, subscription_status, storage, working_hours, user_id, created_at, updated_at",
    )
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr) return NextResponse.json({ error: orgErr.message }, { status: 500 });
  if (!org) return NextResponse.json({ error: "Owner not found." }, { status: 404 });

  const [ownerR, countryR, teamsR, pricingR] = await Promise.all([
    admin.from("users").select("id, name, email, avatar_url, created_at, active_team").eq("id", org.user_id).maybeSingle(),
    org.country
      ? admin.from("countries").select("name").eq("id", org.country).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("teams").select("id, name, created_at").eq("organization_id", orgId),
    admin.from("platform_pricing").select("*").maybeSingle(),
  ]);

  const teams = teamsR.data ?? [];
  const teamIds = teams.map((t) => t.id);
  const pricing: Pricing = pricingR.data
    ? {
        base_price_cents: Number(pricingR.data.base_price_cents ?? 0),
        price_per_user_cents: Number(pricingR.data.price_per_user_cents ?? 100),
        base_storage_gb: Number(pricingR.data.base_storage_gb ?? 100),
        price_per_gb_cents: Number(pricingR.data.price_per_gb_cents ?? 20),
        currency: pricingR.data.currency ?? "USD",
      }
    : DEFAULT_PRICING;

  const [membersR, foldersR, projectsR, subsR] = await Promise.all([
    teamIds.length
      ? admin
          .from("team_members")
          .select("team_id, active, member_type, created_at, users(name, email, avatar_url), roles(name)")
          .in("team_id", teamIds)
      : Promise.resolve({ data: [] }),
    teamIds.length
      ? admin.from("project_folders").select("id, name, team_id").in("team_id", teamIds)
      : Promise.resolve({ data: [] }),
    teamIds.length
      ? admin.from("projects").select("id, name, team_id, folder_id, created_at").in("team_id", teamIds)
      : Promise.resolve({ data: [] }),
    teamIds.length
      ? admin.from("team_subscriptions").select("team_id, plan, status, storage_gb, current_period_end").in("team_id", teamIds)
      : Promise.resolve({ data: [] }),
  ]);

  const members = membersR.data ?? [];
  const folders = foldersR.data ?? [];
  const projects = projectsR.data ?? [];
  const subs = subsR.data ?? [];
  const projectIds = projects.map((p) => p.id);
  const now = Date.now();

  // Task footprint + recent activity (only if the owner has any projects).
  let totalTasks = 0;
  let doneTasks = 0;
  let recentTasks: { id: string; name: string; done: boolean; updated_at: string | null; project: string }[] = [];
  if (projectIds.length) {
    const projName = new Map(projects.map((p) => [p.id, p.name]));
    const [totalR, doneR, recentR] = await Promise.all([
      admin.from("tasks").select("id", { count: "exact", head: true }).in("project_id", projectIds),
      admin.from("tasks").select("id", { count: "exact", head: true }).in("project_id", projectIds).eq("done", true),
      admin
        .from("tasks")
        .select("id, name, done, updated_at, project_id")
        .in("project_id", projectIds)
        .order("updated_at", { ascending: false })
        .limit(8),
    ]);
    totalTasks = totalR.count ?? 0;
    doneTasks = doneR.count ?? 0;
    recentTasks = (recentR.data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      done: t.done,
      updated_at: t.updated_at,
      project: projName.get(t.project_id) ?? "—",
    }));
  }

  // Per-team rollups.
  const subByTeam = new Map(subs.map((s) => [s.team_id, s]));
  const teamIsPaid = (s: (typeof subs)[number] | undefined) =>
    !!s && s.plan === "cloud" && s.status === "active" && (!s.current_period_end || new Date(s.current_period_end).getTime() > now);

  const teamRows = teams.map((t) => {
    const tMembers = members.filter((m) => m.team_id === t.id && m.active);
    const seats = Math.max(1, tMembers.filter((m) => m.member_type !== "guest").length);
    const sub = subByTeam.get(t.id);
    const paid = teamIsPaid(sub);
    return {
      id: t.id,
      name: t.name,
      createdAt: t.created_at,
      members: tMembers.length,
      guests: tMembers.filter((m) => m.member_type === "guest").length,
      spaces: folders.filter((f) => f.team_id === t.id).length,
      projects: projects.filter((p) => p.team_id === t.id).length,
      plan: paid ? "cloud" : "free",
      status: sub?.status ?? "free",
      storageGb: Number(sub?.storage_gb ?? pricing.base_storage_gb),
      renewsAt: sub?.current_period_end ?? null,
      estMonthlyCents: paid ? monthlyCents(pricing, Number(sub?.storage_gb ?? pricing.base_storage_gb), seats) : 0,
    };
  });

  const memberRows = members
    .map((m) => {
      const u = (m.users ?? {}) as { name?: string; email?: string; avatar_url?: string | null };
      const role = (m.roles ?? {}) as { name?: string };
      return {
        name: u.name ?? null,
        email: u.email ?? null,
        avatar: u.avatar_url ?? null,
        role: role.name ?? m.member_type,
        memberType: m.member_type as string,
        active: m.active as boolean,
        teamId: m.team_id as string,
      };
    })
    // Owner first, then admins, then the rest; de-emphasize inactive.
    .sort((a, b) => Number(b.active) - Number(a.active));

  const folderName = new Map(folders.map((f) => [f.id, f.name]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      name: p.name,
      team: teamName.get(p.team_id) ?? "—",
      space: p.folder_id ? folderName.get(p.folder_id) ?? null : null,
      createdAt: p.created_at,
    }));

  const estMonthlyCents = teamRows.reduce((s, t) => s + t.estMonthlyCents, 0);
  const lastActive = recentTasks[0]?.updated_at ?? null;

  return NextResponse.json({
    currency: pricing.currency,
    owner: {
      name: ownerR.data?.name ?? null,
      email: ownerR.data?.email ?? null,
      avatar: ownerR.data?.avatar_url ?? null,
      joinedAt: ownerR.data?.created_at ?? org.created_at,
    },
    business: {
      workspaceName: org.organization_name,
      contactNumber: org.contact_number ?? null,
      contactNumberSecondary: org.contact_number_secondary ?? null,
      addressLine1: org.address_line_1 ?? null,
      addressLine2: org.address_line_2 ?? null,
      city: org.city ?? null,
      state: org.state ?? null,
      postalCode: org.postal_code ?? null,
      country: (countryR.data as { name?: string } | null)?.name ?? null,
      workingHours: org.working_hours ?? null,
      subscriptionStatus: org.subscription_status ?? null,
      trialInProgress: org.trial_in_progress ?? false,
      trialExpireDate: org.trial_expire_date ?? null,
      createdAt: org.created_at,
      updatedAt: org.updated_at,
    },
    footprint: {
      workspaces: teams.length,
      members: members.filter((m) => m.active && m.member_type !== "guest").length,
      guests: members.filter((m) => m.active && m.member_type === "guest").length,
      spaces: folders.length,
      projects: projects.length,
      tasks: totalTasks,
      tasksDone: doneTasks,
      estMonthlyCents,
      lastActive,
    },
    teams: teamRows,
    members: memberRows,
    recentProjects,
    recentTasks,
  });
}
