"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Descriptions,
  Input,
  Modal,
  Progress,
  Result,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
  theme,
} from "antd";
import type { UploadProps } from "antd";
import {
  CloudDownloadOutlined,
  CloudUploadOutlined,
  ExclamationCircleFilled,
  InboxOutlined,
} from "@ant-design/icons";
import { useActiveTeam } from "@/features/teams/use-teams";
import {
  useInstalledApp,
  useInstallApp,
  useIsTeamAdmin,
} from "@/features/apps-platform/use-installed-apps";
import {
  useClearWorkspaceData,
  useExportBackup,
  useImportBackup,
  useIsTeamOwner,
  type ClearSummary,
} from "@/features/app-data-manager/use-data-manager";
import {
  backupCounts,
  validateBackup,
  type BackupCounts,
  type BackupFileV1,
} from "@/features/app-data-manager/backup-format";
import type { ImportSummary } from "@/features/app-data-manager/backup-engine";

const { Title, Paragraph, Text } = Typography;

const ACCENT = "#b45309";

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

/** A parsed-and-validated backup waiting for the user to confirm the import. */
interface PendingImport {
  file: BackupFileV1;
  counts: BackupCounts;
  fileName: string;
}

export default function DataManagerPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const { data: activeTeam } = useActiveTeam();

  const { installed, enabled, isLoading: appLoading } = useInstalledApp("data_manager");
  const installApp = useInstallApp();
  const { data: isTeamAdmin } = useIsTeamAdmin();
  const ownerQuery = useIsTeamOwner();

  const exportBackup = useExportBackup();
  const importBackup = useImportBackup();
  const clearData = useClearWorkspaceData();

  const [pending, setPending] = useState<PendingImport | null>(null);
  const [importProgress, setImportProgress] = useState<{
    done: number;
    total: number;
    label: string;
  } | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  const [clearOpen, setClearOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [clearSummary, setClearSummary] = useState<ClearSummary | null>(null);

  const busy = exportBackup.isPending || importBackup.isPending || clearData.isPending;

  /* ------------------------------------------------------------- gates --- */

  // Positive gating: render nothing actionable until BOTH the install state
  // and the owner check have settled — otherwise the tools flash for
  // non-owners (and a failed owner query must not fall through to the tools).
  if (!activeTeam?.id || appLoading || ownerQuery.isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!installed || !enabled) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 0" }}>
        <Result
          icon={
            <span style={{ color: ACCENT }}>
              <MIcon name="settings_backup_restore" size={56} />
            </span>
          }
          title="Install Data Manager"
          subTitle="Backup, restore, and clear workspace data — owner-only. Install the app for this workspace to use it."
          extra={
            <Space>
              <Button
                type="primary"
                loading={installApp.isPending}
                disabled={!isTeamAdmin}
                onClick={() =>
                  installApp.mutate("data_manager", {
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

  if (ownerQuery.isError) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 0" }}>
        <Result
          status="warning"
          title="Couldn't verify workspace ownership"
          extra={
            <Button type="primary" onClick={() => ownerQuery.refetch()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (ownerQuery.data !== true) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 0" }}>
        <Result
          status="403"
          title="Workspace owner only"
          subTitle="Backups, restores, and clearing data are limited to the workspace owner. Ask the owner of this workspace to run them."
          extra={<Button onClick={() => router.push("/home")}>Back to Home</Button>}
        />
      </div>
    );
  }

  /* ----------------------------------------------------------- restore --- */

  const beforeUpload: UploadProps["beforeUpload"] = (file) => {
    void (async () => {
      try {
        const text = await file.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          message.error("That file isn't valid JSON.");
          return;
        }
        const result = validateBackup(parsed);
        if (!result.ok) {
          message.error(result.error);
          return;
        }
        setImportSummary(null);
        setPending({
          file: result.data,
          counts: backupCounts(result.data),
          fileName: file.name,
        });
      } catch {
        message.error("Couldn't read the file.");
      }
    })();
    return false; // we own the handling — no XHR upload
  };

  const runImport = () => {
    if (!pending) return;
    setImportProgress({ done: 0, total: pending.counts.tasks, label: "Starting…" });
    importBackup.mutate(
      {
        file: pending.file,
        onProgress: (done, total, label) => setImportProgress({ done, total, label }),
      },
      {
        onSuccess: (summary) => {
          setImportSummary(summary);
          setPending(null);
          setImportProgress(null);
          message.success(
            `Imported ${summary.projects} project${summary.projects === 1 ? "" : "s"} and ${summary.tasks} task${summary.tasks === 1 ? "" : "s"}.`,
          );
        },
        onError: (err) => {
          setImportProgress(null);
          message.error(
            `Import failed${err instanceof Error ? `: ${err.message}` : ""}. Items imported before the failure remain — review your projects before retrying.`,
          );
        },
      },
    );
  };

  /* ------------------------------------------------------------- clear --- */

  const confirmPhrase = activeTeam?.name ?? "";
  const handleClear = () => {
    if (confirmText.trim() !== confirmPhrase || clearData.isPending) return;
    clearData.mutate(undefined, {
      onSuccess: (summary) => {
        setClearSummary(summary);
        setClearOpen(false);
        setConfirmText("");
        message.success("Workspace data cleared.");
      },
      onError: (err) =>
        message.error(err instanceof Error ? err.message : "Failed to clear data."),
    });
  };

  /* -------------------------------------------------------------- view --- */

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: `${ACCENT}1a`,
              color: ACCENT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <MIcon name="settings_backup_restore" size={26} />
          </div>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              Data Manager
            </Title>
            <Text type="secondary">
              Workspace: <b>{activeTeam?.name ?? "…"}</b> · owner-only tools
            </Text>
          </div>
        </div>

        {/* Backup */}
        <Card>
          <Title level={5} style={{ marginTop: 0 }}>
            <CloudDownloadOutlined style={{ marginRight: 8, color: ACCENT }} />
            Backup
          </Title>
          <Paragraph type="secondary" style={{ maxWidth: 640 }}>
            Downloads a portable <Text code>.json</Text> backup of this
            workspace: folders, projects, statuses, tasks (with subtasks, dates,
            priorities), labels, and assignees (referenced by email). The file
            imports cleanly into this or any other Cubes workspace.
          </Paragraph>
          <Button
            type="primary"
            icon={<CloudDownloadOutlined />}
            loading={exportBackup.isPending}
            disabled={busy && !exportBackup.isPending}
            onClick={() =>
              exportBackup.mutate(undefined, {
                onSuccess: (counts) =>
                  message.success(
                    `Backup downloaded — ${counts.projects} projects, ${counts.tasks} tasks.`,
                  ),
                onError: (err) =>
                  message.error(
                    err instanceof Error ? err.message : "Failed to build the backup.",
                  ),
              })
            }
          >
            Download backup
          </Button>
        </Card>

        {/* Restore */}
        <Card>
          <Title level={5} style={{ marginTop: 0 }}>
            <CloudUploadOutlined style={{ marginRight: 8, color: ACCENT }} />
            Restore
          </Title>
          <Paragraph type="secondary" style={{ maxWidth: 640 }}>
            Import a Cubes backup into <b>{activeTeam?.name ?? "this workspace"}</b>.
            Imported projects are <i>added</i> — nothing existing is touched. Name
            clashes get a numbered suffix; assignees whose email isn&apos;t a member
            here are skipped.
          </Paragraph>

          {!pending && !importProgress ? (
            <Upload.Dragger
              accept=".json,application/json"
              beforeUpload={beforeUpload}
              showUploadList={false}
              multiple={false}
              disabled={busy}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined style={{ color: ACCENT }} />
              </p>
              <p className="ant-upload-text">Click or drop a backup file here</p>
              <p className="ant-upload-hint">cubes-backup-*.json</p>
            </Upload.Dragger>
          ) : null}

          {pending ? (
            <div style={{ marginTop: 4 }}>
              <Descriptions
                size="small"
                column={2}
                bordered
                title={
                  <span>
                    {pending.fileName}{" "}
                    <Tag style={{ marginLeft: 6 }}>
                      from “{pending.file.workspace.name}”
                    </Tag>
                  </span>
                }
                items={[
                  { key: "p", label: "Projects", children: pending.counts.projects },
                  { key: "t", label: "Tasks", children: pending.counts.tasks },
                  { key: "f", label: "Folders", children: pending.counts.folders },
                  { key: "l", label: "Labels", children: pending.counts.labels },
                ]}
              />
              <Space style={{ marginTop: 14 }}>
                <Button
                  type="primary"
                  icon={<CloudUploadOutlined />}
                  onClick={runImport}
                  loading={importBackup.isPending}
                  disabled={busy && !importBackup.isPending}
                >
                  Import into this workspace
                </Button>
                <Button onClick={() => setPending(null)} disabled={importBackup.isPending}>
                  Cancel
                </Button>
              </Space>
            </div>
          ) : null}

          {importProgress ? (
            <div style={{ marginTop: 12, maxWidth: 480 }}>
              <Progress
                percent={
                  importProgress.total === 0
                    ? 100
                    : Math.round((importProgress.done / importProgress.total) * 100)
                }
                status="active"
              />
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {importProgress.label}
              </Text>
            </div>
          ) : null}

          {importSummary ? (
            <Alert
              style={{ marginTop: 14 }}
              type="success"
              showIcon
              message={`Imported ${importSummary.projects} projects, ${importSummary.tasks} tasks, ${importSummary.folders} folders (${importSummary.labelsCreated} new labels).`}
              description={
                <>
                  {importSummary.renamed.length > 0 ? (
                    <div>
                      Renamed to avoid clashes: {importSummary.renamed.join(", ")}
                    </div>
                  ) : null}
                  {importSummary.assigneesDropped > 0 ? (
                    <div>
                      {importSummary.assigneesDropped} assignee reference
                      {importSummary.assigneesDropped === 1 ? "" : "s"} skipped
                      (no matching member email in this workspace).
                    </div>
                  ) : null}
                </>
              }
            />
          ) : null}
        </Card>

        {/* Danger zone */}
        <Card style={{ borderColor: token.colorErrorBorder }}>
          <Title level={5} style={{ marginTop: 0 }}>
            <ExclamationCircleFilled style={{ color: "#cf1322", marginRight: 8 }} />
            Danger zone
          </Title>
          <Paragraph type="secondary" style={{ maxWidth: 640 }}>
            Permanently deletes this workspace&apos;s work data: all projects
            (with their tasks, comments, and attachments), folders, labels,
            clients, and templates. Members, installed apps, and workspace
            settings stay. <b>This cannot be undone — download a backup first.</b>
          </Paragraph>
          <Button
            danger
            type="primary"
            disabled={busy}
            onClick={() => {
              setConfirmText("");
              setClearOpen(true);
            }}
          >
            Clear workspace data
          </Button>

          {clearSummary ? (
            <Alert
              style={{ marginTop: 14 }}
              type="info"
              showIcon
              message={`Cleared: ${clearSummary.projects} projects, ${clearSummary.folders} folders, ${clearSummary.labels} labels, ${clearSummary.clients} clients, ${clearSummary.templates} templates, ${clearSummary.workflows} workflows/agents, ${clearSummary.appData} app items.`}
            />
          ) : null}
        </Card>
      </Space>

      <Modal
        title="Clear all workspace data?"
        open={clearOpen}
        onOk={handleClear}
        onCancel={() => setClearOpen(false)}
        okText="Clear everything"
        okButtonProps={{
          danger: true,
          disabled: confirmText.trim() !== confirmPhrase,
          loading: clearData.isPending,
        }}
        cancelButtonProps={{ disabled: clearData.isPending }}
        maskClosable={!clearData.isPending}
        closable={!clearData.isPending}
        destroyOnHidden
      >
        <Paragraph>
          This permanently deletes every project, task, folder, label, client,
          and template in <b>{confirmPhrase}</b>. There is no undo.
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          Type the workspace name <Text code>{confirmPhrase}</Text> to confirm:
        </Paragraph>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={confirmPhrase}
          onPressEnter={handleClear}
          autoFocus
          aria-label="Type the workspace name to confirm"
        />
      </Modal>
    </div>
  );
}
