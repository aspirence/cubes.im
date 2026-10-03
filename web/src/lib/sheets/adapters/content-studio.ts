import { normalize } from "../values";
import { assignedTaskIds } from "./limited";
import {
  AdapterError,
  chunks,
  fetchAll,
  isMissingTable,
  type AdapterCtx,
  type AdapterRecord,
  type ListOptions,
  type SheetAdapter,
} from "./types";

/**
 * Content Studio sheets: one row per item (post, article, newsletter, video).
 *
 * Scope follows Content Studio's own RLS: a project sheet shows that project's
 * items (plus workspace-wide ones when the sheet says so); a workspace sheet
 * shows only workspace-wide items, because every team member can open it and
 * project items are for that project's members.
 *
 * Writes validate against the table's CHECKs (enums, 1..200 / 1..12000 chars,
 * metrics >= 0) and keep the same published_at rule as the Content Studio
 * screens: moving to "published" stamps it, moving back to "draft" clears it.
 *
 * A LIMITED member sees only the items that are theirs — the ones they created,
 * and the ones attached to a task assigned to them — and may write only those.
 * ./limited.ts says why that rule exists and what it is on every other source.
 */

const TYPES = new Set(["social_post", "blog_post", "newsletter", "video", "podcast", "other"]);
const STATUSES = new Set(["draft", "pending_approval", "scheduled", "published", "failed"]);

interface ItemRow {
  id: string;
  project_id: string | null;
  task_id: string | null;
  created_by: string | null;
  campaign_id: string | null;
  title: string;
  body: string;
  content_type: string;
  status: string;
  scheduled_for: string | null;
  published_at: string | null;
  approval_required: boolean;
  target_url: string | null;
  impressions: number;
  engagements: number;
  clicks: number;
  created_at: string;
  updated_at: string;
  links: { destination_id: string; sort_order: number }[] | null;
  task: { task_no: number | null; name: string } | null;
}

const SELECT =
  "id, project_id, task_id, created_by, campaign_id, title, body, content_type, status, scheduled_for, published_at, approval_required, target_url, impressions, engagements, clicks, created_at, updated_at, " +
  "links:app_content_studio_item_destinations!app_content_studio_item_destinations_item_fk(destination_id, sort_order), " +
  "task:tasks!app_content_studio_items_task_fk(task_no, name)";

/** The project_id filter for this sheet's scope (PostgREST `or` syntax or eq). */
function scoped<Q extends { is(c: string, v: null): Q; eq(c: string, v: string): Q; or(f: string): Q }>(
  q: Q,
  ctx: AdapterCtx,
  includeShared: boolean,
): Q {
  if (!ctx.projectId) return q.is("project_id", null);
  if (includeShared) return q.or(`project_id.is.null,project_id.eq.${ctx.projectId}`);
  return q.eq("project_id", ctx.projectId);
}

function includeShared(ctx: AdapterCtx): boolean {
  return ctx.sheet.source_config?.include_shared === true;
}

function toRecord(r: ItemRow): AdapterRecord {
  const links = [...(r.links ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return {
    key: r.id,
    fields: {
      title: r.title,
      body: r.body,
      content_type: r.content_type,
      status: r.status,
      scheduled_for: r.scheduled_for,
      destinations: links.map((l) => l.destination_id),
      campaign: r.campaign_id,
      target_url: r.target_url,
      approval_required: r.approval_required,
      impressions: r.impressions,
      engagements: r.engagements,
      clicks: r.clicks,
      task: r.task ? `#${r.task.task_no ?? "?"} ${r.task.name}` : null,
      published_at: r.published_at,
      updated_at: r.updated_at,
    },
    updatedAt: r.updated_at,
    position: 0,
  };
}

type Ownable = Pick<ItemRow, "id" | "task_id" | "created_by">;

/**
 * Of `rows`, the ones a LIMITED member may see: theirs by authorship, or by
 * the task they hang off. An item nobody created (created_by is nulled when a
 * user is deleted) and that hangs off no task belongs to the team, not to them,
 * so it is excluded — uncertainty excludes. A pass-through for everyone else.
 */
async function keepOwn<T extends Ownable>(ctx: AdapterCtx, rows: T[]): Promise<T[]> {
  const uid = ctx.limitToUserId;
  if (!uid) return rows;
  const linked = rows.filter((r) => r.created_by !== uid && r.task_id).map((r) => r.task_id as string);
  const assigned = linked.length > 0 ? await assignedTaskIds(ctx, linked) : new Set<string>();
  return rows.filter((r) => r.created_by === uid || (r.task_id !== null && assigned.has(r.task_id)));
}

async function loadItems(ctx: AdapterCtx, keys?: string[]): Promise<ItemRow[]> {
  const shared = includeShared(ctx);
  const page = (ids?: string[]) => (from: number, to: number) => {
    let q = ctx.admin.from("app_content_studio_items").select(SELECT).eq("team_id", ctx.teamId);
    q = scoped(q, ctx, shared);
    if (ids) q = q.in("id", ids);
    return q
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .range(from, to) as never;
  };
  let rows: ItemRow[];
  try {
    if (!keys) rows = await fetchAll<ItemRow>(page());
    else {
      rows = [];
      for (const part of chunks(keys)) rows.push(...(await fetchAll<ItemRow>(page(part))));
    }
  } catch (err) {
    if (isMissingTable(err as { code?: string; message?: string })) {
      ctx.out.notices.push("Content Studio's tables are not set up in this database yet.");
      return [];
    }
    throw err;
  }
  // Outside the catch: a failure to read tasks_assignees is not "Content
  // Studio isn't installed", and a filter that quietly returned everything
  // would be the bug this exists to fix.
  return keepOwn(ctx, rows);
}

/** Loads one item of THIS sheet's scope, or throws "not found" — every write
 *  starts here. A limited member gets the same 404 on an item that is not
 *  theirs as on one that does not exist, so keys can't be probed. */
async function ownItem(
  ctx: AdapterCtx,
  key: string,
): Promise<{ id: string; status: string; published_at: string | null }> {
  let q = ctx.admin
    .from("app_content_studio_items")
    .select("id, status, published_at, task_id, created_by")
    .eq("id", key)
    .eq("team_id", ctx.teamId);
  q = scoped(q, ctx, includeShared(ctx));
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  const missing = () => new AdapterError("That item no longer exists in this sheet's scope.", 404);
  if (!data) throw missing();
  const row = data as Ownable & { status: string; published_at: string | null };
  if ((await keepOwn(ctx, [row])).length === 0) throw missing();
  return row;
}

/** Destinations / campaigns must belong to the team and be workspace-wide or
 *  this project's — the same rule Content Studio's pickers apply. */
async function checkInScope(ctx: AdapterCtx, table: string, ids: string[], what: string): Promise<void> {
  if (ids.length === 0) return;
  let q = ctx.admin.from(table).select("id").eq("team_id", ctx.teamId).in("id", ids);
  q = ctx.projectId ? q.or(`project_id.is.null,project_id.eq.${ctx.projectId}`) : q.is("project_id", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const ok = new Set((data ?? []).map((r: { id: string }) => r.id));
  if (ids.some((id) => !ok.has(id))) throw new AdapterError(`That ${what} is not available in this sheet.`);
}

/** Nothing was entered: null, undefined, whitespace, or an empty pick list.
 *  false and 0 are real answers (an unticked box, zero clicks) and stay. */
function isBlankInput(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return Array.isArray(v) && v.length === 0;
}

function metric(raw: unknown, label: string): number {
  const n = normalize("number", raw) as number | null;
  if (n === null) return 0;
  if (n < 0 || !Number.isInteger(n) || n > 2_147_483_647) throw new AdapterError(`${label} must be a whole number of 0 or more.`);
  return n;
}

async function toColumns(ctx: AdapterCtx, patch: Record<string, unknown>, current: { status: string; published_at: string | null } | null) {
  const cols: Record<string, unknown> = {};
  let destinations: string[] | null = null;
  for (const [field, raw] of Object.entries(patch)) {
    switch (field) {
      case "title": {
        const v = (normalize("text", raw) as string | null) ?? "";
        if (!v) throw new AdapterError("A title is required.");
        if (v.length > 200) throw new AdapterError("Titles are at most 200 characters.");
        cols.title = v;
        break;
      }
      case "body": {
        const v = (normalize("long_text", raw) as string | null) ?? "";
        if (!v) throw new AdapterError("The body / caption can't be empty.");
        if (v.length > 12000) throw new AdapterError("The body is at most 12,000 characters.");
        cols.body = v;
        break;
      }
      case "content_type": {
        const v = normalize("select", raw) as string | null;
        if (!v || !TYPES.has(v)) throw new AdapterError("Unknown content type.");
        cols.content_type = v;
        break;
      }
      case "status": {
        const v = normalize("select", raw) as string | null;
        if (!v || !STATUSES.has(v)) throw new AdapterError("Unknown status.");
        cols.status = v;
        break;
      }
      case "scheduled_for": {
        const v = normalize("datetime", raw) as string | null;
        if (raw !== null && raw !== undefined && raw !== "" && !v) throw new AdapterError("Expected a date and time.");
        cols.scheduled_for = v;
        break;
      }
      case "campaign": {
        const v = normalize("select", raw) as string | null;
        if (v) await checkInScope(ctx, "app_content_studio_campaigns", [v], "campaign");
        cols.campaign_id = v;
        break;
      }
      case "destinations": {
        destinations = normalize("multi_select", raw) as string[];
        await checkInScope(ctx, "app_content_studio_destinations", destinations, "destination");
        break;
      }
      case "target_url": {
        const v = normalize("url", raw) as string | null;
        if (v && v.length > 2000) throw new AdapterError("Links are at most 2,000 characters.");
        cols.target_url = v;
        break;
      }
      case "approval_required":
        cols.approval_required = normalize("checkbox", raw) === true;
        break;
      case "impressions":
        cols.impressions = metric(raw, "Impressions");
        break;
      case "engagements":
        cols.engagements = metric(raw, "Engagements");
        break;
      case "clicks":
        cols.clicks = metric(raw, "Clicks");
        break;
      default:
        throw new AdapterError(`“${field}” cannot be changed from a sheet.`);
    }
  }
  // The Content Studio screens' rule: publishing stamps published_at (the
  // schedule, else now); going back to draft clears it.
  if (typeof cols.status === "string" && cols.status !== current?.status) {
    if (cols.status === "published" && !current?.published_at) {
      cols.published_at = (cols.scheduled_for as string | null | undefined) ?? new Date().toISOString();
    } else if (cols.status === "draft") {
      cols.published_at = null;
    }
  }
  return { cols, destinations };
}

async function setDestinations(ctx: AdapterCtx, itemId: string, wanted: string[]): Promise<boolean> {
  const { data: current, error } = await ctx.admin
    .from("app_content_studio_item_destinations")
    .select("destination_id")
    .eq("item_id", itemId);
  if (error) throw new Error(error.message);
  const have = new Set((current ?? []).map((r: { destination_id: string }) => r.destination_id));
  const want = new Set(wanted);
  const add = wanted.filter((id) => !have.has(id));
  const drop = [...have].filter((id) => !want.has(id));
  if (add.length > 0) {
    const { error: e } = await ctx.admin.from("app_content_studio_item_destinations").insert(
      add.map((id) => ({ item_id: itemId, destination_id: id, sort_order: wanted.indexOf(id) })),
    );
    if (e) throw new Error(e.message);
  }
  if (drop.length > 0) {
    const { error: e } = await ctx.admin
      .from("app_content_studio_item_destinations")
      .delete()
      .eq("item_id", itemId)
      .in("destination_id", drop);
    if (e) throw new Error(e.message);
  }
  return add.length > 0 || drop.length > 0;
}

export const contentStudioAdapter: SheetAdapter = {
  async list(ctx: AdapterCtx, opts?: ListOptions) {
    // Query order (by schedule, then last edit) is the row order.
    return (await loadItems(ctx, opts?.keys)).map((r, i) => ({ ...toRecord(r), position: i }));
  },

  async update(ctx, key, patch) {
    const item = await ownItem(ctx, key);
    const { cols, destinations } = await toColumns(ctx, patch, item);
    const linksChanged = destinations ? await setDestinations(ctx, item.id, destinations) : false;
    // Destination links have no updated_at of their own; touch the item so
    // "newest wins" sees the change.
    if (Object.keys(cols).length > 0 || linksChanged) {
      const { error } = await ctx.admin
        .from("app_content_studio_items")
        .update(Object.keys(cols).length > 0 ? cols : { updated_at: new Date().toISOString() })
        .eq("id", item.id)
        .eq("team_id", ctx.teamId);
      if (error) throw new AdapterError(error.message);
    }
  },

  async create(ctx, values) {
    const title = normalize("text", values.title);
    const body = normalize("long_text", values.body);
    // A caption IS required, drafts included — deliberately, to match Content
    // Studio rather than loosen it from a sheet: the table's CHECK is
    // char_length(body) BETWEEN 1 AND 12000 for every status, and Content
    // Studio's own "Create content" dialog fails the same way on an empty
    // body. Inventing a placeholder would put text nobody wrote into a post
    // (and back into the Google row). What was wrong was the SILENCE: a
    // calendar row typed as just a date and a title got no Cubes ID and no
    // reason. The sync now writes this refusal onto that row in Google
    // (row-notes.ts) and adds the row once the caption is filled in. Through
    // the data layer the message comes from createRecord's required-field
    // check, named as the sheet's own column; this one is for direct callers.
    if (!title) throw new AdapterError("A title is required to create an item.");
    if (!body) throw new AdapterError("A body / caption is required to create an item — Content Studio keeps none without one, drafts included.");
    // Blanks are dropped BEFORE the defaults go under them. Every create path
    // passes one value per column, blank or not: a row typed into Google with
    // Publish status and Content type left empty arrives as null for both, as
    // does the grid's "add row". Spread last, those nulls replaced
    // draft / social_post, were refused as unknown, and the sync skipped the
    // row — no Content Studio item, no Cubes ID. On a record that does not
    // exist yet, a blank means "not chosen", never "clear it".
    //
    // update() is deliberately unchanged: there a blank IS someone clearing a
    // value. Clearing Publish status on a scheduled post stays refused and the
    // post stays scheduled; reading it as "draft" would unschedule it.
    const given = Object.fromEntries(Object.entries(values).filter(([, v]) => !isBlankInput(v)));
    const { cols, destinations } = await toColumns(
      ctx,
      { content_type: "social_post", status: "draft", ...given },
      null,
    );
    const { data, error } = await ctx.admin
      .from("app_content_studio_items")
      .insert({ ...cols, team_id: ctx.teamId, project_id: ctx.projectId, created_by: ctx.actorUserId })
      .select("id")
      .single();
    if (error) throw new AdapterError(error.message);
    const id = (data as { id: string }).id;
    if (destinations && destinations.length > 0) await setDestinations(ctx, id, destinations);
    return id;
  },
};
