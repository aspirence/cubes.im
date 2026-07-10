"use client";

import { useRouter } from "next/navigation";
import { App as AntdApp, Button, Result, Space, Spin } from "antd";
import {
  useInstalledApp,
  useInstallApp,
  useIsTeamAdmin,
} from "@/features/apps-platform/use-installed-apps";
import { McpManager } from "@/features/mcp/mcp-manager";

const ACCENT = "#c96442";

function MIcon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1 }}
    >
      {name}
    </span>
  );
}

export default function McpAppPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { installed, enabled, isLoading } = useInstalledApp("mcp");
  const installApp = useInstallApp();
  const { data: isTeamAdmin } = useIsTeamAdmin();

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spin size="large" />
      </div>
    );
  }

  // Not installed (or disabled) → install prompt. Installing an app enables it
  // in the same step (installed_apps.enabled defaults true), so it activates
  // immediately and the tools UI renders.
  if (!installed || !enabled) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 0" }}>
        <Result
          icon={
            <span style={{ color: ACCENT }}>
              <MIcon name="smart_toy" size={56} />
            </span>
          }
          title="Install MCP"
          subTitle="Run an MCP server for this workspace so Claude can read and act on your projects and tasks. Install to activate it and mint access tokens."
          extra={
            <Space>
              <Button
                type="primary"
                loading={installApp.isPending}
                disabled={!isTeamAdmin}
                onClick={() =>
                  installApp.mutate("mcp", {
                    onSuccess: () => message.success("MCP is active."),
                    onError: (err) =>
                      message.error(
                        err instanceof Error ? err.message : "Failed to install.",
                      ),
                  })
                }
              >
                {isTeamAdmin ? "Install" : "Admins only"}
              </Button>
              <Button onClick={() => router.push("/apps?view=cubes")}>
                Open App Center
              </Button>
            </Space>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <McpManager />
    </div>
  );
}
