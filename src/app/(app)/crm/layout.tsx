"use client";

import { App, Button, Result, Spin } from "antd";
import { useRouter } from "next/navigation";
import {
  useInstallApp,
  useInstalledApp,
  useIsTeamAdmin,
} from "@/features/apps-platform/use-installed-apps";
import { useIsCrmAdmin } from "@/features/app-crm/use-crm-access";
import { errMsg } from "@/lib/err";

function MIcon({
  name,
  size = 28,
  color = "#0ea5e9",
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1, color }}
    >
      {name}
    </span>
  );
}

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

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
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
        <Result
          icon={<MIcon name="hub" size={42} />}
          title="Install Cubes CRM to unlock this workspace"
          subTitle="People, companies, the deal pipeline, CRM tasks, notes, and timelines stay behind the CRM app install for this team."
          extra={
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
      </Centered>
    );
  }

  // Installed but not granted: CRM data is owner-controlled — the workspace
  // owner (CRM Settings → Access) decides who works the pipeline.
  if (!isCrmAdmin) {
    return (
      <Centered>
        <Result
          icon={<MIcon name="lock" size={42} />}
          title="You don't have CRM access yet"
          subTitle="Cubes CRM is installed for this workspace, but access is granted per person. Ask the workspace owner to add you from CRM Settings → Access."
          extra={
            <Button size="large" onClick={() => router.push("/home")}>
              Back to Home
            </Button>
          }
        />
      </Centered>
    );
  }

  return <>{children}</>;
}
