"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Popconfirm,
  Segmented,
  Select,
  Switch,
  Tag,
  Typography,
  theme,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { MemberSingleSelect } from "@/features/team-members/member-select";
import { TokenInput } from "./field-picker";
import type { FieldGroup } from "./field-tokens";
import { RuleGroupEditor, TokenCell } from "./rule-editor";
import {
  canAddRoute,
  compactConditionConfig,
  FALLBACK_ROUTE_KEY,
  isFallbackRoute,
  MAX_ROUTES,
  normalizeConditionConfig,
  normalizeRouterConfig,
  routeKeyFor,
  validateRouterConfig,
  type MatchMode,
  type Route,
  type Rule,
} from "./rule-groups";
import {
  compactDelayConfig,
  compactHttpConfig,
  describeRetry,
  HTTP_METHODS,
  MAX_RETRY_ATTEMPTS,
  normalizeDelayConfig,
  normalizeHttpConfig,
  normalizeRetryConfig,
  validateDelayConfig,
  validateHttpConfig,
  withRetry,
  type DelayUnit,
  type HttpMethod,
  type RetryBackoff,
} from "./step-config";

/**
 * Drawer bodies for the step types the builder added on top of the original
 * three: Filter, Router, Delay, HTTP, and the two action steps rebuilt around
 * the field picker so their text fields can carry data from earlier steps.
 *
 * Each one edits a local draft and pushes the whole config up on every change —
 * the same save-as-you-type the original inspector used, so nothing is lost by
 * closing the drawer.
 */

type Cfg = Record<string, unknown>;

interface InspectorProps {
  config: Cfg;
  groups: FieldGroup[];
  disabled?: boolean;
  onSave: (cfg: Cfg) => void;
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <Typography.Text style={{ fontSize: 13, display: "block", marginBottom: 4 }}>
      {children}
      {required ? <span style={{ color: "#e0556a" }}> *</span> : null}
    </Typography.Text>
  );
}

/* ----------------------------------------------------------------- filter -- */

export function FilterInspector({ config, groups, disabled, onSave }: InspectorProps) {
  const { token } = theme.useToken();
  const [draft, setDraft] = useState(() => normalizeConditionConfig(config));

  const push = (next: typeof draft) => {
    setDraft(next);
    onSave(compactConditionConfig(next));
  };

  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Filter
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Checks the data and decides whether the rest of the workflow is worth doing.
      </Typography.Paragraph>

      <Label>When the rules do not match</Label>
      <Segmented
        block
        disabled={disabled}
        value={draft.mode}
        onChange={(v) => push({ ...draft, mode: v as "filter" | "stop" })}
        options={[
          { value: "filter", label: "Skip this step" },
          { value: "stop", label: "Stop the run" },
        ]}
        style={{ marginBottom: 6 }}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 11.5 }}>
        {draft.mode === "filter"
          ? "The run carries on with the next step — use this when only some records deserve the work."
          : "The run ends here and is recorded as finished, not failed."}
      </Typography.Paragraph>

      <div
        style={{
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 10,
          padding: "10px 12px",
          marginTop: 8,
        }}
      >
        <RuleGroupEditor
          match={draft.match}
          rules={draft.rules}
          groups={groups}
          disabled={disabled}
          onChange={(g) => push({ ...draft, match: g.match, rules: g.rules })}
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- router -- */

export function RouterInspector({
  config,
  groups,
  disabled,
  onSave,
  stepKey,
}: InspectorProps & { stepKey: string }) {
  const { token } = theme.useToken();
  const [draft, setDraft] = useState(() => normalizeRouterConfig(config));

  const push = (routes: Route[]) => {
    const next = { routes };
    setDraft(next);
    onSave(next as unknown as Cfg);
  };

  const setRoute = (i: number, patch: Partial<Route>) =>
    push(draft.routes.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const problem = validateRouterConfig(draft);
  const hasFallback = draft.routes.some(isFallbackRoute);

  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Router
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Sends each run down the first route whose rules match. Steps after this one belong to a
        route — pick which one on the step itself.
      </Typography.Paragraph>

      {draft.routes.map((route, i) => (
        <div
          key={route.key}
          style={{
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Input
              size="small"
              value={route.label}
              disabled={disabled}
              placeholder="Route name"
              onChange={(e) => setRoute(i, { label: e.target.value })}
              style={{ flex: 1 }}
            />
            <Tag style={{ margin: 0, fontSize: 10.5 }} title="The branch key stored on child steps">
              {route.key}
            </Tag>
            <Button
              type="text"
              size="small"
              danger
              disabled={disabled || draft.routes.length === 1}
              aria-label="Remove route"
              icon={<DeleteOutlined style={{ fontSize: 12 }} />}
              onClick={() => push(draft.routes.filter((_, idx) => idx !== i))}
            />
          </div>
          {isFallbackRoute(route) ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Everything that matched no route above comes here. No rules needed.
            </Typography.Text>
          ) : (
            <RuleGroupEditor
              match={route.match}
              rules={route.rules}
              groups={groups}
              disabled={disabled}
              onChange={(g: { match: MatchMode; rules: Rule[] }) =>
                setRoute(i, { match: g.match, rules: g.rules })
              }
            />
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: 10 }}>
        <Button
          size="small"
          type="link"
          style={{ padding: 0 }}
          disabled={disabled || !canAddRoute(draft)}
          icon={<PlusOutlined style={{ fontSize: 11 }} />}
          onClick={() => {
            const label = `Route ${draft.routes.length + 1}`;
            const key = routeKeyFor(label, draft.routes.map((r) => r.key));
            const route: Route = { key, label, match: "all", rules: [{ left: "", op: "=", right: "" }] };
            // A fallback always stays last, because routes are tried in order.
            const at = draft.routes.findIndex(isFallbackRoute);
            const next = [...draft.routes];
            next.splice(at >= 0 ? at : next.length, 0, route);
            push(next);
          }}
        >
          Add route
        </Button>
        {!hasFallback ? (
          <Button
            size="small"
            type="link"
            style={{ padding: 0 }}
            disabled={disabled || !canAddRoute(draft)}
            onClick={() =>
              push([
                ...draft.routes,
                { key: FALLBACK_ROUTE_KEY, label: "Everything else", match: "all", rules: [] },
              ])
            }
          >
            Add a fallback route
          </Button>
        ) : null}
      </div>

      <Typography.Paragraph type="secondary" style={{ fontSize: 11.5, marginTop: 8 }}>
        Up to {MAX_ROUTES} routes, one level deep. Without a fallback, a run that matches nothing
        ends here and is recorded as finished.
      </Typography.Paragraph>

      {problem ? <Alert type="warning" showIcon message={problem} /> : null}

      <Typography.Paragraph type="secondary" style={{ fontSize: 11.5, marginTop: 8 }}>
        Later steps read which route was taken as{" "}
        <code>{`{{steps.${stepKey}.route}}`}</code>.
      </Typography.Paragraph>
    </div>
  );
}

/** Picks which of a router's routes a step belongs to. */
export function BranchPicker({
  routerConfig,
  value,
  disabled,
  onChange,
}: {
  routerConfig: Cfg;
  value: string | null;
  disabled?: boolean;
  onChange: (key: string | null) => void;
}) {
  const routes = normalizeRouterConfig(routerConfig).routes;
  return (
    <div style={{ marginBottom: 14 }}>
      <Label>Runs on route</Label>
      <Select
        style={{ width: "100%" }}
        allowClear
        disabled={disabled}
        placeholder="Every route"
        value={value ?? undefined}
        options={routes.map((r) => ({ value: r.key, label: r.label }))}
        onChange={(v) => onChange(v ?? null)}
      />
      <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
        Leave empty and the step runs whichever route matched.
      </Typography.Text>
    </div>
  );
}

/* ------------------------------------------------------------------ delay -- */

export function DelayInspector({ config, groups, disabled, onSave }: InspectorProps) {
  const [draft, setDraft] = useState(() => normalizeDelayConfig(config));
  const push = (next: typeof draft) => {
    setDraft(next);
    onSave(compactDelayConfig(next));
  };
  const problem = validateDelayConfig(draft);

  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Delay
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Parks the run and picks it up later. The workflow does not hold a connection open while it
        waits, so a long delay costs nothing.
      </Typography.Paragraph>

      <Segmented
        block
        disabled={disabled}
        value={draft.kind}
        onChange={(v) => push({ ...draft, kind: v as "for" | "until" })}
        options={[
          { value: "for", label: "Wait for a while" },
          { value: "until", label: "Wait until a date" },
        ]}
        style={{ marginBottom: 12 }}
      />

      {draft.kind === "for" ? (
        <div style={{ display: "flex", gap: 8 }}>
          <InputNumber
            min={1}
            max={44_640}
            disabled={disabled}
            value={draft.amount}
            onChange={(v) => push({ ...draft, amount: typeof v === "number" ? v : 1 })}
            style={{ width: 120 }}
          />
          <Select
            style={{ flex: 1 }}
            disabled={disabled}
            value={draft.unit}
            onChange={(v) => push({ ...draft, unit: v as DelayUnit })}
            options={[
              { value: "minutes", label: "minutes" },
              { value: "hours", label: "hours" },
              { value: "days", label: "days" },
            ]}
          />
        </div>
      ) : (
        <div>
          <Label required>Date to wait for</Label>
          <TokenCell
            value={draft.until}
            onChange={(v) => push({ ...draft, until: v })}
            groups={groups}
            placeholder="{{trigger.due_at}} or 2026-10-01T09:00:00Z"
            disabled={disabled}
          />
        </div>
      )}

      <Typography.Paragraph type="secondary" style={{ fontSize: 11.5, marginTop: 8 }}>
        The runner wakes parked runs every few minutes, so a delay is accurate to about that, not to
        the second. Thirty days is the ceiling: a date further out than that is waited for thirty
        days and then the run carries on. A date already past means “carry on now”, not a failure.
      </Typography.Paragraph>

      {problem ? <Alert type="warning" showIcon message={problem} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------- http -- */

export function HttpInspector({
  config,
  groups,
  disabled,
  onSave,
  stepKey,
}: InspectorProps & { stepKey: string }) {
  const { token } = theme.useToken();
  // An http step stores its request at the top level of its config — that is
  // what the SQL engine checks and what the runner hands to runHttpStep.
  const [draft, setDraft] = useState(() => normalizeHttpConfig(config));
  const [retry, setRetry] = useState(() => normalizeRetryConfig(config));

  const push = (next: typeof draft, nextRetry = retry) => {
    setDraft(next);
    setRetry(nextRetry);
    onSave(withRetry(compactHttpConfig(next), nextRetry));
  };

  const problem = validateHttpConfig(draft);

  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        HTTP request
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Calls any https URL. The server refuses private and loopback addresses, and a workspace
        admin has to allow the host first.
      </Typography.Paragraph>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <Select
          style={{ width: 110 }}
          disabled={disabled}
          value={draft.method}
          onChange={(v) => push({ ...draft, method: v as HttpMethod })}
          options={HTTP_METHODS.map((m) => ({ value: m, label: m }))}
        />
        <div style={{ flex: 1 }}>
          <TokenCell
            value={draft.url}
            onChange={(v) => push({ ...draft, url: v })}
            groups={groups}
            placeholder="https://api.example.com/leads"
            disabled={disabled}
          />
        </div>
      </div>

      <Label>Headers</Label>
      {draft.headers.map((h, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <Input
            style={{ width: 150 }}
            value={h.name}
            disabled={disabled}
            placeholder="content-type"
            onChange={(e) =>
              push({
                ...draft,
                headers: draft.headers.map((x, idx) =>
                  idx === i ? { ...x, name: e.target.value } : x,
                ),
              })
            }
          />
          <div style={{ flex: 1 }}>
            <TokenCell
              value={h.value}
              onChange={(v) =>
                push({
                  ...draft,
                  headers: draft.headers.map((x, idx) => (idx === i ? { ...x, value: v } : x)),
                })
              }
              groups={groups}
              placeholder="application/json"
              disabled={disabled}
            />
          </div>
          <Button
            type="text"
            size="small"
            danger
            disabled={disabled}
            aria-label="Remove header"
            icon={<DeleteOutlined style={{ fontSize: 12 }} />}
            onClick={() => push({ ...draft, headers: draft.headers.filter((_, idx) => idx !== i) })}
          />
        </div>
      ))}
      <Button
        size="small"
        type="link"
        disabled={disabled}
        style={{ padding: 0, marginBottom: 12 }}
        icon={<PlusOutlined style={{ fontSize: 11 }} />}
        onClick={() => push({ ...draft, headers: [...draft.headers, { name: "", value: "" }] })}
      >
        Add header
      </Button>
      <Typography.Paragraph type="secondary" style={{ fontSize: 11.5, margin: "0 0 12px" }}>
        Never paste an API key here. Reference a stored connection instead —{" "}
        <code>{"{{connection.<id>.token}}"}</code> is filled in on the server and never stored in
        the step.
      </Typography.Paragraph>

      {draft.method === "GET" ? null : (
        <>
          <Label>Body</Label>
          <Input.TextArea
            rows={6}
            value={draft.body}
            disabled={disabled}
            placeholder={'{\n  "email": "{{trigger.contact.email}}"\n}'}
            onChange={(e) => push({ ...draft, body: e.target.value })}
            style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 12 }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
            Use the picker on the URL or a header to see the field names, then type them here.
          </Typography.Text>
        </>
      )}

      <div style={{ marginTop: 14 }}>
        <Label>Timeout</Label>
        <InputNumber
          min={1000}
          max={60_000}
          step={1000}
          disabled={disabled}
          value={draft.timeout_ms}
          onChange={(v) => push({ ...draft, timeout_ms: typeof v === "number" ? v : 10_000 })}
          addonAfter="ms"
          style={{ width: 180 }}
        />
      </div>

      <RetryBlock
        retry={retry}
        disabled={disabled}
        onChange={(r) => push(draft, r)}
      />

      {problem ? <Alert type="warning" showIcon style={{ marginTop: 12 }} message={problem} /> : null}

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
        Later steps read the response as{" "}
        <code>{`{{steps.${stepKey}.status}}`}</code> and{" "}
        <code>{`{{steps.${stepKey}.body...}}`}</code>. Test the step to see its real shape.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ retry -- */

export function RetryBlock({
  retry,
  disabled,
  onChange,
}: {
  retry: ReturnType<typeof normalizeRetryConfig>;
  disabled?: boolean;
  onChange: (r: ReturnType<typeof normalizeRetryConfig>) => void;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Switch
          size="small"
          checked={retry.enabled}
          disabled={disabled}
          onChange={(v) => onChange({ ...retry, enabled: v })}
        />
        <Typography.Text style={{ fontSize: 13, flex: 1 }}>Retry on failure</Typography.Text>
      </div>
      {retry.enabled ? (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <InputNumber
            min={1}
            max={MAX_RETRY_ATTEMPTS}
            disabled={disabled}
            value={retry.max}
            onChange={(v) => onChange({ ...retry, max: typeof v === "number" ? v : 3 })}
            addonBefore="Attempts"
            style={{ width: 170 }}
          />
          <Select
            style={{ flex: 1 }}
            disabled={disabled}
            value={retry.backoff}
            onChange={(v) => onChange({ ...retry, backoff: v as RetryBackoff })}
            options={[
              { value: "exponential", label: "wait longer each time" },
              { value: "fixed", label: "same wait each time" },
            ]}
          />
        </div>
      ) : null}
      <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
        {describeRetry(retry)}
      </Typography.Text>
    </div>
  );
}

/* ---------------------------------------------------------------- actions -- */

export function NotifyInspector({
  config,
  groups,
  disabled,
  onSave,
  members,
}: InspectorProps & { members: { value: string; label: string }[] }) {
  const [draft, setDraft] = useState<Cfg>(config);
  const set = (key: string, value: unknown) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onSave(next);
  };
  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Notify member
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        Sends an in-app notification. Only members of this workspace can be notified.
      </Typography.Paragraph>
      <Label required>Notify</Label>
      <MemberSingleSelect
        style={{ width: "100%", marginBottom: 14 }}
        value={(draft.user_id as string) || undefined}
        options={members}
        disabled={disabled}
        onChange={(v) => set("user_id", v)}
        placeholder="Select member"
      />
      <TokenInput
        label="Message"
        required
        multiline
        rows={3}
        value={(draft.message as string) ?? ""}
        onChange={(v) => set("message", v)}
        groups={groups}
        disabled={disabled}
        placeholder="New lead: {{trigger.contact.name}}"
      />
    </div>
  );
}

export function CreateTaskInspector({
  config,
  groups,
  disabled,
  onSave,
  projects,
}: InspectorProps & { projects: { value: string; label: string }[] }) {
  const [draft, setDraft] = useState<Cfg>(config);
  const set = (key: string, value: unknown) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onSave(next);
  };
  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Create task
      </Typography.Title>
      <Label required>Project</Label>
      <Select
        style={{ width: "100%", marginBottom: 14 }}
        showSearch
        optionFilterProp="label"
        disabled={disabled}
        value={(draft.project_id as string) || undefined}
        options={projects}
        onChange={(v) => set("project_id", v)}
        placeholder="Select project"
      />
      <TokenInput
        label="Task name"
        required
        value={(draft.name as string) ?? ""}
        onChange={(v) => set("name", v)}
        groups={groups}
        disabled={disabled}
        placeholder="Follow up with {{trigger.contact.name}}"
      />
    </div>
  );
}

/* ------------------------------------------------------- delete confirm --- */

/** Shared "are you sure" for removing a step — separate from the on/off switch. */
export function DeleteStepButton({
  onConfirm,
  disabled,
}: {
  onConfirm: () => void;
  disabled?: boolean;
}) {
  return (
    <Popconfirm
      title="Delete this step?"
      description="Runs already recorded keep their history."
      okText="Delete"
      okButtonProps={{ danger: true }}
      disabled={disabled}
      onConfirm={onConfirm}
    >
      <Button danger size="small" disabled={disabled} icon={<DeleteOutlined />}>
        Delete step
      </Button>
    </Popconfirm>
  );
}
