"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Checkbox,
  Input,
  Modal,
  Radio,
  Tooltip,
  Typography,
  theme,
} from "antd";
import { useProjects } from "@/features/projects/use-projects";
import { useInstalledApp, useIsTeamAdmin } from "./use-installed-apps";
import { useSetAppScope, parseAppScope, type AppScope } from "./app-scope";

const { Paragraph } = Typography;

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

function Gear({ size = 19 }: { size?: number }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1 }}
    >
      settings
    </span>
  );
}

interface ChecklistProject {
  id: string;
  name: string;
  color_code: string | null;
}

/**
 * Searchable, checkbox project list with a colour dot per project, a live
 * "N of M selected" count, and select-all / clear — a friendlier picker than a
 * tag-style multi-select for choosing which projects an app is activated for.
 */
function ProjectChecklist({
  projects,
  value,
  onChange,
}: {
  projects: ChecklistProject[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { token } = theme.useToken();
  const [q, setQ] = useState("");
  const selected = useMemo(() => new Set(value), [value]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? projects.filter((p) => p.name.toLowerCase().includes(needle))
      : projects;
  }, [projects, q]);
  // Count only selected ids that map to a visible project — saved projectIds can
  // include archived/deleted projects the current user no longer sees, which
  // would otherwise read as "3 of 2 selected".
  const selectedShown = useMemo(() => {
    const ids = new Set(projects.map((p) => p.id));
    return value.filter((id) => ids.has(id)).length;
  }, [projects, value]);

  const toggle = (id: string) => {
    const next = new Set(value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };
  const selectAllFiltered = () => {
    const next = new Set(value);
    filtered.forEach((p) => next.add(p.id));
    onChange([...next]);
  };

  return (
    <div style={{ marginTop: 12 }}>
      <Input
        allowClear
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search projects…"
        prefix={
          <span
            className="material-symbols-rounded"
            style={{ fontSize: 16, color: token.colorTextTertiary }}
          >
            search
          </span>
        }
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          margin: "8px 2px 6px",
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          {selectedShown} of {projects.length} selected
        </Typography.Text>
        <span style={{ display: "inline-flex", gap: 4 }}>
          <Button
            type="link"
            size="small"
            style={{ padding: 0, fontSize: 12.5 }}
            disabled={filtered.length === 0}
            onClick={selectAllFiltered}
          >
            {q ? "Select matching" : "Select all"}
          </Button>
          <Button
            type="link"
            size="small"
            style={{ padding: 0, fontSize: 12.5 }}
            disabled={value.length === 0}
            onClick={() => onChange([])}
          >
            Clear
          </Button>
        </span>
      </div>
      <div
        style={{
          maxHeight: 260,
          overflowY: "auto",
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 10,
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 16,
              textAlign: "center",
              color: token.colorTextTertiary,
              fontSize: 13,
            }}
          >
            No projects found.
          </div>
        ) : (
          filtered.map((p, i) => {
            const on = selected.has(p.id);
            return (
              // A plain (keyboard-accessible) row — not a <label> — so it doesn't
              // nest inside the antd Checkbox's own <label>; the checkbox is a
              // visual only and the row handles the toggle.
              <div
                key={p.id}
                role="checkbox"
                aria-checked={on}
                tabIndex={0}
                onClick={() => toggle(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(p.id);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  cursor: "pointer",
                  borderTop:
                    i === 0
                      ? "none"
                      : `1px solid ${token.colorFillQuaternary}`,
                  background: on ? token.controlItemBgActive : "transparent",
                }}
              >
                <Checkbox checked={on} style={{ pointerEvents: "none" }} tabIndex={-1} />
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: p.color_code ?? token.colorTextQuaternary,
                    flex: "none",
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 13.5,
                    color: token.colorText,
                  }}
                >
                  {p.name}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * Admin-only "which projects is this app activated for" control, surfaced ON THE
 * APP'S OWN SCREEN as a gear button (e.g. beside the app title) that opens a
 * modal. Self-gates: renders nothing unless the app is installed AND the caller
 * is a team admin — so non-admins never see it. Backed by installed_apps.config
 * (see app-scope.ts); the write is additionally admin-gated by RLS.
 */
export function AppActivationButton({ appKey }: { appKey: string }) {
  const { data: isTeamAdmin } = useIsTeamAdmin();
  const { record, installed } = useInstalledApp(appKey);
  const [open, setOpen] = useState(false);

  if (!isTeamAdmin || !installed || !record) return null;

  return (
    <>
      <Tooltip title="App settings">
        <Button
          type="text"
          size="small"
          aria-label="App settings"
          icon={<Gear />}
          onClick={() => setOpen(true)}
        />
      </Tooltip>
      <AppActivationModal
        recordId={record.id}
        config={record.config}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function AppActivationModal({
  recordId,
  config,
  open,
  onClose,
}: {
  recordId: string;
  config: unknown;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const { data: projects } = useProjects();
  const setScope = useSetAppScope();
  const saved = useMemo(() => parseAppScope(config), [config]);

  const [mode, setMode] = useState<AppScope["mode"]>(saved.mode);
  const [ids, setIds] = useState<string[]>(
    saved.mode === "selected" ? saved.projectIds : [],
  );

  // Reseed the editor from the saved scope each time the modal opens.
  const [seededFor, setSeededFor] = useState<string>("");
  const openKey = open ? recordId : "";
  if (openKey !== seededFor) {
    setSeededFor(openKey);
    if (open) {
      setMode(saved.mode);
      setIds(saved.mode === "selected" ? saved.projectIds : []);
    }
  }

  const savedIds = saved.mode === "selected" ? saved.projectIds : [];
  const dirty =
    mode !== saved.mode || (mode === "selected" && !sameIdSet(ids, savedIds));
  const emptySelected = mode === "selected" && ids.length === 0;

  const save = async () => {
    const scope: AppScope =
      mode === "selected"
        ? { mode: "selected", projectIds: ids }
        : { mode: "all" };
    try {
      await setScope.mutateAsync({ id: recordId, scope });
      message.success("Activation updated.");
      onClose();
    } catch {
      message.error("Only team admins can change activation.");
    }
  };

  return (
    <Modal
      title="App activation"
      open={open}
      onCancel={onClose}
      okText="Save"
      okButtonProps={{
        disabled: !dirty || emptySelected,
        loading: setScope.isPending,
      }}
      onOk={() => void save()}
      destroyOnHidden
    >
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        Choose which projects this app applies to. Only team admins can change
        this.
      </Paragraph>
      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <Radio value="all">All projects</Radio>
        <Radio value="selected">Selected projects only</Radio>
      </Radio.Group>
      {mode === "selected" ? (
        <ProjectChecklist
          projects={projects ?? []}
          value={ids}
          onChange={setIds}
        />
      ) : null}
      {emptySelected ? (
        <Paragraph
          style={{ fontSize: 12.5, margin: "8px 0 0", color: token.colorError }}
        >
          Pick at least one project, or switch to “All projects”.
        </Paragraph>
      ) : null}
    </Modal>
  );
}
