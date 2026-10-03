"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Input,
  Popconfirm,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import { SampleTree } from "./field-picker";
import {
  useEnsureWebhook,
  useSaveTriggerSample,
  useUpdateWebhook,
  useWebhookEvents,
  useWorkflowWebhook,
  newWebhookToken,
  type WorkflowWebhookEventRow,
} from "./use-workflow-automation";

/**
 * The webhook trigger's panel: the private URL, a copy button, the
 * "waiting for a request…" state that polls the capture buffer, the captured
 * payload as a tree, and the button that promotes it to the trigger's sample so
 * the field picker downstream has real values to offer.
 *
 * Capture mode is the important idea and it is spelled out rather than hidden
 * behind a word: while it is on, requests are *stored and not run*, which is
 * what makes it safe to point a live system at the URL while still building.
 */

function relative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return new Date(iso).toLocaleString();
}

/** 24 random bytes, hex — a signing secret worth having. */
function newSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function CopyRow({ text, label }: { text: string; label: string }) {
  const { message } = App.useApp();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${label} copied.`);
    } catch {
      // Clipboard access is refused on http:// origins and in some browsers;
      // saying so beats a silent no-op.
      message.warning("Your browser refused clipboard access — select the text and copy it.");
    }
  };
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <Input readOnly value={text} onFocus={(e) => e.currentTarget.select()} />
      <Button onClick={() => void copy()}>Copy</Button>
    </div>
  );
}

export function WebhookTriggerPanel({
  workflowId,
  disabled,
  /** The trigger sample already stored, so the panel can say it has one. */
  hasSample,
}: {
  workflowId: string;
  disabled?: boolean;
  hasSample: boolean;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { data: hook, isLoading } = useWorkflowWebhook(workflowId);
  const ensure = useEnsureWebhook();
  const update = useUpdateWebhook();
  const saveSample = useSaveTriggerSample();

  const row = hook?.row ?? null;
  const capturing = Boolean(row?.capture_mode);
  const { data: events } = useWebhookEvents(row?.id, { waiting: capturing });
  const captured = useMemo<WorkflowWebhookEventRow[]>(() => events?.row ?? [], [events]);
  const newest = captured[0] ?? null;

  // The panel only ever renders inside an opened drawer, so reading the
  // location during the first render cannot desync a server-rendered tree.
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  // The secret edit box shows the stored value until it is typed into; keeping
  // the draft separate means a refetch never wipes what is half-typed.
  const [secretDraft, setSecretDraft] = useState<string | null>(null);
  const secret = secretDraft ?? row?.signing_secret ?? "";

  if (isLoading) return <Spin size="small" />;

  if (hook && !hook.available) {
    return (
      <Alert
        type="info"
        showIcon
        message="Webhook triggers are not available here yet"
        description="They need migration 20261132000000_workflow_automation.sql (workflow_webhooks). Until it is applied, this workflow can still run manually or on a schedule."
      />
    );
  }

  if (!row) {
    return (
      <div>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
          Another system posts to a private URL and the run starts with whatever it sent. The URL is
          unguessable and is never shown outside this workspace.
        </Typography.Paragraph>
        <Button
          type="primary"
          disabled={disabled}
          loading={ensure.isPending}
          onClick={() =>
            void ensure
              .mutateAsync(workflowId)
              .catch((err: unknown) =>
                message.error(
                  err instanceof Error ? err.message : "Could not create the webhook URL.",
                ),
              )
          }
        >
          Create the webhook URL
        </Button>
      </div>
    );
  }

  const url = origin ? `${origin}/api/hooks/${row.token}` : `/api/hooks/${row.token}`;

  const setCapture = (on: boolean) =>
    void update
      .mutateAsync({ id: row.id, workflowId, patch: { capture_mode: on } })
      .catch((err: unknown) =>
        message.error(err instanceof Error ? err.message : "Could not change capture mode."),
      );

  return (
    <div>
      <Typography.Text style={{ fontSize: 13 }}>Webhook URL</Typography.Text>
      <div style={{ marginTop: 4, marginBottom: 6 }}>
        <CopyRow text={url} label="Webhook URL" />
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
        POST JSON here (up to 1 MB). Anyone with this URL can start this workflow — treat it like a
        password.
      </Typography.Text>

      <div
        style={{
          marginTop: 14,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 10,
          padding: "10px 12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Switch size="small" checked={capturing} disabled={disabled} onChange={setCapture} />
          <Typography.Text style={{ fontSize: 13, flex: 1 }}>
            Capture mode {capturing ? "on" : "off"}
          </Typography.Text>
          {capturing ? (
            <Tag color="gold" style={{ margin: 0 }}>
              not running
            </Tag>
          ) : (
            <Tag color="green" style={{ margin: 0 }}>
              live
            </Tag>
          )}
        </div>
        <Typography.Paragraph type="secondary" style={{ fontSize: 11.5, margin: "6px 0 0" }}>
          {capturing
            ? "Requests are stored so you can build against them — the workflow does not run."
            : "Requests start a run. Turn capture back on to collect a fresh sample without running anything."}
        </Typography.Paragraph>

        {capturing && !newest ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            <Spin size="small" />
            <Typography.Text style={{ fontSize: 12.5 }}>Waiting for a request…</Typography.Text>
          </div>
        ) : null}
      </div>

      {newest ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Typography.Text style={{ fontSize: 13, flex: 1 }}>
              Last request · {relative(newest.received_at)}
            </Typography.Text>
            <Tag style={{ margin: 0 }}>{newest.status}</Tag>
            <Button
              size="small"
              type="primary"
              disabled={disabled}
              loading={saveSample.isPending}
              onClick={() =>
                void saveSample
                  .mutateAsync({ workflowId, sample: newest.payload ?? {} })
                  .then(() => message.success("Saved as this trigger's sample."))
                  .catch((err: unknown) =>
                    message.error(
                      err instanceof Error ? err.message : "Could not save the sample.",
                    ),
                  )
              }
            >
              {hasSample ? "Replace sample" : "Use as sample"}
            </Button>
          </div>
          {newest.error ? (
            <Alert type="error" showIcon style={{ marginBottom: 8 }} message={newest.error} />
          ) : null}
          <div
            style={{
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 10,
              padding: "8px 10px",
            }}
          >
            <SampleTree sample={newest.payload ?? {}} root="trigger" label="Captured payload" />
          </div>
          {captured.length > 1 ? (
            <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
              {captured.length} requests captured — the newest is shown.
            </Typography.Text>
          ) : null}
        </div>
      ) : null}

      <Typography.Text style={{ fontSize: 13, display: "block", marginTop: 16 }}>
        Signing secret (optional)
      </Typography.Text>
      <Typography.Paragraph type="secondary" style={{ fontSize: 11.5, margin: "2px 0 6px" }}>
        When set, a request must carry <code>x-cubes-signature</code>: the HMAC-SHA256 of the raw
        body with this secret. Requests without it are refused.
      </Typography.Paragraph>
      <div style={{ display: "flex", gap: 6 }}>
        <Input.Password
          value={secret}
          disabled={disabled}
          placeholder="No signature required"
          onChange={(e) => setSecretDraft(e.target.value)}
        />
        <Button
          disabled={disabled}
          onClick={() => setSecretDraft(newSecret())}
          title="Generate a random secret"
        >
          Generate
        </Button>
        <Button
          type="primary"
          disabled={disabled || secret === (row.signing_secret ?? "")}
          loading={update.isPending}
          onClick={() =>
            void update
              .mutateAsync({
                id: row.id,
                workflowId,
                patch: { signing_secret: secret.trim() ? secret.trim() : null },
              })
              .then(() => {
                setSecretDraft(null);
                message.success("Signing secret saved.");
              })
              .catch((err: unknown) =>
                message.error(err instanceof Error ? err.message : "Could not save the secret."),
              )
          }
        >
          Save
        </Button>
      </div>

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <Tooltip title="Issues a new URL. Anything still posting to the old one gets a 404.">
          <Popconfirm
            title="Issue a new URL?"
            description="The current URL stops working immediately. Update whatever posts to it."
            okText="Regenerate"
            okButtonProps={{ danger: true }}
            disabled={disabled}
            onConfirm={() =>
              void update
                .mutateAsync({ id: row.id, workflowId, patch: { token: newWebhookToken() } })
                .then(() => message.success("A new URL was issued."))
                .catch((err: unknown) =>
                  message.error(err instanceof Error ? err.message : "Could not regenerate the URL."),
                )
            }
          >
            <Button danger size="small" disabled={disabled}>
              Regenerate URL
            </Button>
          </Popconfirm>
        </Tooltip>
        {row.last_event_at ? (
          <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
            Last request {relative(row.last_event_at)}
          </Typography.Text>
        ) : null}
      </div>
    </div>
  );
}
