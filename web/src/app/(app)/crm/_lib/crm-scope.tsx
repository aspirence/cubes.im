"use client";

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { App, Button, Spin } from "antd";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useProjects } from "@/features/projects/use-projects";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { NO_PROJECT, useCrmPrefsStore } from "./crm-prefs-store";

/**
 * The CRM's "current project".
 *
 * The CRM is worked per project: deals, people and companies carry a
 * project_id (migration 20261150000000), and every CRM tab shows ONE project —
 * the one last chosen (per workspace), else the first project A–Z, which is
 * then saved so it stays put. There is no "all projects" view. The one other
 * choice is "No project": the records filed under no project yet, and the
 * tasks, notes and reminders that point at nothing or only at such records.
 *
 * The bar above the tabs (_components/crm-scope-bar.tsx) switches it; each page
 * narrows its own lists with `inScope(record.project_id)` (deals, people,
 * companies) or `targetInScope` / `targetsInScope` (tasks, notes, reminders,
 * activity — resolved through the deal, person or company they point at). The
 * data hooks in src/features/app-crm are untouched: caches stay team-wide and
 * a scope flip is a re-render over warm data, never a refetch.
 *
 * Inside a project's CRM view the provider is pinned (`fixedProjectId`):
 * `fixed` is true, nothing is read from or written to the saved choice, and
 * nothing offers "Switch".
 *
 * The scope is a DEFAULT, never a constraint: create forms file the new record
 * under the current project, the record's Project field stays editable, and a
 * record that ends up elsewhere is announced (useScopeMismatchNotice), never
 * blocked. Deep links (?m=<id>) open regardless of scope and never change it.
 *
 * Until the projects list has answered, nothing is rendered under the provider
 * (showing everything for a frame is exactly the "all" view that does not
 * exist). With no projects at all the CRM is unscoped (`inScope` is always
 * true), the only unscoped state.
 *
 * Drift rule: every list a CRM page renders must pass through inScope /
 * targetInScope / targetsInScope. The bare consumers that MUST stay team-wide:
 * record-drawer.tsx (the record lookup), target-picker.tsx (the relations
 * picker), paste-deal.tsx (matching a pasted lead), campaigns/page.tsx (spend
 * has no project dimension) and settings/page.tsx (delete confirmations count
 * every deal).
 */

export { NO_PROJECT };

export interface CrmScopeProject {
  id: string;
  name: string;
  color: string | null;
}

const NO_PROJECT_ENTRY: CrmScopeProject = { id: NO_PROJECT, name: "No project", color: null };

export interface CrmScope {
  teamId: string | null;
  /** The switcher's EFFECTIVE value: a project id, NO_PROJECT, or null (no projects). Use for keys and the Select. */
  selection: string | null;
  /** The real project's id — null under "No project" and when unscoped. What a new record is filed under. */
  projectId: string | null;
  /** The current project (or the "No project" entry), for titles. */
  project: CrmScopeProject | null;
  isScoped: boolean;
  /** True when looking at the records filed under no project. */
  isNoProject: boolean;
  /** True inside a project's CRM view: pinned, nothing persisted, nothing switches. */
  fixed: boolean;
  /** The team's live projects, A–Z. */
  projects: CrmScopeProject[];
  /** Recently picked projects, newest first, live only. */
  recentIds: string[];
  /** A project id, or NO_PROJECT. */
  setProjectId: (id: string) => void;
  /** True when a record with this project_id belongs in the current view. */
  inScope: (projectId: string | null | undefined) => boolean;
}

const UNSCOPED: CrmScope = {
  teamId: null,
  selection: null,
  projectId: null,
  project: null,
  isScoped: false,
  isNoProject: false,
  fixed: false,
  projects: [],
  recentIds: [],
  setProjectId: () => undefined,
  inScope: () => true,
};

// Outside the provider (a drawer mounted somewhere else) everything is unscoped.
const CrmScopeContext = createContext<CrmScope>(UNSCOPED);

export function CrmScopeProvider({
  children,
  fixedProjectId,
}: {
  children: ReactNode;
  /** Pin the scope to this project (a project's CRM view). */
  fixedProjectId?: string;
}) {
  const { message } = App.useApp();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id ?? null;
  const fixed = Boolean(fixedProjectId);
  const raw = useCrmPrefsStore((s) => (teamId ? (s.scopeByTeam[teamId] ?? null) : null));
  const recentRaw = useCrmPrefsStore((s) => (teamId ? s.recentByTeam[teamId] : undefined));
  const setScope = useCrmPrefsStore((s) => s.setScope);
  const { data: projectRows, isError: projectsError, isFetching: projectsFetching } = useProjects();
  const projectsReady = projectRows !== undefined;

  const live = useMemo<CrmScopeProject[]>(
    () =>
      (projectRows ?? [])
        .filter((p) => !p.is_archived)
        .map((p) => ({ id: p.id, name: p.name, color: p.color_code ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [projectRows],
  );
  const saved = useMemo<CrmScopeProject | null>(() => {
    if (fixedProjectId) {
      // A pinned project may be archived or outside the live list; the page
      // that pinned it already knows it exists, so it is shown regardless.
      const row = (projectRows ?? []).find((p) => p.id === fixedProjectId);
      return row
        ? { id: row.id, name: row.name, color: row.color_code ?? null }
        : { id: fixedProjectId, name: "this project", color: null };
    }
    if (!raw) return null;
    if (raw === NO_PROJECT) return NO_PROJECT_ENTRY;
    return live.find((p) => p.id === raw) ?? null;
  }, [fixedProjectId, projectRows, raw, live]);
  // Nothing saved yet: open where the work is — the project with the most
  // live deals ("No project" included, which is where every deal starts
  // before anyone files it), ties to the first A–Z. Opening on an empty
  // project while the whole pipeline sits unfiled reads as "the CRM lost my
  // deals".
  const { data: dealRows } = useCrmDeals();
  const dealsReady = dealRows !== undefined;
  const busiest = useMemo<CrmScopeProject | null>(() => {
    if (live.length === 0) return null;
    const counts = new Map<string, number>();
    for (const d of dealRows ?? []) {
      if (d.deleted_at) continue;
      const key = d.project_id ?? NO_PROJECT;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best: CrmScopeProject = live[0];
    let bestCount = counts.get(live[0].id) ?? 0;
    for (const p of live) {
      const n = counts.get(p.id) ?? 0;
      if (n > bestCount) {
        best = p;
        bestCount = n;
      }
    }
    return (counts.get(NO_PROJECT) ?? 0) > bestCount ? NO_PROJECT_ENTRY : best;
  }, [live, dealRows]);
  const project = useMemo<CrmScopeProject | null>(
    () => (fixed ? saved : (saved ?? busiest)),
    [fixed, saved, busiest],
  );
  const selection = project?.id ?? null;
  const isNoProject = selection === NO_PROJECT;
  const projectId = isNoProject ? null : selection;
  const recentIds = useMemo(
    () => (recentRaw ?? []).filter((id) => live.some((p) => p.id === id)),
    [recentRaw, live],
  );

  // Self-heal. Nothing saved yet: save the default so it stays put. Saved
  // project gone (archived, deleted, no longer visible, another workspace's
  // id): move to the first live one and say so once. Not while the list is
  // refetching — a project created a moment ago is "gone" only until then.
  useEffect(() => {
    if (fixed || !teamId || !projectsReady || projectsFetching) return;
    if (raw && raw !== NO_PROJECT && !saved && live.length === 0) {
      setScope(teamId, null);
      return;
    }
    if (!project || saved) return;
    // The first default is only worth saving once the deals have answered.
    if (!raw && !dealsReady) return;
    if (raw) {
      message.open({
        key: "crm-scope-heal",
        type: "info",
        content: `That project is no longer available — showing ${project.name}.`,
      });
    }
    setScope(teamId, project.id);
  }, [fixed, teamId, projectsReady, projectsFetching, dealsReady, raw, saved, project, live.length, setScope, message]);

  const value = useMemo<CrmScope>(
    () => ({
      teamId,
      selection,
      projectId,
      project,
      isScoped: project !== null,
      isNoProject,
      fixed,
      projects: live,
      recentIds,
      setProjectId: (id) => {
        if (!fixed && teamId && id) setScope(teamId, id);
      },
      inScope: (id) => {
        if (project === null) return true;
        if (isNoProject) return id === null || id === undefined;
        return id === projectId;
      },
    }),
    [teamId, selection, projectId, project, isNoProject, fixed, live, recentIds, setScope],
  );

  // No answer yet: no page. (An error answers "unscoped" — better a full CRM
  // than a spinner forever.)
  if (!projectsReady && !projectsError) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: fixed ? 240 : "calc(100vh - 160px)" }}>
        <Spin size="large" />
      </div>
    );
  }

  return <CrmScopeContext.Provider value={value}>{children}</CrmScopeContext.Provider>;
}

export function useCrmScope(): CrmScope {
  return useContext(CrmScopeContext);
}

/** The shape of app_crm_task_targets / app_crm_note_targets rows, reminders and activities. */
export interface CrmTargetLike {
  target_type: string;
  target_id: string;
}

/**
 * Resolves polymorphic targets to a project: a deal, person or company target
 * is in that record's project (soft-deleted records still resolve, so a task
 * on a deleted deal stays in its project). Under "No project", a record with
 * no project matches, and a task or note with no targets at all belongs there
 * too. A separate hook from useCrmScope so pages that only need `inScope`
 * never subscribe to the three caches for it.
 *
 * `ready` is false while scoped and a cache has neither answered nor failed;
 * treat it as loading. `error` is for the page's own error state.
 */
export function useCrmScopeResolver() {
  const { isScoped, isNoProject, projectId } = useCrmScope();
  const { data: people, isError: peopleError } = useCrmPeople();
  const { data: deals, isError: dealsError } = useCrmDeals();
  const { data: companies, isError: companiesError } = useCrmCompanies();
  const peopleProject = useMemo(
    () => new Map((people ?? []).map((p) => [p.id, p.project_id ?? null] as const)),
    [people],
  );
  const dealsProject = useMemo(
    () => new Map((deals ?? []).map((d) => [d.id, d.project_id ?? null] as const)),
    [deals],
  );
  const companiesProject = useMemo(
    () => new Map((companies ?? []).map((c) => [c.id, c.project_id ?? null] as const)),
    [companies],
  );
  const settled =
    (people !== undefined || peopleError) &&
    (deals !== undefined || dealsError) &&
    (companies !== undefined || companiesError);

  return useMemo(() => {
    const ready = !isScoped || Boolean(settled);
    const matches = (resolved: string | null | undefined): boolean => {
      // `undefined` = the record is unknown (gone, or not loaded): in no view.
      if (resolved === undefined) return false;
      return isNoProject ? resolved === null : resolved === projectId;
    };
    const targetInScope = (t: CrmTargetLike): boolean => {
      if (!isScoped) return true;
      if (t.target_type === "company") return matches(companiesProject.get(t.target_id));
      if (t.target_type === "person") return matches(peopleProject.get(t.target_id));
      if (t.target_type === "deal") return matches(dealsProject.get(t.target_id));
      return false;
    };
    const targetsInScope = (ts: CrmTargetLike[] | null | undefined): boolean => {
      if (!isScoped) return true;
      const list = ts ?? [];
      if (list.length === 0) return isNoProject;
      return list.some(targetInScope);
    };
    return { ready, error: peopleError || dealsError || companiesError, targetInScope, targetsInScope };
  }, [isScoped, isNoProject, projectId, peopleProject, dealsProject, companiesProject, settled, peopleError, dealsError, companiesError]);
}

/** Runs `reset` whenever the switcher's value changes — bulk selections must not survive a scope flip. */
export function useResetOnScopeChange(reset: () => void) {
  const { selection } = useCrmScope();
  const ref = useRef(reset);
  useEffect(() => {
    ref.current = reset;
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current();
  }, [selection]);
}

/**
 * After a create or an edit: the record went to a project other than the
 * current one (or to none), so it will not appear in this view. Says so, with
 * a way to go and look (not inside a pinned project view). A no-op when
 * unscoped or when the record is in scope. Reads the scope at call time.
 */
export function useScopeMismatchNotice() {
  const { message } = App.useApp();
  const scope = useCrmScope();
  const latest = useRef(scope);
  useEffect(() => {
    latest.current = scope;
  });
  return (input: {
    recordProjectId: string | null | undefined;
    noun: string;
    /** "created in" (default) or "moved to". */
    verb?: string;
  }) => {
    const s = latest.current;
    if (!s.isScoped || !s.project) return;
    const recordProjectId = input.recordProjectId ?? null;
    if (s.inScope(recordProjectId)) return;
    const other = recordProjectId
      ? (s.projects.find((p) => p.id === recordProjectId)?.name ?? "another project")
      : "no project";
    const target = recordProjectId ?? NO_PROJECT;
    message.open({
      key: "crm-scope-mismatch",
      type: "info",
      duration: 6,
      content: s.fixed ? (
        <span>
          {input.noun} {input.verb ?? "created in"} {other} — it is in the CRM, not in this project&apos;s view.
        </span>
      ) : (
        <span>
          {input.noun} {input.verb ?? "created in"} {other} — not shown under {s.project.name}.{" "}
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: "auto" }}
            onClick={() => latest.current.setProjectId(target)}
          >
            Switch
          </Button>
        </span>
      ),
    });
  };
}
