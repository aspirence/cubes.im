"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useCrmDeals } from "./use-crm-deals";
import { useCrmCompanies } from "./use-crm-companies";
import { useCrmStages } from "./use-crm-stages";
import { useCrmCampaigns } from "./use-crm-campaigns";
import { useCrmLabels } from "./use-crm-labels";
import { CRM_LABEL_COLORS, type CrmLeadStatus } from "./types";
import { normalizeSource, type LeadDraft } from "@/app/(app)/crm/_lib/lead-import";

/**
 * Lead import — the writing half. Takes the drafts the dialog built (see
 * crm/_lib/lead-import.ts) and writes them in batches:
 *
 *   tags that don't exist yet (optional) → companies → contacts → deals →
 *   deal tags → notes (with their deal link)
 *
 * Ids are generated here, so every row is linked without relying on the order
 * PostgREST returns inserts in, and so a finished (or half-finished) import can
 * be undone exactly: `undo(result)` deletes what this run created and nothing
 * else. Every deal carries `source_ref.import_id`, the file name, its row and
 * the import time, so an import can always be traced and reopened as a batch
 * (/crm/deals?import=<id>). `source` is the lead's channel — the file's Source
 * column, else the import's default, else "import".
 *
 * Duplicates are decided by the caller: each row says whether to link an
 * existing contact (`personId`) or reuse the contact created for an earlier row
 * of the same file (`sameAsRow`).
 */

export interface LeadImportRow {
  draft: LeadDraft;
  /** An existing contact (same project) to link instead of creating one. */
  personId: string | null;
  /** Reuse the contact created for this earlier row (same email/phone in the file). */
  sameAsRow: number | null;
}

export interface LeadImportPlan {
  projectId: string | null;
  fileName: string | null;
  rows: LeadImportRow[];
  defaults: {
    stageId: string | null;
    status: CrmLeadStatus;
    ownerId: string | null;
    campaignId: string | null;
    /** Tags every imported lead gets. */
    labelIds: string[];
    /** The channel for rows without a Source column value ("Facebook", "IndiaMART"…). */
    source: string | null;
  };
  createContacts: boolean;
  createCompanies: boolean;
  /** Create tags named in a Tags column that the CRM doesn't have yet. */
  createMissingTags: boolean;
  /**
   * Date each lead by the file's Lead date column (created_at), so reports and
   * "new leads today" count it on the day it came in, not the day of the import.
   */
  useLeadDates: boolean;
}

export interface LeadImportResult {
  importId: string;
  deals: string[];
  people: string[];
  companies: string[];
  notes: string[];
  labels: string[];
  /** Set when a batch failed; what was written before it stays (and can be undone). */
  error: string | null;
}

export type LeadImportProgress = { done: number; total: number; step: string };

const CHUNK = 200;

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function errText(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

export function useLeadImport() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  const { data: members } = useTeamMembers();
  const { data: deals } = useCrmDeals();
  const { data: companies } = useCrmCompanies();
  const { data: stages } = useCrmStages();
  const { data: campaigns } = useCrmCampaigns();
  const { data: labels } = useCrmLabels();
  const [running, setRunning] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("crm-") && q.queryKey[1] === teamId,
    });

  /** Resolves a draft's text references (stage, campaign, owner, tags) against the CRM. */
  const lookups = () => {
    const stageByName = new Map((stages ?? []).map((s) => [key(s.name), s.id]));
    const campaignByName = new Map((campaigns ?? []).filter((c) => !c.deleted_at).map((c) => [key(c.name), c.id]));
    const ownerBy = new Map<string, string>();
    for (const m of members ?? []) {
      if (!m.user) continue;
      ownerBy.set(key(m.user.name), m.user.id);
      const email = (m.user as { email?: string | null }).email;
      if (email) ownerBy.set(key(email), m.user.id);
    }
    const labelByName = new Map((labels ?? []).map((l) => [key(l.name), l.id]));
    return { stageByName, campaignByName, ownerBy, labelByName };
  };

  const run = async (plan: LeadImportPlan, onProgress?: (p: LeadImportProgress) => void): Promise<LeadImportResult> => {
    if (!teamId) throw new Error("No active workspace");
    const importId = crypto.randomUUID();
    const result: LeadImportResult = { importId, deals: [], people: [], companies: [], notes: [], labels: [], error: null };
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const createdBy = user?.id ?? null;
    const rows = plan.rows.filter((r) => !r.draft.error);
    const total = rows.length;
    const report = (done: number, step: string) => onProgress?.({ done, total, step });
    setRunning(true);
    try {
      const { stageByName, campaignByName, ownerBy, labelByName } = lookups();

      // 1. Tags named in the file that don't exist yet.
      if (plan.createMissingTags) {
        const missing = Array.from(
          new Map(
            rows.flatMap((r) => r.draft.tags).filter((t) => !labelByName.has(key(t))).map((t) => [key(t), t.trim()] as const),
          ).values(),
        );
        if (missing.length) {
          report(0, "Creating tags");
          const base = Math.max(0, ...(labels ?? []).map((l) => l.position));
          const inserts = missing.map((name, i) => ({
            id: crypto.randomUUID(),
            team_id: teamId,
            name: name.slice(0, 60),
            color: CRM_LABEL_COLORS[i % CRM_LABEL_COLORS.length],
            position: base + i + 1,
            created_by: createdBy,
          }));
          for (const part of chunks(inserts)) {
            const { error } = await supabase.from("app_crm_labels").insert(part);
            if (error) throw error;
            result.labels.push(...part.map((l) => l.id));
            part.forEach((l) => labelByName.set(key(l.name), l.id));
          }
        }
      }

      // 2. Companies: one per distinct name, reusing a live company of the same
      //    name in the project.
      const companyId = new Map<string, string>();
      for (const c of companies ?? []) {
        if (!c.deleted_at && (c.project_id ?? null) === plan.projectId) companyId.set(key(c.name), c.id);
      }
      if (plan.createCompanies) {
        const toCreate = new Map<string, { name: string; domain: string | null }>();
        for (const r of rows) {
          const name = r.draft.company;
          if (name && !companyId.has(key(name)) && !toCreate.has(key(name))) toCreate.set(key(name), { name, domain: r.draft.website });
        }
        if (toCreate.size) {
          report(0, "Creating companies");
          const inserts = Array.from(toCreate.entries()).map(([k, c]) => ({
            k,
            row: { id: crypto.randomUUID(), team_id: teamId, name: c.name, domain: c.domain, project_id: plan.projectId, created_by: createdBy },
          }));
          for (const part of chunks(inserts)) {
            const { error } = await supabase.from("app_crm_companies").insert(part.map((p) => p.row));
            if (error) throw error;
            part.forEach((p) => {
              companyId.set(p.k, p.row.id);
              result.companies.push(p.row.id);
            });
          }
        }
      }
      const companyFor = (d: LeadDraft) => (d.company ? (companyId.get(key(d.company)) ?? null) : null);

      // 3. Contacts.
      const personForRow = new Map<number, string | null>();
      const newPeople: { id: string; team_id: string; first_name: string; last_name: string; email: string | null; phone: string | null; job_title: string | null; city: string | null; linkedin_url: string | null; company_id: string | null; project_id: string | null; created_by: string | null }[] = [];
      for (const r of rows) {
        const d = r.draft;
        if (r.personId) {
          personForRow.set(d.row, r.personId);
          continue;
        }
        if (r.sameAsRow !== null && personForRow.has(r.sameAsRow)) {
          personForRow.set(d.row, personForRow.get(r.sameAsRow) ?? null);
          continue;
        }
        const hasPerson = Boolean(d.firstName || d.lastName || d.email || d.phone);
        if (!plan.createContacts || !hasPerson) {
          personForRow.set(d.row, null);
          continue;
        }
        const first = d.firstName || (d.email ? d.email.split("@")[0] : "") || d.phone || "Lead";
        const id = crypto.randomUUID();
        newPeople.push({
          id,
          team_id: teamId,
          first_name: first.slice(0, 150),
          last_name: d.lastName,
          email: d.email,
          phone: d.phone,
          job_title: d.jobTitle,
          city: d.city,
          linkedin_url: d.linkedin,
          company_id: companyFor(d),
          project_id: plan.projectId,
          created_by: createdBy,
        });
        personForRow.set(d.row, id);
      }
      if (newPeople.length) {
        report(0, "Creating contacts");
        for (const part of chunks(newPeople)) {
          const { error } = await supabase.from("app_crm_people").insert(part);
          if (error) throw error;
          result.people.push(...part.map((p) => p.id));
        }
      }

      // 4. Deals, placed at the bottom of their stage in file order.
      const nextPosition = new Map<string, number>();
      const positionIn = (stageId: string | null) => {
        const k = stageId ?? "";
        if (!nextPosition.has(k)) {
          const inStage = (deals ?? []).filter((x) => !x.deleted_at && (x.stage_id ?? "") === k).map((x) => x.position);
          nextPosition.set(k, Math.max(0, ...inStage) + 1);
        }
        const p = nextPosition.get(k)!;
        nextPosition.set(k, p + 1);
        return p;
      };

      const importedAt = new Date().toISOString();
      const defaultSource = plan.defaults.source?.trim() ? normalizeSource(plan.defaults.source) : null;
      const dealRows = rows.map((r) => {
        const d = r.draft;
        const stageId = (d.stageName && stageByName.get(key(d.stageName))) || plan.defaults.stageId;
        const campaignId = (d.campaignName && campaignByName.get(key(d.campaignName))) || plan.defaults.campaignId;
        const ownerId = (d.ownerRaw && ownerBy.get(key(d.ownerRaw))) || plan.defaults.ownerId;
        const sourceRef: Record<string, string | number> = { import_id: importId, row: d.row, imported_at: importedAt };
        if (plan.fileName) sourceRef.file = plan.fileName.slice(0, 200);
        if (d.source) sourceRef.origin = d.source.slice(0, 120);
        if (d.campaignName && !campaignByName.has(key(d.campaignName))) sourceRef.campaign_name = d.campaignName.slice(0, 200);
        if (d.leadDate) sourceRef.lead_date = d.leadDate;
        if (d.ownerRaw && !ownerBy.has(key(d.ownerRaw))) sourceRef.owner = d.ownerRaw.slice(0, 120);
        return {
          draft: d,
          insert: {
            id: crypto.randomUUID(),
            team_id: teamId,
            name: d.dealName,
            stage_id: stageId,
            status: d.status ?? plan.defaults.status,
            campaign_id: campaignId,
            close_date: d.closeDate,
            owner_id: ownerId,
            phone: d.phone ? d.phone.slice(0, 40) : null,
            company_id: companyFor(d),
            contact_id: personForRow.get(d.row) ?? null,
            project_id: plan.projectId,
            position: positionIn(stageId),
            source: (d.source ? normalizeSource(d.source) : defaultSource) || "import",
            source_ref: sourceRef,
            created_by: createdBy,
            // Set on every row or on none: a bulk insert fills a key some rows
            // lack with NULL (not the column default), and created_at is NOT
            // NULL. Rows whose date couldn't be read take the import time.
            ...(plan.useLeadDates ? { created_at: d.leadAt ?? importedAt } : {}),
          },
        };
      });

      let done = 0;
      for (const part of chunks(dealRows)) {
        report(done, "Importing leads");
        const { error } = await supabase.from("app_crm_deals").insert(part.map((p) => p.insert));
        if (error) throw error;
        result.deals.push(...part.map((p) => p.insert.id));
        done += part.length;
        report(done, "Importing leads");
      }

      // 5. Tags on the deals: the defaults for every lead, plus the file's own.
      const dealLabels: { team_id: string; deal_id: string; label_id: string; created_by: string | null }[] = [];
      for (const { draft, insert } of dealRows) {
        const ids = new Set(plan.defaults.labelIds);
        for (const t of draft.tags) {
          const id = labelByName.get(key(t));
          if (id) ids.add(id);
        }
        ids.forEach((label_id) => dealLabels.push({ team_id: teamId, deal_id: insert.id, label_id, created_by: createdBy }));
      }
      if (dealLabels.length) {
        report(done, "Tagging leads");
        for (const part of chunks(dealLabels)) {
          const { error } = await supabase.from("app_crm_deal_labels").insert(part);
          if (error) throw error;
        }
      }

      // 6. Notes (mapped note columns and, if chosen, the unmapped answers).
      const notes = dealRows
        .filter(({ draft }) => draft.note)
        .map(({ draft, insert }) => ({
          note: {
            id: crypto.randomUUID(),
            team_id: teamId,
            title: `Imported with the lead${plan.fileName ? ` · ${plan.fileName}` : ""}`.slice(0, 200),
            body: draft.note,
            created_by: createdBy,
          },
          dealId: insert.id,
        }));
      if (notes.length) {
        report(done, "Adding notes");
        for (const part of chunks(notes)) {
          const { error } = await supabase.from("app_crm_notes").insert(part.map((p) => p.note));
          if (error) throw error;
          result.notes.push(...part.map((p) => p.note.id));
          const { error: tErr } = await supabase
            .from("app_crm_note_targets")
            .insert(part.map((p) => ({ team_id: teamId, note_id: p.note.id, target_type: "deal", target_id: p.dealId })));
          if (tErr) throw tErr;
        }
      }
      report(total, "Done");
    } catch (err) {
      result.error = errText(err);
    } finally {
      setRunning(false);
      await refresh();
    }
    return result;
  };

  /** Deletes exactly what `result` created (deals first, so nothing is left pointing at a removed contact). */
  const undo = async (result: LeadImportResult) => {
    setRunning(true);
    try {
      for (const part of chunks(result.notes)) {
        const { error } = await supabase.from("app_crm_notes").delete().in("id", part);
        if (error) throw error;
      }
      for (const part of chunks(result.deals)) {
        const { error } = await supabase.from("app_crm_deals").delete().in("id", part);
        if (error) throw error;
      }
      for (const part of chunks(result.people)) {
        const { error } = await supabase.from("app_crm_people").delete().in("id", part);
        if (error) throw error;
      }
      for (const part of chunks(result.companies)) {
        const { error } = await supabase.from("app_crm_companies").delete().in("id", part);
        if (error) throw error;
      }
      for (const part of chunks(result.labels)) {
        const { error } = await supabase.from("app_crm_labels").delete().in("id", part);
        if (error) throw error;
      }
    } finally {
      setRunning(false);
      await refresh();
    }
  };

  return { run, undo, running };
}
