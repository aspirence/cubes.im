import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppActionHandler } from "@/lib/workflows/app-action-types";
import { safeErrorText } from "@/lib/apps/auth";

/**
 * Workflow "app" steps for the CRM — the only way another app, a webhook or
 * a schedule writes into it. No app calls these directly; a workflow does,
 * with fields mapped from whatever started the run ({{trigger.email}},
 * {{steps.lookup.deal_id}}), which is what keeps the CRM apart from whatever
 * feeds it.
 *
 * Every query is scoped by ctx.teamId (the client is service_role, so RLS
 * does not do it for us). Stages and campaigns are accepted by id OR by name,
 * because a workflow written by a member who cannot list the CRM (the CRM is
 * admin-only) still has to be able to say "put it in Screening".
 *
 * The CRM is worked per project (migration 20261150000000): a deal, person and
 * company carry a nullable project_id. `project` takes an id only — usually
 * {{trigger.project_id}} — and is checked against this team's projects before
 * anything is written; the same-team trigger in the database is the backstop,
 * and its error is turned into a sentence a member can read.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["new", "contacted", "follow_up", "qualified", "not_interested", "junk", "converted"] as const;
type DealStatus = (typeof STATUSES)[number];
/** A duplicate check only looks at deals still being worked. */
const OPEN_STATUSES: DealStatus[] = ["new", "contacted", "follow_up", "qualified"];
const DEDUPE_MODES = ["email_or_phone", "email", "phone", "none"] as const;
type DedupeMode = (typeof DEDUPE_MODES)[number];

function text(v: unknown, max = 500): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function isStatus(v: unknown): v is DealStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

function email(v: unknown): string | null {
  const s = text(v, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

function phoneDigits(v: unknown): string {
  return text(v, 60).replace(/\D/g, "");
}

function phone(v: unknown): string | null {
  const s = text(v, 60);
  return phoneDigits(s).length >= 7 ? s : null;
}

function amount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function isoDate(v: unknown): string | null {
  const s = text(v, 40);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

function currency(v: unknown): string | null {
  const s = text(v, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

/** A params value that may be an object already (a single token resolved to one) or JSON text. */
function record(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      /* not JSON: keep as nothing */
    }
  }
  return {};
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

function dealUrl(id: string): string {
  return `/crm/deals?m=${id}`;
}

interface StageRow {
  id: string;
  name: string;
  position: number;
}

interface CampaignRow {
  id: string;
  name: string;
  currency_code: string | null;
}

interface PersonRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  company_id: string | null;
}

interface DealRow {
  id: string;
  name: string;
  status: string;
  stage_id: string | null;
  campaign_id: string | null;
  contact_id: string | null;
  company_id: string | null;
  project_id: string | null;
  amount: number | null;
  currency_code: string;
  phone: string | null;
  close_date: string | null;
  created_at: string;
}

const DEAL_COLUMNS =
  "id, name, status, stage_id, campaign_id, contact_id, company_id, project_id, amount, currency_code, phone, close_date, created_at";

const FOREIGN_PROJECT = "That project is not in this workspace (or was deleted). Map a project id from this workspace, e.g. {{trigger.project_id}}.";

/**
 * A database error as text a member may read. The same-team trigger
 * (app_crm_project_same_team) names both ids in its message; say what it means
 * instead.
 */
function dbError(error: { message: string; code?: string }): Error {
  if (error.code === "23514" && /does not belong to team/.test(error.message)) return new Error(FOREIGN_PROJECT);
  return new Error(error.message);
}

/** By id, else by name (case-insensitive); "" → null (caller decides the default); unknown → error text. */
async function resolveStage(admin: SupabaseClient, teamId: string, raw: unknown): Promise<StageRow | null | string> {
  const s = text(raw, 120);
  if (!s) return null;
  const q = admin.from("app_crm_stages").select("id, name, position").eq("team_id", teamId);
  const { data, error } = UUID.test(s) ? await q.eq("id", s).maybeSingle() : await q.ilike("name", s).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StageRow | null) ?? `No CRM stage called "${s}" in this workspace.`;
}

async function defaultStage(admin: SupabaseClient, teamId: string): Promise<StageRow | null> {
  const { data } = await admin
    .from("app_crm_stages")
    .select("id, name, position")
    .eq("team_id", teamId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as StageRow | null) ?? null;
}

async function resolveCampaign(admin: SupabaseClient, teamId: string, raw: unknown): Promise<CampaignRow | null | string> {
  const s = text(raw, 160);
  if (!s) return null;
  const q = admin.from("app_crm_campaigns").select("id, name, currency_code").eq("team_id", teamId).is("deleted_at", null);
  const { data, error } = UUID.test(s) ? await q.eq("id", s).maybeSingle() : await q.ilike("name", s).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CampaignRow | null) ?? `No CRM campaign called "${s}" in this workspace.`;
}

/**
 * The `project` param. "" → undefined (the caller decides what blank means);
 * "none", or "null" (what {{trigger.project_id}} becomes for a deal filed under
 * no project) → { id: null }; the id of one of this team's projects → { id };
 * anything else → error text. Archived projects are accepted: the database
 * accepts them, and the CRM still shows their records.
 */
async function resolveProject(
  admin: SupabaseClient,
  teamId: string,
  raw: unknown,
): Promise<{ id: string | null } | undefined | string> {
  const s = text(raw, 80);
  if (!s) return undefined;
  if (/^(none|null)$/i.test(s)) return { id: null };
  if (!UUID.test(s)) return `"${s.slice(0, 60)}" is not a project id — map one, e.g. {{trigger.project_id}}.`;
  const { data, error } = await admin.from("projects").select("id").eq("id", s).eq("team_id", teamId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: s } : FOREIGN_PROJECT;
}

/** The person this email or phone belongs to, if the CRM already knows them. */
async function findPerson(admin: SupabaseClient, teamId: string, mail: string | null, tel: string | null): Promise<PersonRow | null> {
  const digits = tel ? phoneDigits(tel) : "";
  const tail = digits.slice(-8);
  const filters: string[] = [];
  if (mail) filters.push(`email.ilike.${mail.replace(/[,()]/g, "")}`);
  if (tail.length >= 7) filters.push(`phone.ilike.%${tail}%`);
  if (!filters.length) return null;
  const { data, error } = await admin
    .from("app_crm_people")
    .select("id, first_name, last_name, email, phone, company_id")
    .eq("team_id", teamId)
    .is("deleted_at", null)
    .or(filters.join(","))
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PersonRow[];
  if (mail) {
    const byMail = rows.find((r) => (r.email ?? "").toLowerCase() === mail);
    if (byMail) return byMail;
  }
  if (digits) {
    const byPhone = rows.find((r) => phoneDigits(r.phone) && (phoneDigits(r.phone).endsWith(digits) || digits.endsWith(phoneDigits(r.phone))));
    if (byPhone) return byPhone;
  }
  return null;
}

async function findCompany(admin: SupabaseClient, teamId: string, name: string, domain: string | null): Promise<{ id: string } | null> {
  const q = admin.from("app_crm_companies").select("id").eq("team_id", teamId).is("deleted_at", null);
  if (domain) {
    const { data } = await q.ilike("domain", domain).limit(1).maybeSingle();
    if (data) return data as { id: string };
  }
  const { data } = await admin
    .from("app_crm_companies")
    .select("id")
    .eq("team_id", teamId)
    .is("deleted_at", null)
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}

async function addNote(admin: SupabaseClient, teamId: string, dealId: string, body: string, createdBy: string | null): Promise<string | null> {
  const { data: note, error } = await admin
    .from("app_crm_notes")
    .insert({ team_id: teamId, title: "", body: body.slice(0, 20000), created_by: createdBy })
    .select("id")
    .single();
  if (error || !note) return null;
  await admin.from("app_crm_note_targets").insert({ team_id: teamId, note_id: note.id, target_type: "deal", target_id: dealId });
  return note.id as string;
}

/**
 * An open deal for this contact (or this phone) inside the window — the
 * duplicate a second submission would create. With `projectId` set, only that
 * project's deals count: the same person enquiring about two projects is two
 * deals, and handing back the other project's deal would drop this lead out of
 * this project's view. Without it (no project mapped) the whole team is
 * searched, as before projects existed.
 */
async function findOpenDeal(
  admin: SupabaseClient,
  teamId: string,
  contactId: string | null,
  tel: string | null,
  days: number,
  projectId?: string,
): Promise<DealRow | null> {
  const since = days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
  const base = () => {
    let q = admin
      .from("app_crm_deals")
      .select(DEAL_COLUMNS)
      .eq("team_id", teamId)
      .is("deleted_at", null)
      .in("status", OPEN_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1);
    if (since) q = q.gte("created_at", since);
    if (projectId) q = q.eq("project_id", projectId);
    return q;
  };
  if (contactId) {
    const { data } = await base().eq("contact_id", contactId).maybeSingle();
    if (data) return data as DealRow;
  }
  const tail = tel ? phoneDigits(tel).slice(-8) : "";
  if (tail.length >= 7) {
    const { data } = await base().ilike("phone", `%${tail}%`).maybeSingle();
    if (data) return data as DealRow;
  }
  return null;
}

function dealOutput(deal: DealRow, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deal_id: deal.id,
    name: deal.name,
    status: deal.status,
    stage_id: deal.stage_id,
    campaign_id: deal.campaign_id,
    contact_id: deal.contact_id,
    company_id: deal.company_id,
    project_id: deal.project_id,
    amount: deal.amount,
    currency: deal.currency_code,
    phone: deal.phone,
    close_date: deal.close_date,
    url: dealUrl(deal.id),
    ...extra,
  };
}

/**
 * crm.create_deal — a lead becomes a deal. Finds or creates the person (by
 * email, then phone) and the company (by domain, then name), attaches the
 * campaign, records where the deal came from, and refuses to make the same
 * lead twice: with dedupe on, an open deal for the same person inside the
 * window is returned instead (created: false), so a form that posts twice or
 * a fetch that overlaps never doubles the pipeline.
 *
 * `project` files the deal — and a person or company this step creates for it
 * — under that project; blank files it under no project. A person or company
 * that already exists keeps its own project.
 */
const createDeal: AppActionHandler = async (ctx, params) => {
  const admin = ctx.admin;
  const teamId = ctx.teamId;
  try {
    const mail = email(params.email);
    const tel = phone(params.phone);
    const contactName = text(params.contact_name, 200);
    let name = text(params.name, 200);
    if (!name) name = contactName || mail || tel || "";
    if (!name) return { ok: false, output: {}, error: "Give the deal a name — or map a contact name, email or phone." };

    const status: DealStatus = isStatus(params.status) ? params.status : "new";
    const stage = await resolveStage(admin, teamId, params.stage);
    if (typeof stage === "string") return { ok: false, output: {}, error: stage };
    const campaign = await resolveCampaign(admin, teamId, params.campaign);
    if (typeof campaign === "string") return { ok: false, output: {}, error: campaign };
    // Checked before anything is written, so a bad id never leaves a new
    // person or company behind without the deal they were made for.
    const project = await resolveProject(admin, teamId, params.project);
    if (typeof project === "string") return { ok: false, output: {}, error: project };
    const projectId = project?.id ?? null;
    const stageRow = stage ?? (await defaultStage(admin, teamId));

    const mode: DedupeMode = (DEDUPE_MODES as readonly string[]).includes(String(params.dedupe)) ? (params.dedupe as DedupeMode) : "email_or_phone";
    const dedupeDays = Math.max(0, Math.min(3650, Math.round(Number(params.dedupe_days ?? 30) || 0)));
    const dedupeMail = mode === "email" || mode === "email_or_phone" ? mail : null;
    const dedupeTel = mode === "phone" || mode === "email_or_phone" ? tel : null;

    // The person. Looked up with the dedupe fields only, so "dedupe: none"
    // still creates a fresh contact for a fresh submission.
    let person = mode === "none" ? null : await findPerson(admin, teamId, dedupeMail, dedupeTel);
    const note = text(params.note, 20000);

    if (person && mode !== "none") {
      const existing = await findOpenDeal(admin, teamId, person.id, dedupeTel, dedupeDays, projectId ?? undefined);
      if (existing) {
        if (note) await addNote(admin, teamId, existing.id, `Lead received again: ${note}`, ctx.actorUserId);
        return { ok: true, output: dealOutput(existing, { created: false, duplicate: true, contact_name: contactName || null }) };
      }
    } else if (!person && dedupeTel && mode !== "none") {
      // No contact yet, but the phone may already be on a deal (deals carry
      // their own phone for leads that came in without a person).
      const existing = await findOpenDeal(admin, teamId, null, dedupeTel, dedupeDays, projectId ?? undefined);
      if (existing) {
        if (note) await addNote(admin, teamId, existing.id, `Lead received again: ${note}`, ctx.actorUserId);
        return { ok: true, output: dealOutput(existing, { created: false, duplicate: true, contact_name: contactName || null }) };
      }
    }

    // The company, when named.
    const companyName = text(params.company, 200);
    const companyDomain = text(params.company_domain, 200).toLowerCase() || null;
    let companyId: string | null = person?.company_id ?? null;
    if (companyName && !companyId) {
      const found = await findCompany(admin, teamId, companyName, companyDomain);
      if (found) companyId = found.id;
      else {
        const { data: company, error } = await admin
          .from("app_crm_companies")
          .insert({ team_id: teamId, name: companyName, domain: companyDomain, project_id: projectId, created_by: ctx.actorUserId })
          .select("id")
          .single();
        if (error) throw dbError(error);
        companyId = company.id as string;
      }
    }

    if (!person && (contactName || mail || tel)) {
      const { first, last } = splitName(contactName || (mail ? mail.split("@")[0] : "") || "");
      const { data: created, error } = await admin
        .from("app_crm_people")
        .insert({
          team_id: teamId,
          first_name: first,
          last_name: last,
          email: mail,
          phone: tel,
          company_id: companyId,
          project_id: projectId,
          created_by: ctx.actorUserId,
        })
        .select("id, first_name, last_name, email, phone, company_id")
        .single();
      if (error) throw dbError(error);
      person = created as PersonRow;
    }

    const source = text(params.source, 60) || "workflow";
    const sourceRef: Record<string, unknown> = {
      ...record(params.source_ref),
      workflow_run_id: ctx.runId,
      workflow_step: ctx.stepKey,
    };

    const insert: Record<string, unknown> = {
      team_id: teamId,
      name,
      status,
      stage_id: stageRow?.id ?? null,
      campaign_id: campaign?.id ?? null,
      contact_id: person?.id ?? null,
      company_id: companyId,
      project_id: projectId,
      amount: amount(params.amount),
      close_date: isoDate(params.close_date),
      phone: tel,
      source,
      source_ref: sourceRef,
      created_by: ctx.actorUserId,
    };
    const cur = currency(params.currency) ?? campaign?.currency_code ?? null;
    if (cur) insert.currency_code = cur;

    const { data: deal, error } = await admin.from("app_crm_deals").insert(insert).select(DEAL_COLUMNS).single();
    if (error) throw dbError(error);
    const row = deal as DealRow;

    if (note) await addNote(admin, teamId, row.id, note, ctx.actorUserId);

    return {
      ok: true,
      output: dealOutput(row, {
        created: true,
        duplicate: false,
        stage: stageRow?.name ?? null,
        campaign_name: campaign?.name ?? null,
        contact_name: person ? `${person.first_name} ${person.last_name}`.trim() : null,
        email: person?.email ?? mail,
        source,
      }),
    };
  } catch (err) {
    return { ok: false, output: {}, error: safeErrorText(err, "Could not create the CRM deal.") };
  }
};

/**
 * crm.update_deal — change status, stage, campaign, project, amount or close
 * date; add a note. Blank params leave a field alone — `project` too, so a
 * step saved before projects existed never unfiles a deal; "none" (or a mapped
 * project_id that is null) files it under no project.
 */
const updateDeal: AppActionHandler = async (ctx, params) => {
  const admin = ctx.admin;
  const teamId = ctx.teamId;
  try {
    const dealId = text(params.deal_id, 40);
    if (!UUID.test(dealId)) return { ok: false, output: {}, error: "Map the deal id — for example {{trigger.deal_id}} or {{steps.find.deal_id}}." };

    const patch: Record<string, unknown> = {};
    const status = text(params.status, 40);
    if (status) {
      if (!isStatus(status)) return { ok: false, output: {}, error: `"${status}" is not a CRM status (${STATUSES.join(", ")}).` };
      patch.status = status;
    }
    const stage = await resolveStage(admin, teamId, params.stage);
    if (typeof stage === "string") return { ok: false, output: {}, error: stage };
    if (stage) patch.stage_id = stage.id;
    const campaign = await resolveCampaign(admin, teamId, params.campaign);
    if (typeof campaign === "string") return { ok: false, output: {}, error: campaign };
    if (campaign) patch.campaign_id = campaign.id;
    const project = await resolveProject(admin, teamId, params.project);
    if (typeof project === "string") return { ok: false, output: {}, error: project };
    if (project) patch.project_id = project.id;
    const amt = amount(params.amount);
    if (amt !== null) patch.amount = amt;
    const close = isoDate(params.close_date);
    if (close) patch.close_date = close;
    const name = text(params.name, 200);
    if (name) patch.name = name;

    const { data: before, error: loadError } = await admin
      .from("app_crm_deals")
      .select(DEAL_COLUMNS)
      .eq("id", dealId)
      .eq("team_id", teamId)
      .is("deleted_at", null)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!before) return { ok: false, output: {}, error: "That deal does not exist in this workspace (or was deleted)." };

    let row = before as DealRow;
    if (Object.keys(patch).length) {
      const { data: after, error } = await admin
        .from("app_crm_deals")
        .update(patch)
        .eq("id", dealId)
        .eq("team_id", teamId)
        .select(DEAL_COLUMNS)
        .single();
      if (error) throw dbError(error);
      row = after as DealRow;
    }
    const note = text(params.note, 20000);
    const noteId = note ? await addNote(admin, teamId, row.id, note, ctx.actorUserId) : null;

    return {
      ok: true,
      output: dealOutput(row, {
        changed: Object.keys(patch),
        stage: stage?.name ?? null,
        campaign_name: campaign?.name ?? null,
        note_id: noteId,
      }),
    };
  } catch (err) {
    return { ok: false, output: {}, error: safeErrorText(err, "Could not update the CRM deal.") };
  }
};

/** crm.find_deal — by id, else the newest open deal for an email or phone. `found` is false, not an error, when there is none. */
const findDeal: AppActionHandler = async (ctx, params) => {
  const admin = ctx.admin;
  const teamId = ctx.teamId;
  try {
    const dealId = text(params.deal_id, 40);
    let row: DealRow | null = null;
    let person: PersonRow | null = null;
    if (UUID.test(dealId)) {
      const { data, error } = await admin
        .from("app_crm_deals")
        .select(DEAL_COLUMNS)
        .eq("id", dealId)
        .eq("team_id", teamId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      row = (data as DealRow | null) ?? null;
    } else {
      const mail = email(params.email);
      const tel = phone(params.phone);
      if (!mail && !tel) return { ok: false, output: {}, error: "Map a deal id, an email or a phone to look up." };
      person = await findPerson(admin, teamId, mail, tel);
      row = await findOpenDeal(admin, teamId, person?.id ?? null, tel, 0);
    }
    if (!row) return { ok: true, output: { found: false, deal_id: null } };

    let stageName: string | null = null;
    if (row.stage_id) {
      const { data } = await admin.from("app_crm_stages").select("name").eq("id", row.stage_id).maybeSingle();
      stageName = (data?.name as string | undefined) ?? null;
    }
    return {
      ok: true,
      output: dealOutput(row, {
        found: true,
        stage: stageName,
        contact_name: person ? `${person.first_name} ${person.last_name}`.trim() : null,
        email: person?.email ?? null,
      }),
    };
  } catch (err) {
    return { ok: false, output: {}, error: safeErrorText(err, "Could not look up the CRM deal.") };
  }
};

export const crmActions: Record<"crm.create_deal" | "crm.update_deal" | "crm.find_deal", AppActionHandler> = {
  "crm.create_deal": createDeal,
  "crm.update_deal": updateDeal,
  "crm.find_deal": findDeal,
};
