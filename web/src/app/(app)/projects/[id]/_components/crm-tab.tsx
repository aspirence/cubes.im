"use client";

import { useRouter } from "next/navigation";
import { Button, Spin, theme } from "antd";
import { useInstalledApp } from "@/features/apps-platform/use-installed-apps";
import { useIsCrmAdmin } from "@/features/app-crm/use-crm-access";
import { useProject } from "@/features/projects/use-projects";
import { useActiveTeam } from "@/features/teams/use-teams";
import { CrmScopeProvider } from "@/app/(app)/crm/_lib/crm-scope";
import { CrmDashboard } from "@/app/(app)/crm/_components/crm-dashboard";
import { EmptyState, Panel } from "@/app/(app)/crm/_lib/ui";

/**
 * The CRM inside a project: the same dashboard as /crm/dashboard — pipeline
 * by stage, the deals table, reminders, open tasks, recent activity, New deal —
 * showing only what is filed under this project (app_crm_*.project_id,
 * migration 20261150000000).
 *
 * The scope is pinned (CrmScopeProvider fixedProjectId): the record drawer,
 * the deal form and the task/note resolver all see exactly this project, and a
 * deal made here is filed under it. The dashboard's page header (title,
 * blurb, paste hint, Reports / Open pipeline) is not shown here; the links
 * into the CRM that remain first move the /crm project switcher to this
 * project, so they land on this project's pages.
 *
 * Who sees it: CRM members of the project's own workspace. The CRM's data is
 * is_crm_admin-gated and team-wide, and the installed-app and access answers
 * are about the ACTIVE workspace — so a project from another workspace says
 * so instead of showing the wrong workspace's CRM, and everyone else is told
 * why the view is empty rather than shown an empty account.
 */

export function CrmTab({ projectId }: { projectId: string }) {
  const { token } = theme.useToken();
  const router = useRouter();
  const team = useActiveTeam();
  const projectQuery = useProject(projectId);
  // Both answer for the ACTIVE workspace and stay pending until it is known.
  const crm = useInstalledApp("crm");
  const access = useIsCrmAdmin();

  const activeTeam = team.data;
  const project = projectQuery.data;

  if (team.isPending || projectQuery.isPending) return <Loading />;

  if (team.isError || projectQuery.isError || !project) {
    return (
      <LoadError
        title="Couldn't load this project's CRM"
        loading={team.isFetching || projectQuery.isFetching}
        onRetry={() => {
          if (team.isError) void team.refetch();
          if (projectQuery.isError) void projectQuery.refetch();
        }}
      />
    );
  }

  if (!activeTeam) {
    return (
      <Panel>
        <EmptyState
          icon="workspaces"
          title="No workspace selected"
          description="Choose this project's workspace to see its CRM."
        />
      </Panel>
    );
  }

  if (project.team_id !== activeTeam.id) {
    return (
      <Panel>
        <EmptyState
          icon="swap_horiz"
          title="This project is in another workspace"
          description="Switch workspace to see its CRM."
        />
      </Panel>
    );
  }

  if (crm.isPending || access.isPending) return <Loading />;

  if (crm.isError) {
    return <LoadError title="Couldn't check whether the CRM is installed" loading={crm.isFetching} onRetry={() => void crm.refetch()} />;
  }

  if (!crm.enabled) {
    return (
      <Panel>
        <EmptyState
          icon="hub"
          accent={token.colorPrimary}
          title="Cubes CRM isn't installed"
          description="Install it from the App Center to see this project's deals, people, companies, tasks and notes here."
          action={<Button onClick={() => router.push("/apps")}>Open App Center</Button>}
        />
      </Panel>
    );
  }

  if (access.isError) {
    return <LoadError title="Couldn't check your CRM access" loading={access.isFetching} onRetry={() => void access.refetch()} />;
  }

  if (!access.data) {
    return (
      <Panel>
        <EmptyState
          icon="lock"
          title="CRM access is granted per person"
          description="This view shows the project's deals and contacts, which only CRM members can see. Ask the workspace owner to add you from CRM Settings → Access."
        />
      </Panel>
    );
  }

  // The same dashboard as /crm/dashboard, pinned to this project.
  return (
    <CrmScopeProvider fixedProjectId={projectId}>
      <CrmDashboard embedded />
    </CrmScopeProvider>
  );
}

function Loading() {
  return (
    <div style={{ display: "grid", placeItems: "center", padding: 64 }}>
      <Spin />
    </div>
  );
}

function LoadError({ title, loading, onRetry }: { title: string; loading: boolean; onRetry: () => void }) {
  const { token } = theme.useToken();
  return (
    <Panel>
      <EmptyState
        icon="error"
        accent={token.colorError}
        title={title}
        description="Check your connection and try again."
        action={
          <Button loading={loading} onClick={onRetry}>
            Retry
          </Button>
        }
      />
    </Panel>
  );
}
