"use client";

import { App, Button, Result, Spin } from "antd";
import { useRouter } from "next/navigation";
import {
  useInstallApp,
  useInstalledApp,
  useIsTeamAdmin,
} from "@/features/apps-platform/use-installed-apps";

function MIcon({
  name,
  size = 28,
  color = "#4a4ad0",
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

export default function HRLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { message } = App.useApp();
  const { enabled, isLoading } = useInstalledApp("hr");
  const { data: isTeamAdmin } = useIsTeamAdmin();
  const installApp = useInstallApp();

  const handleInstall = async () => {
    try {
      await installApp.mutateAsync("hr");
      message.success("HR installed.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to install HR.",
      );
    }
  };

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: "calc(100vh - 120px)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div
        style={{
          minHeight: "calc(100vh - 120px)",
          display: "grid",
          placeItems: "center",
          padding: 24,
        }}
      >
        <Result
          icon={<MIcon name="group" size={42} />}
          title="Install HR to unlock this workspace"
          subTitle="Employees, attendance, leave, payroll, onboarding, and reports stay behind the HR app install for this team."
          extra={
            isTeamAdmin ? (
              <Button
                type="primary"
                size="large"
                loading={installApp.isPending}
                onClick={handleInstall}
              >
                Install HR
              </Button>
            ) : (
              <Button size="large" onClick={() => router.push("/apps")}>
                Open App Center
              </Button>
            )
          }
        />
      </div>
    );
  }

  return <>{children}</>;
}
