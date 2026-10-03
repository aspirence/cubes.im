"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Grid, Select, Space, Typography, theme } from "antd";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { MIcon } from "./m-icon";
import { EmptyState, SoftChip, crmPageStyle } from "../_lib/ui";
import { NO_PROJECT, useCrmScope } from "../_lib/crm-scope";

/**
 * The project switcher above every CRM tab (mounted once by crm/layout.tsx).
 *
 * The CRM is worked per project: pick a project here and the dashboard,
 * deals, people, companies, tasks, notes, reminders and reports show its
 * records. There is no "all projects" view — the CRM always looks at one
 * project, remembered per workspace — plus "No project" for the records not
 * filed anywhere yet. Campaigns and Settings are workspace-wide and the bar
 * says so on those routes.
 *
 * Reads zustand + react-query only (usePathname, never useSearchParams), so
 * the layout keeps rendering its children synchronously.
 */

interface ScopeOption {
  /** rc-select keys by `key` before `value`; the Recent group repeats ids, so it gets its own keys. */
  key: string;
  value: string;
  label: string;
  color: string | null;
  deals: number;
}

/** The routes that stay workspace-wide, and why, in one line each. */
const HINTS: { prefix: string; hint: string }[] = [
  { prefix: "/crm/campaigns", hint: "Campaigns are workspace-wide: every project's leads and spend." },
  { prefix: "/crm/settings", hint: "Settings apply to every project." },
];

export function CrmScopeBar() {
  const { token } = theme.useToken();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const scope = useCrmScope();
  const [open, setOpen] = useState(false);
  // Free on every CRM route: each page (or the record drawer it mounts)
  // already holds the deals cache, so the counts never add a request.
  const { data: deals } = useCrmDeals();

  const { dealCount, unfiledDeals } = useMemo(() => {
    const m = new Map<string, number>();
    let unfiled = 0;
    for (const d of deals ?? []) {
      if (d.deleted_at) continue;
      if (!d.project_id) {
        unfiled += 1;
        continue;
      }
      m.set(d.project_id, (m.get(d.project_id) ?? 0) + 1);
    }
    return { dealCount: m, unfiledDeals: unfiled };
  }, [deals]);

  const options = useMemo(() => {
    const toOption = (p: { id: string; name: string; color: string | null }, prefix = ""): ScopeOption => ({
      key: `${prefix}${p.id}`,
      value: p.id,
      label: p.name,
      color: p.color,
      deals: dealCount.get(p.id) ?? 0,
    });
    const groups: { label: string; options: ScopeOption[] }[] = [];
    const recent = scope.recentIds
      .map((id) => scope.projects.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => toOption(p, "recent:"));
    if (recent.length) groups.push({ label: "Recent", options: recent });
    groups.push({ label: "Projects", options: scope.projects.map((p) => toOption(p)) });
    // Records not filed under any project. Always offered: they must never
    // be unreachable just because nobody filed them yet.
    groups.push({
      label: "Unfiled",
      options: [{ key: NO_PROJECT, value: NO_PROJECT, label: "No project", color: null, deals: unfiledDeals }],
    });
    return groups;
  }, [scope.projects, scope.recentIds, dealCount, unfiledDeals]);

  const hint = useMemo(() => HINTS.find((x) => pathname.startsWith(x.prefix))?.hint ?? null, [pathname]);

  return (
    // The page rhythm every CRM screen uses (crmPageStyle), so the bar lines
    // up with the headers under it; sticky works on the inner card.
    <div style={{ ...crmPageStyle(), paddingTop: 0, paddingBottom: 0 }}>
      <div
        style={{
          position: "sticky",
          top: 58,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          minHeight: 44,
          padding: "6px 12px",
          marginBottom: 14,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 10,
        }}
      >
        <MIcon name={scope.isNoProject ? "folder_off" : "folder_open"} size={18} color={token.colorPrimary} />
        <Select
          aria-label="Current project"
          showSearch
          variant="filled"
          optionFilterProp="label"
          open={open}
          onOpenChange={setOpen}
          placeholder="Choose a project"
          value={scope.selection ?? undefined}
          style={{ width: isMobile ? undefined : 280, flex: isMobile ? 1 : undefined, minWidth: 160 }}
          options={options}
          onChange={(v: string | undefined) => {
            if (v) scope.setProjectId(v);
          }}
          optionRender={(opt) => {
            const d = opt.data as unknown as ScopeOption;
            return (
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {d.value === NO_PROJECT ? (
                  <MIcon name="folder_off" size={16} color={token.colorTextSecondary} />
                ) : (
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: d.color ?? token.colorTextQuaternary, flex: "none" }} />
                )}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
                <span style={{ fontSize: 12, color: token.colorTextTertiary, whiteSpace: "nowrap" }}>
                  {d.deals} {d.deals === 1 ? "deal" : "deals"}
                </span>
              </span>
            );
          }}
        />

        {!isMobile ? <span style={{ flex: 1 }} /> : null}

        {hint ? (
          !isMobile ? (
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              {hint}
            </Typography.Text>
          ) : null
        ) : scope.isScoped ? (
          <ScopeSummary isMobile={isMobile} onOpenProject={(id) => router.push(`/projects/${id}?tab=crm`)} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The right side of the bar: the project's counts and a way to its project
 * page. Its own component, mounted only when shown, so routes that never show
 * people do not subscribe to the people cache for it.
 */
function ScopeSummary({ isMobile, onOpenProject }: { isMobile: boolean; onOpenProject: (id: string) => void }) {
  const { token } = theme.useToken();
  const scope = useCrmScope();
  const { data: people } = useCrmPeople();
  const { data: deals } = useCrmDeals();
  const { inScope } = scope;
  const liveDeals = useMemo(() => (deals ?? []).filter((d) => !d.deleted_at && inScope(d.project_id)).length, [deals, inScope]);
  const livePeople = useMemo(() => (people ?? []).filter((p) => !p.deleted_at && inScope(p.project_id)).length, [people, inScope]);
  if (!scope.project) return null;

  return (
    <Space size={6} wrap>
      {!isMobile ? (
        <SoftChip tone="custom" color={scope.project.color ?? token.colorPrimary} icon={scope.isNoProject ? "folder_off" : "folder_open"}>
          {scope.project.name} · {liveDeals} {liveDeals === 1 ? "deal" : "deals"} · {livePeople} {livePeople === 1 ? "person" : "people"}
        </SoftChip>
      ) : null}
      {scope.projectId ? (
        <Button size="small" type="text" onClick={() => onOpenProject(scope.projectId as string)}>
          Open project
        </Button>
      ) : null}
    </Space>
  );
}

const SINGULAR: Record<string, string> = { people: "person", companies: "company" };

/**
 * The empty state a page shows when the current project has none of its
 * records (and no local filter is hiding any): names the project and offers to
 * create one in it — the bar right above is where another project is chosen.
 * One component for all the pages so the copy cannot drift.
 */
export function ScopedEmptyState({
  nouns,
  onCreate,
  description,
  compact = false,
}: {
  /** Plural, lower case: "deals", "people", "companies", "tasks", "notes", "reminders". */
  nouns: string;
  onCreate?: () => void;
  description?: React.ReactNode;
  compact?: boolean;
}) {
  const { token } = theme.useToken();
  const scope = useCrmScope();
  const name = scope.project?.name ?? "this project";
  const singular = SINGULAR[nouns] ?? nouns.replace(/s$/, "");
  return (
    <EmptyState
      compact={compact}
      icon={scope.isNoProject ? "folder_off" : "folder_open"}
      accent={scope.project?.color ?? token.colorPrimary}
      title={scope.isNoProject ? `No ${nouns} without a project` : `No ${nouns} in ${name} yet`}
      // A page's own description may talk about "<Project>'s people and
      // deals"; under "No project" that reads as nonsense, so the built-in
      // copy wins there.
      description={
        scope.isNoProject
          ? "Everything here is filed under a project — pick one in the bar above."
          : (description ??
            // A project's own CRM tab is pinned to it and has no project bar.
            (scope.fixed ? `Create one in ${name}.` : `Create one in ${name}, or pick another project in the bar above.`))
      }
      action={
        onCreate ? (
          <Button type="primary" icon={<MIcon name="add" size={16} />} onClick={onCreate}>
            New {singular}
          </Button>
        ) : undefined
      }
    />
  );
}
