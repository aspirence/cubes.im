"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Input, InputNumber, Segmented, Select, Switch, Tag, Typography, theme } from "antd";
import {
  appActionByKey,
  appActionParamsComplete,
  type AppActionParam,
} from "@/lib/workflows/app-action-catalog";
import { useInstalledApps } from "@/features/apps-platform/use-installed-apps";
import { unknownTokens, type FieldGroup } from "./field-tokens";
import { TokenCell } from "./rule-editor";
import { normalizeRetryConfig, withRetry, type RetryConfig } from "./step-config";
import { RetryBlock } from "./step-inspectors";
import {
  useWorkflowCrmCampaignOptions,
  useWorkflowCrmStageOptions,
  useWorkflowSheetOptions,
} from "./use-app-step-data";

/**
 * Inspector for an "app" step: which action it runs and that action's params,
 * rendered from the catalog (APP_ACTIONS) so a new action needs no UI work
 * unless it brings a new param kind. Stored as
 *   { action: "<key>", params: { ... }, retry?: { max, backoff } }
 * and executed on the server by the runner.
 *
 * Every param is interpolated against the run context before the action sees it
 * (runner.ts), so the free-text ones get the same field picker the HTTP and
 * action steps use rather than a bare box the user has to type paths into.
 */

type Cfg = Record<string, unknown>;

const APP_NAMES: Record<string, string> = { sheets: "Sheets", crm: "CRM" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function InstallHint({ appKey }: { appKey: string }) {
  return (
    <Alert
      type="info"
      showIcon
      message={
        <span>
          Install the {APP_NAMES[appKey] ?? appKey} app to pick this.{" "}
          <Link href="/apps">Open the App Center</Link>
        </span>
      }
    />
  );
}

function SheetPicker({ value, onChange, disabled }: { value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const { data, isLoading } = useWorkflowSheetOptions();
  if (data && !data.available) return <InstallHint appKey="sheets" />;
  const rows = data?.rows ?? [];
  const selected = rows.find((r) => r.id === value);
  return (
    <>
      <Select
        style={{ width: "100%" }}
        showSearch
        optionFilterProp="label"
        loading={isLoading}
        disabled={disabled}
        placeholder={rows.length || isLoading ? "Select a sheet" : "No sheets yet — create one in Sheets"}
        value={typeof value === "string" ? value : undefined}
        options={rows.map((r) => ({
          value: r.id,
          label: `${r.name}${r.project_id ? "" : " (workspace)"}${r.linked === false ? " — not linked to Google" : ""}`,
        }))}
        onChange={onChange}
      />
      {selected && selected.linked === false ? (
        <Typography.Text type="warning" style={{ fontSize: 12 }}>
          This sheet is not linked to a Google Sheet yet, so the step will fail until you link it in Sheets.
        </Typography.Text>
      ) : null}
      {typeof value === "string" && data?.available && !isLoading && !selected ? (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          The chosen sheet no longer exists or was archived — pick another.
        </Typography.Text>
      ) : null}
    </>
  );
}

/**
 * The typo guard. A mistyped path resolves to empty text and the step fails
 * hundreds of rows later with a message about the wrong thing, so the builder
 * says so while it is still a text box.
 */
function UnknownTokenNote({ groups, value }: { groups: FieldGroup[]; value: string }) {
  const unknown = unknownTokens(groups, value);
  if (!unknown.length) return null;
  return (
    <Typography.Text type="warning" style={{ fontSize: 11.5, display: "block", marginTop: 4 }}>
      No sample explains{" "}
      {unknown.slice(0, 3).map((u) => (
        <Tag key={u} style={{ marginInlineEnd: 4, fontSize: 10.5 }}>{`{{${u}}}`}</Tag>
      ))}
      — it will arrive as empty text unless the run really carries it.
    </Typography.Text>
  );
}

/**
 * A CRM stage or campaign. Three ways to say it, because the CRM is
 * admin-only and the member building the workflow may not be one: pick from
 * the list when it can be seen, type a name (matched case-insensitively when
 * the step runs), or map it from earlier data — {{trigger.utm_campaign}}
 * from a web form is the whole point of the campaign one.
 */
function CrmLookupPicker({
  kind,
  value,
  onChange,
  groups,
  disabled,
}: {
  kind: "stage" | "campaign";
  value: unknown;
  onChange: (v: unknown) => void;
  groups: FieldGroup[];
  disabled?: boolean;
}) {
  const stages = useWorkflowCrmStageOptions(kind === "stage");
  const campaigns = useWorkflowCrmCampaignOptions(kind === "campaign");
  const query = kind === "stage" ? stages : campaigns;
  const text = typeof value === "string" ? value : "";
  // A stored name or token cannot be shown by the select; open in the box.
  const [mapped, setMapped] = useState(() => text !== "" && !UUID.test(text));

  if (query.data && !query.data.available) return <InstallHint appKey="crm" />;
  const rows = (query.data?.rows ?? []) as { id: string; name: string }[];
  const selected = rows.find((r) => r.id === text);
  const noun = kind === "stage" ? "stage" : "campaign";
  const listable = rows.length > 0 || query.isLoading;

  return (
    <>
      <Segmented
        size="small"
        disabled={disabled}
        value={mapped ? "map" : "pick"}
        onChange={(v) => {
          const next = v === "map";
          setMapped(next);
          if (!next && !UUID.test(text)) onChange("");
        }}
        options={[
          { value: "pick", label: `Choose a ${noun}` },
          { value: "map", label: "Type a name or map" },
        ]}
        style={{ marginBottom: 6 }}
      />
      {mapped ? (
        <>
          <TokenCell
            value={text}
            onChange={onChange}
            groups={groups}
            placeholder={kind === "stage" ? "Screening — or {{trigger.stage}}" : "Diwali leads — or {{trigger.utm_campaign}}"}
            disabled={disabled}
            width="100%"
          />
          <Typography.Text type="secondary" style={{ fontSize: 11.5, display: "block", marginTop: 4 }}>
            A name is matched when the step runs, ignoring case. Empty leaves it {kind === "stage" ? "on the first stage" : "unattributed"}.
          </Typography.Text>
          <UnknownTokenNote groups={groups} value={text} />
        </>
      ) : (
        <Select
          style={{ width: "100%" }}
          showSearch
          allowClear
          optionFilterProp="label"
          loading={query.isLoading}
          disabled={disabled}
          placeholder={
            listable
              ? `Select a ${noun}`
              : `Nothing listed — only CRM admins can see ${noun}s. Type the name instead.`
          }
          value={selected ? text : undefined}
          options={rows.map((r) => ({ value: r.id, label: r.name }))}
          onChange={(v) => onChange(v ?? "")}
        />
      )}
      {!mapped && UUID.test(text) && query.data?.available && !query.isLoading && rows.length > 0 && !selected ? (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          The chosen {noun} no longer exists — pick another.
        </Typography.Text>
      ) : null}
    </>
  );
}

function ParamInput({
  param,
  value,
  onChange,
  groups,
  disabled,
}: {
  param: AppActionParam;
  value: unknown;
  onChange: (v: unknown) => void;
  groups: FieldGroup[];
  disabled?: boolean;
}) {
  switch (param.kind) {
    case "select":
      return (
        <Select
          style={{ width: "100%" }}
          disabled={disabled}
          value={(value ?? param.default) as string}
          options={param.options}
          onChange={onChange}
        />
      );
    case "multi_select":
      return (
        <Select
          mode="multiple"
          style={{ width: "100%" }}
          disabled={disabled}
          value={(Array.isArray(value) ? value : param.default) as string[]}
          options={param.options}
          onChange={onChange}
        />
      );
    case "number":
      return (
        <InputNumber
          style={{ width: "100%" }}
          disabled={disabled}
          min={param.min}
          max={param.max}
          value={(typeof value === "number" ? value : param.default) as number}
          onChange={(v) => onChange(v ?? param.default)}
        />
      );
    case "boolean":
      return <Switch disabled={disabled} checked={Boolean(value ?? param.default)} onChange={onChange} />;
    case "sheet":
      return <SheetPicker value={value} onChange={onChange} disabled={disabled} />;
    case "crm_stage":
      return <CrmLookupPicker kind="stage" value={value} onChange={onChange} groups={groups} disabled={disabled} />;
    case "crm_campaign":
      return <CrmLookupPicker kind="campaign" value={value} onChange={onChange} groups={groups} disabled={disabled} />;
    case "text": {
      const text = typeof value === "string" ? value : String(param.default ?? "");
      return (
        <>
          <TokenCell
            width="100%"
            value={text}
            onChange={onChange}
            groups={groups}
            disabled={disabled}
          />
          <UnknownTokenNote groups={groups} value={text} />
        </>
      );
    }
    case "code": {
      const text = typeof value === "string" ? value : String(param.default ?? "");
      return (
        <>
          <Input.TextArea
            rows={5}
            disabled={disabled}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 12 }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
            Use the picker on a one-line field above to see the field names, then type them here.
          </Typography.Text>
          <UnknownTokenNote groups={groups} value={text} />
        </>
      );
    }
    case "headers":
      // Header lists get a purpose-built editor in the step that needs them
      // (the HTTP step); here they are shown as the JSON object they are, so an
      // action that declares this kind is at least editable rather than blank.
      return (
        <Input.TextArea
          rows={4}
          disabled={disabled}
          value={JSON.stringify(value ?? param.default ?? {}, null, 2)}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value));
            } catch {
              // Half-typed JSON is normal while editing; the last valid object
              // stays saved until this parses again.
            }
          }}
          style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 12 }}
        />
      );
  }
}

/** Whether an app step can run as configured (drives the builder's ⚠ badge). */
export function isAppStepComplete(config: Cfg): boolean {
  const action = typeof config.action === "string" ? appActionByKey(config.action) : undefined;
  if (!action) return false;
  return appActionParamsComplete(action, (config.params ?? {}) as Cfg);
}

export function AppStepInspector({
  stepKey,
  config,
  groups,
  disabled,
  onSave,
}: {
  stepKey: string;
  config: Cfg;
  /** The trigger's and earlier steps' samples, for the params that take tokens. */
  groups: FieldGroup[];
  disabled?: boolean;
  onSave: (cfg: Cfg) => void;
}) {
  const { token } = theme.useToken();
  const { data: installed } = useInstalledApps();
  // Retries live beside `action`/`params`, not inside them: the engine reads
  // workflow_step_runs.input -> 'retry' (the step config as parked), the same
  // place the HTTP step writes it. The draft holds everything else.
  const [draft, setDraft] = useState<Cfg>(() => {
    const rest = { ...config };
    delete rest.retry;
    return rest;
  });
  const [retry, setRetry] = useState<RetryConfig>(() => normalizeRetryConfig(config));
  const action = typeof draft.action === "string" ? appActionByKey(draft.action) : undefined;
  const params = (draft.params && typeof draft.params === "object" ? draft.params : {}) as Cfg;

  if (!action) {
    return (
      <Alert
        type="error"
        showIcon
        message="This app step points at an action that no longer exists. Delete it and add a new one."
      />
    );
  }

  const install = installed?.find((i) => i.app_key === action.appKey);
  const push = (next: Cfg, nextRetry: RetryConfig) => {
    setDraft(next);
    setRetry(nextRetry);
    onSave(withRetry(next, nextRetry));
  };
  const setParam = (key: string, value: unknown) =>
    push({ ...draft, params: { ...params, [key]: value } }, retry);

  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {action.label}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        {action.description}
      </Typography.Paragraph>

      {installed && (!install || !install.enabled) ? (
        <Alert
          style={{ marginBottom: 14 }}
          type="warning"
          showIcon
          message={
            !install
              ? `The ${APP_NAMES[action.appKey] ?? action.appKey} app is not installed, so this step will fail when the workflow runs.`
              : `The ${APP_NAMES[action.appKey] ?? action.appKey} app is turned off, so this step will fail when the workflow runs.`
          }
        />
      ) : null}

      {action.params.map((p) => (
        <div key={p.key} style={{ marginBottom: 14 }}>
          <Typography.Text style={{ fontSize: 13, display: "block", marginBottom: 4 }}>
            {p.label}
            {p.required ? <span style={{ color: "#e0556a" }}> *</span> : null}
          </Typography.Text>
          <ParamInput
            param={p}
            value={params[p.key]}
            onChange={(v) => setParam(p.key, v)}
            groups={groups}
            disabled={disabled}
          />
          {p.help ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {p.help}
            </Typography.Text>
          ) : null}
        </div>
      ))}

      <RetryBlock retry={retry} disabled={disabled} onChange={(r) => push(draft, r)} />

      <div
        style={{
          marginTop: 14,
          background: token.colorFillTertiary,
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: 12,
          color: token.colorTextSecondary,
          lineHeight: 1.7,
        }}
      >
        Later steps can use what this step reports:
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {action.outputs.map((o) => (
            <Tag key={o.key} style={{ margin: 0 }} title={`{{steps.${stepKey}.${o.key}}}`}>
              {o.label}
            </Tag>
          ))}
        </div>
        <div style={{ marginTop: 6 }}>
          It runs on the server right after the steps before it, so a run pauses here for as long as the
          sync takes.
        </div>
      </div>
    </div>
  );
}
