"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Drawer,
  Input,
  Popconfirm,
  Select,
  Spin,
  Tabs,
  Tooltip,
  Typography,
  theme,
} from "antd";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useCrmStages } from "@/features/app-crm/use-crm-stages";
import { useCrmRecordActivities } from "@/features/app-crm/use-crm-activities";
import {
  useCreateCrmNote,
  useCrmNotes,
  useDeleteCrmNote,
} from "@/features/app-crm/use-crm-notes";
import {
  useCreateCrmTask,
  useCrmTasks,
  useDeleteCrmTask,
  useUpdateCrmTask,
} from "@/features/app-crm/use-crm-tasks";
import {
  CRM_TASK_STATUSES,
  crmMoney,
  crmPersonName,
  type CrmActivity,
  type CrmCompany,
  type CrmDealWithRefs,
  type CrmPersonWithCompany,
  type CrmTargetRef,
  type CrmTaskStatus,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "./m-icon";
import { DealGlyph } from "./deal-glyph";
import { PhoneWithCopy } from "./phone-cell";
import { ENTITY_META } from "./entity-meta";
import { CrmListRow } from "./list-row";
import {
  EmptyState,
  EntityAvatar,
  Panel,
  RowActions,
  SoftChip,
  crmDate,
  crmDateTime,
  crmFromNow,
  tint,
  useCrmStyles,
} from "../_lib/ui";

const ACTIVITY_ICONS: Record<string, string> = {
  created: "add_circle",
  updated: "edit",
  stage_changed: "swap_horiz",
  deleted: "delete",
  restored: "restore_from_trash",
  note_added: "sticky_note_2",
  task_added: "task_alt",
};

function activityText(activity: CrmActivity): string {
  const props = (activity.properties ?? {}) as Record<string, unknown>;
  switch (activity.event) {
    case "created":
      return "created this record";
    case "updated": {
      const fields = Array.isArray(props.fields)
        ? (props.fields as string[]).map((f) =>
            f.replace(/_id$/, "").replace(/_/g, " "),
          )
        : [];
      return fields.length > 0
        ? `updated ${fields.join(", ")}`
        : "updated this record";
    }
    case "stage_changed":
      return `moved the deal from ${String(props.from ?? "no stage")} to ${String(props.to ?? "no stage")}`;
    case "deleted":
      return "deleted this record";
    case "restored":
      return "restored this record";
    case "note_added":
      return `added a note — “${String(props.title ?? "")}”`;
    case "task_added":
      return `added a task — “${String(props.title ?? "")}”`;
    default:
      return activity.event;
  }
}

/** One field of the Overview definition grid. */
type OverviewItem = {
  key: string;
  label: string;
  children: React.ReactNode;
  /** Full-width fields (addresses, URLs) span both columns. */
  span?: number;
};

const ELLIPSIS: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** Tab label with the linked-record count as a quiet pill. */
function TabLabel({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  const { token } = theme.useToken();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {children}
      {count ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 18,
            padding: "0 6px",
            borderRadius: 999,
            background: token.colorFillTertiary,
            color: token.colorTextSecondary,
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1,
          }}
        >
          {count}
        </span>
      ) : null}
    </span>
  );
}

/** The compact quick-add shell pinned under the tab header. */
function Composer({ children }: { children: React.ReactNode }) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        padding: 8,
        borderRadius: 10,
        background: token.colorFillQuaternary,
        border: `1px solid ${token.colorBorderSecondary}`,
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The shared record side panel (Twenty's record page, drawer-sized): Overview
 * fields, the trigger-written Timeline, and the record's linked Tasks / Notes
 * with quick-add. Works for any polymorphic target (person/company/deal).
 */
export function RecordDrawer({
  target,
  onClose,
}: {
  target: CrmTargetRef | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  useCrmStyles();
  const { data: people, isLoading: peopleLoading } = useCrmPeople();
  const { data: companies, isLoading: companiesLoading } = useCrmCompanies();
  const { data: deals, isLoading: dealsLoading } = useCrmDeals();
  const { data: stages } = useCrmStages();
  const { data: members } = useTeamMembers();
  const { data: activities, isLoading: activitiesLoading } =
    useCrmRecordActivities(target?.type, target?.id);
  const { data: tasks } = useCrmTasks();
  const { data: notes } = useCrmNotes();
  const createTask = useCreateCrmTask();
  const updateTask = useUpdateCrmTask();
  const deleteTask = useDeleteCrmTask();
  const createNote = useCreateCrmNote();
  const deleteNote = useDeleteCrmNote();

  const [newTask, setNewTask] = useState("");
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteBody, setNewNoteBody] = useState("");
  const [confirmTaskId, setConfirmTaskId] = useState<string | null>(null);
  const [confirmNoteId, setConfirmNoteId] = useState<string | null>(null);

  const userName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) {
      if (m.user) map.set(m.user.id, m.user.name);
    }
    return (id: string | null | undefined) =>
      (id && map.get(id)) || "Someone";
  }, [members]);

  const record = useMemo(() => {
    if (!target) return null;
    if (target.type === "person")
      return (people ?? []).find((p) => p.id === target.id) ?? null;
    if (target.type === "company")
      return (companies ?? []).find((c) => c.id === target.id) ?? null;
    return (deals ?? []).find((d) => d.id === target.id) ?? null;
  }, [target, people, companies, deals]);

  /**
   * The list this record lives in may still be in flight — deep links and
   * dashboard clicks can open the drawer before the cache is warm. Without
   * this we'd flash "This record no longer exists" at a record that exists.
   */
  const recordLoading = target
    ? target.type === "person"
      ? peopleLoading
      : target.type === "company"
        ? companiesLoading
        : dealsLoading
    : false;

  const title = useMemo(() => {
    if (!target || !record) return "";
    if (target.type === "person")
      return crmPersonName(record as { first_name: string; last_name: string });
    return (record as { name: string }).name;
  }, [target, record]);

  const linkedTasks = useMemo(
    () =>
      (tasks ?? []).filter((t) =>
        t.targets.some(
          (x) =>
            target &&
            x.target_type === target.type &&
            x.target_id === target.id,
        ),
      ),
    [tasks, target],
  );

  const linkedNotes = useMemo(
    () =>
      (notes ?? []).filter((n) =>
        n.targets.some(
          (x) =>
            target &&
            x.target_type === target.type &&
            x.target_id === target.id,
        ),
      ),
    [notes, target],
  );

  const overviewItems = useMemo<OverviewItem[]>(() => {
    if (!target || !record) return [];
    if (target.type === "person") {
      const p = record as CrmPersonWithCompany;
      return [
        { key: "email", label: "Email", children: p.email || "—" },
        { key: "phone", label: "Phone", children: p.phone || "—" },
        { key: "job", label: "Job title", children: p.job_title || "—" },
        { key: "company", label: "Company", children: p.company?.name || "—" },
        { key: "city", label: "City", children: p.city || "—" },
        {
          key: "created",
          label: "Created",
          children: crmDate(p.created_at),
        },
        {
          key: "li",
          label: "LinkedIn",
          span: 2,
          children: p.linkedin_url ? (
            <a href={p.linkedin_url} target="_blank" rel="noreferrer">
              {p.linkedin_url}
            </a>
          ) : (
            "—"
          ),
        },
      ];
    }
    if (target.type === "company") {
      const c = record as CrmCompany;
      const address = [
        c.address_street,
        c.address_city,
        c.address_state,
        c.address_zip,
        c.address_country,
      ]
        .filter(Boolean)
        .join(", ");
      return [
        { key: "domain", label: "Domain", children: c.domain || "—" },
        {
          key: "revenue",
          label: "Annual revenue",
          children:
            c.annual_revenue === null
              ? "—"
              : crmMoney(c.annual_revenue, c.currency_code),
        },
        {
          key: "employees",
          label: "Employees",
          children: c.employees ?? "—",
        },
        {
          key: "icp",
          label: "ICP",
          children: c.icp ? (
            <SoftChip tone="success" icon="star">
              Ideal customer
            </SoftChip>
          ) : (
            "—"
          ),
        },
        {
          key: "owner",
          label: "Account owner",
          children: c.account_owner_id ? userName(c.account_owner_id) : "—",
        },
        {
          key: "created",
          label: "Created",
          children: crmDate(c.created_at),
        },
        { key: "address", label: "Address", span: 2, children: address || "—" },
        {
          key: "li",
          label: "LinkedIn",
          span: 2,
          children: c.linkedin_url ? (
            <a href={c.linkedin_url} target="_blank" rel="noreferrer">
              {c.linkedin_url}
            </a>
          ) : (
            "—"
          ),
        },
      ];
    }
    const d = record as CrmDealWithRefs;
    const stage = (stages ?? []).find((s) => s.id === d.stage_id);
    return [
      {
        key: "stage",
        label: "Stage",
        children: stage ? (
          <SoftChip tone="custom" color={stage.color}>
            {stage.name}
          </SoftChip>
        ) : (
          <SoftChip>No stage</SoftChip>
        ),
      },
      {
        key: "close",
        label: "Close date",
        children: crmDate(d.close_date),
      },
      {
        key: "phone",
        label: "Mobile number",
        children: <PhoneWithCopy phone={d.phone} size={13} fallback="—" />,
      },
      { key: "company", label: "Company", children: d.company?.name || "—" },
      {
        key: "contact",
        label: "Point of contact",
        children: crmPersonName(d.contact) || "—",
      },
      {
        key: "owner",
        label: "Owner",
        children: d.owner_id ? userName(d.owner_id) : "—",
      },
      {
        key: "created",
        label: "Created",
        children: crmDate(d.created_at),
      },
    ];
  }, [target, record, stages, userName]);

  const handleAddTask = async () => {
    const trimmed = newTask.trim();
    if (!trimmed || !target) return;
    try {
      await createTask.mutateAsync({ title: trimmed, targets: [target] });
      setNewTask("");
    } catch (err) {
      message.error(errMsg(err, "Failed to add task."));
    }
  };

  const handleAddNote = async () => {
    const titleTrimmed = newNoteTitle.trim();
    if (!titleTrimmed || !target) return;
    try {
      await createNote.mutateAsync({
        title: titleTrimmed,
        body: newNoteBody.trim() || null,
        targets: [target],
      });
      setNewNoteTitle("");
      setNewNoteBody("");
    } catch (err) {
      message.error(errMsg(err, "Failed to add note."));
    }
  };

  const meta = target ? ENTITY_META[target.type] : null;

  const avatarSrc =
    target?.type === "person"
      ? (record as CrmPersonWithCompany | null)?.avatar_url ?? null
      : null;

  /** The line under the record name: stage for deals, context else. */
  const headerSubtitle = (): React.ReactNode => {
    if (!target || !record) return null;
    if (target.type === "deal") {
      const d = record as CrmDealWithRefs;
      const stage = (stages ?? []).find((s) => s.id === d.stage_id);
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 4,
            minWidth: 0,
          }}
        >
          {stage ? (
            <SoftChip tone="custom" color={stage.color}>
              {stage.name}
            </SoftChip>
          ) : (
            <SoftChip>No stage</SoftChip>
          )}
          {d.company?.name ? (
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 400,
                color: token.colorTextTertiary,
                ...ELLIPSIS,
              }}
            >
              · {d.company.name}
            </span>
          ) : null}
        </div>
      );
    }
    const line =
      target.type === "person"
        ? [
            (record as CrmPersonWithCompany).job_title,
            (record as CrmPersonWithCompany).company?.name,
            (record as CrmPersonWithCompany).email,
          ]
            .filter(Boolean)
            .join(" · ")
        : [
            (record as CrmCompany).domain,
            (record as CrmCompany).address_city,
          ]
            .filter(Boolean)
            .join(" · ");
    if (!line) return null;
    return (
      <div
        style={{
          marginTop: 3,
          fontSize: 12.5,
          fontWeight: 400,
          color: token.colorTextTertiary,
          ...ELLIPSIS,
        }}
      >
        {line}
      </div>
    );
  };

  return (
    <Drawer
      open={Boolean(target)}
      onClose={onClose}
      width={560}
      destroyOnHidden
      styles={{ header: { padding: "14px 20px" }, body: { padding: "8px 20px 20px" } }}
      title={
        meta ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              minWidth: 0,
            }}
          >
            {target?.type === "deal" ? (
              <DealGlyph name={title || meta.label} size={40} />
            ) : (
              <EntityAvatar
                name={title || meta.label}
                kind={target?.type === "person" ? "person" : "company"}
                src={avatarSrc}
                size={40}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    letterSpacing: "-0.2px",
                    lineHeight: 1.3,
                    color: token.colorText,
                    ...ELLIPSIS,
                  }}
                >
                  {title || "Record"}
                </span>
                <SoftChip
                  tone="custom"
                  color={meta.color}
                  icon={meta.icon}
                  style={{ flex: "none" }}
                >
                  {meta.label}
                </SoftChip>
              </div>
              {headerSubtitle()}
            </div>
          </div>
        ) : null
      }
    >
      {recordLoading ? (
        <div style={{ display: "grid", placeItems: "center", padding: 64 }}>
          <Spin size="large" />
        </div>
      ) : !record ? (
        <EmptyState
          icon="search_off"
          title="This record no longer exists"
          description="It may have been deleted or permanently removed from this workspace."
        />
      ) : (
        <Tabs
          defaultActiveKey="overview"
          tabBarStyle={{ marginBottom: 14 }}
          items={[
            {
              key: "overview",
              label: "Overview",
              children: (
                <Panel padding={14}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: "14px 18px",
                    }}
                  >
                    {overviewItems.map((item) => {
                      const empty = item.children === "—";
                      return (
                        <div
                          key={item.key}
                          style={{
                            minWidth: 0,
                            gridColumn: item.span === 2 ? "1 / -1" : undefined,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              lineHeight: 1.4,
                              color: token.colorTextTertiary,
                              marginBottom: 2,
                            }}
                          >
                            {item.label}
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              lineHeight: 1.5,
                              color: empty
                                ? token.colorTextQuaternary
                                : token.colorText,
                              wordBreak: "break-word",
                            }}
                          >
                            {item.children}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              ),
            },
            {
              key: "timeline",
              label: "Timeline",
              children: activitiesLoading ? (
                <div
                  style={{ display: "grid", placeItems: "center", padding: 40 }}
                >
                  <Spin size="small" />
                </div>
              ) : (activities ?? []).length === 0 ? (
                <EmptyState
                  compact
                  icon="history"
                  title="No activity yet"
                  description="Edits, stage moves, notes and tasks for this record show up here."
                />
              ) : (
                <Panel padding={0}>
                  {(activities ?? []).map((a, index) => {
                    const accent =
                      a.event === "created"
                        ? token.colorSuccess
                        : a.event === "deleted"
                          ? token.colorError
                          : a.event === "restored"
                            ? token.colorWarning
                            : a.event === "stage_changed"
                              ? token.colorPrimary
                              : token.colorTextTertiary;
                    const actor = userName(a.actor_id);
                    return (
                      <CrmListRow
                        key={a.id}
                        first={index === 0}
                        align="flex-start"
                      >
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 8,
                            flex: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: tint(accent, 0.12),
                          }}
                        >
                          <MIcon
                            name={ACTIVITY_ICONS[a.event] ?? "history"}
                            size={16}
                            color={accent}
                          />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              flexWrap: "wrap",
                              fontSize: 13,
                              lineHeight: 1.45,
                            }}
                          >
                            <EntityAvatar
                              name={actor}
                              kind="person"
                              size={18}
                            />
                            <span
                              style={{
                                fontWeight: 500,
                                color: token.colorText,
                              }}
                            >
                              {actor}
                            </span>
                            <span style={{ color: token.colorTextSecondary }}>
                              {activityText(a)}
                            </span>
                          </div>
                          <Tooltip title={crmDateTime(a.created_at)}>
                            <span
                              style={{
                                display: "inline-block",
                                marginTop: 2,
                                fontSize: 11.5,
                                color: token.colorTextTertiary,
                              }}
                            >
                              {crmFromNow(a.created_at)}
                            </span>
                          </Tooltip>
                        </div>
                      </CrmListRow>
                    );
                  })}
                </Panel>
              ),
            },
            {
              key: "tasks",
              label: <TabLabel count={linkedTasks.length}>Tasks</TabLabel>,
              children: (
                <div>
                  <Composer>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Input
                        variant="borderless"
                        placeholder="Add a task for this record…"
                        value={newTask}
                        onChange={(e) => setNewTask(e.target.value)}
                        onPressEnter={handleAddTask}
                        style={{ flex: 1, minWidth: 0, paddingInline: 4 }}
                      />
                      <Button
                        type="primary"
                        size="small"
                        onClick={handleAddTask}
                        loading={createTask.isPending}
                        disabled={!newTask.trim()}
                        icon={<MIcon name="add" size={16} />}
                      >
                        Add
                      </Button>
                    </div>
                  </Composer>

                  {linkedTasks.length === 0 ? (
                    <EmptyState
                      compact
                      icon="task_alt"
                      title="No tasks yet"
                      description="Anything you add above stays linked to this record and shows up on the CRM Tasks page."
                    />
                  ) : (
                    <Panel padding={0}>
                      {linkedTasks.map((t, index) => {
                        const done = t.status === "DONE";
                        return (
                          <CrmListRow
                            key={t.id}
                            first={index === 0}
                            align="flex-start"
                          >
                            <div
                              style={{
                                minWidth: 0,
                                flex: 1,
                                paddingTop: 2,
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 500,
                                  fontSize: 13,
                                  lineHeight: 1.45,
                                  color: done
                                    ? token.colorTextTertiary
                                    : token.colorText,
                                  textDecoration: done
                                    ? "line-through"
                                    : undefined,
                                  wordBreak: "break-word",
                                }}
                              >
                                {t.title}
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  lineHeight: 1.45,
                                  color: token.colorTextTertiary,
                                }}
                              >
                                {t.due_at
                                  ? `Due ${crmDate(t.due_at)} · ${userName(t.assignee_id)}`
                                  : userName(t.assignee_id)}
                              </div>
                            </div>
                            <Select
                              size="small"
                              value={t.status as CrmTaskStatus}
                              style={{ width: 124, flex: "none" }}
                              onChange={async (status) => {
                                try {
                                  await updateTask.mutateAsync({
                                    id: t.id,
                                    patch: { status },
                                  });
                                } catch (err) {
                                  message.error(
                                    errMsg(err, "Failed to update task."),
                                  );
                                }
                              }}
                              options={CRM_TASK_STATUSES.map((s) => ({
                                value: s.value,
                                label: s.label,
                              }))}
                            />
                            <RowActions
                              open={confirmTaskId === t.id}
                              style={{ flex: "none" }}
                            >
                              <Popconfirm
                                title="Delete this task?"
                                description="This cannot be undone — tasks have no Deleted bin."
                                okText="Delete"
                                okButtonProps={{ danger: true }}
                                onOpenChange={(open) =>
                                  setConfirmTaskId(open ? t.id : null)
                                }
                                onConfirm={async () => {
                                  try {
                                    await deleteTask.mutateAsync(t.id);
                                  } catch (err) {
                                    message.error(
                                      errMsg(err, "Failed to delete task."),
                                    );
                                  }
                                }}
                              >
                                <Tooltip title="Delete">
                                  <Button
                                    type="text"
                                    size="small"
                                    aria-label="Delete task"
                                    icon={<MIcon name="delete" size={16} />}
                                  />
                                </Tooltip>
                              </Popconfirm>
                            </RowActions>
                          </CrmListRow>
                        );
                      })}
                    </Panel>
                  )}
                </div>
              ),
            },
            {
              key: "notes",
              label: <TabLabel count={linkedNotes.length}>Notes</TabLabel>,
              children: (
                <div>
                  <Composer>
                    <Input
                      variant="borderless"
                      placeholder="Note title"
                      value={newNoteTitle}
                      onChange={(e) => setNewNoteTitle(e.target.value)}
                      style={{
                        paddingInline: 4,
                        fontWeight: 500,
                      }}
                    />
                    <Input.TextArea
                      variant="borderless"
                      placeholder="Write a note…"
                      value={newNoteBody}
                      onChange={(e) => setNewNoteBody(e.target.value)}
                      autoSize={{ minRows: 2, maxRows: 6 }}
                      style={{ paddingInline: 4 }}
                    />
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginTop: 6,
                      }}
                    >
                      <Button
                        type="primary"
                        size="small"
                        onClick={handleAddNote}
                        loading={createNote.isPending}
                        disabled={!newNoteTitle.trim()}
                        icon={<MIcon name="add" size={16} />}
                      >
                        Add note
                      </Button>
                    </div>
                  </Composer>

                  {linkedNotes.length === 0 ? (
                    <EmptyState
                      compact
                      icon="sticky_note_2"
                      title="No notes yet"
                      description="Capture a call recap or a decision — notes written here stay attached to this record."
                    />
                  ) : (
                    <Panel padding={0}>
                      {linkedNotes.map((n, index) => (
                        <CrmListRow
                          key={n.id}
                          first={index === 0}
                          align="flex-start"
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontWeight: 500,
                                fontSize: 13,
                                lineHeight: 1.45,
                                color: token.colorText,
                                wordBreak: "break-word",
                              }}
                            >
                              {n.title || "Untitled note"}
                            </div>
                            {n.body ? (
                              <Typography.Paragraph
                                type="secondary"
                                ellipsis={{ rows: 3, expandable: true }}
                                style={{
                                  margin: "4px 0 0",
                                  fontSize: 12.5,
                                  lineHeight: 1.55,
                                }}
                              >
                                {n.body}
                              </Typography.Paragraph>
                            ) : null}
                            <div
                              style={{
                                marginTop: 4,
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 11.5,
                                color: token.colorTextTertiary,
                              }}
                            >
                              <EntityAvatar
                                name={userName(n.created_by)}
                                kind="person"
                                size={16}
                              />
                              <span>{userName(n.created_by)}</span>
                              <span>·</span>
                              <Tooltip title={crmDateTime(n.created_at)}>
                                <span>{crmFromNow(n.created_at)}</span>
                              </Tooltip>
                            </div>
                          </div>
                          <RowActions
                            open={confirmNoteId === n.id}
                            style={{ flex: "none" }}
                          >
                            <Popconfirm
                              title="Delete this note?"
                              description="This cannot be undone — notes have no Deleted bin."
                              okText="Delete"
                              okButtonProps={{ danger: true }}
                              onOpenChange={(open) =>
                                setConfirmNoteId(open ? n.id : null)
                              }
                              onConfirm={async () => {
                                try {
                                  await deleteNote.mutateAsync(n.id);
                                } catch (err) {
                                  message.error(
                                    errMsg(err, "Failed to delete note."),
                                  );
                                }
                              }}
                            >
                              <Tooltip title="Delete">
                                <Button
                                  type="text"
                                  size="small"
                                  aria-label="Delete note"
                                  icon={<MIcon name="delete" size={16} />}
                                />
                              </Tooltip>
                            </Popconfirm>
                          </RowActions>
                        </CrmListRow>
                      ))}
                    </Panel>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}
