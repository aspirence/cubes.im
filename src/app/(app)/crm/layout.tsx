"use client";

import { App, Button, Spin, theme } from "antd";
import { useRouter } from "next/navigation";
import {
  useInstallApp,
  useInstalledApp,
  useIsTeamAdmin,
} from "@/features/apps-platform/use-installed-apps";
import { useIsCrmAdmin } from "@/features/app-crm/use-crm-access";
import { errMsg } from "@/lib/err";
import { EmptyState, Panel } from "./_lib/ui";

/** Full-height stage for the install / no-access gates. */
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "calc(100vh - 120px)",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}

/** The gate card: same panel surface as every other CRM screen. */
function GatePanel({ children }: { children: React.ReactNode }) {
  return (
    <Panel padding={0} style={{ width: "100%", maxWidth: 460 }}>
      {children}
    </Panel>
  );
}

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { enabled, isLoading } = useInstalledApp("crm");
  const { data: isTeamAdmin } = useIsTeamAdmin();
  const { data: isCrmAdmin, isLoading: accessLoading } = useIsCrmAdmin();
  const installApp = useInstallApp();

  const handleInstall = async () => {
    try {
      await installApp.mutateAsync("crm");
      message.success("Cubes CRM installed.");
    } catch (err) {
      message.error(errMsg(err, "Failed to install Cubes CRM."));
    }
  };

  if (isLoading || (enabled && accessLoading)) {
    return (
      <Centered>
        <Spin size="large" />
      </Centered>
    );
  }

  if (!enabled) {
    return (
      <Centered>
        <GatePanel>
          <EmptyState
            icon="hub"
            accent={token.colorPrimary}
            title="Install Cubes CRM to unlock this workspace"
            description="People, companies, the deal pipeline, CRM tasks, notes, and timelines stay behind the CRM app install for this team."
            action={
              isTeamAdmin ? (
                <Button
                  type="primary"
                  size="large"
                  loading={installApp.isPending}
                  onClick={handleInstall}
                >
                  Install Cubes CRM
                </Button>
              ) : (
                <Button size="large" onClick={() => router.push("/apps")}>
                  Open App Center
                </Button>
              )
            }
          />
        </GatePanel>
      </Centered>
    );
  }

  // Installed but not granted: CRM data is owner-controlled — the workspace
  // owner (CRM Settings → Access) decides who works the pipeline.
  if (!isCrmAdmin) {
    return (
      <Centered>
        <GatePanel>
          <EmptyState
            icon="lock"
            title="You don't have CRM access yet"
            description="Cubes CRM is installed for this workspace, but access is granted per person. Ask the workspace owner to add you from CRM Settings → Access."
            action={
              <Button size="large" onClick={() => router.push("/home")}>
                Back to Home
              </Button>
            }
          />
        </GatePanel>
      </Centered>
    );
  }

  return <>{children}</>;
}
