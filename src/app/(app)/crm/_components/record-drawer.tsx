"use client";

import { useMemo, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  List,
  Popconfirm,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
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

// `relativeTime` powers the "x ago" labels in the Timeline tab.
dayjs.extend(relativeTime);

const TYPE_META: Record<
  CrmTargetRef["type"],
  { label: string; icon: string; color: string }
> = {
  person: { label: "Person", icon: "person", color: "#0ea5e9" },
  company: { label: "Company", icon: "domain", color: "#6366f1" },
  deal: { label: "Deal", icon: "target", color: "#14b8a6" },
};

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
  const { data: people } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const { data: deals } = useCrmDeals();
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

  const overviewItems = useMemo(() => {
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
          key: "li",
          label: "LinkedIn",
          children: p.linkedin_url ? (
            <a href={p.linkedin_url} target="_blank" rel="noreferrer">
              {p.linkedin_url}
            </a>
          ) : (
            "—"
          ),
        },
        {
          key: "created",
          label: "Created",
          children: dayjs(p.created_at).format("DD MMM YYYY"),
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
          children: c.icp ? <Tag color="green">Ideal customer</Tag> : "—",
        },
        {
          key: "owner",
          label: "Account owner",
          children: c.account_owner_id ? userName(c.account_owner_id) : "—",
        },
        { key: "address", label: "Address", children: address || "—" },
        {
          key: "li",
          label: "LinkedIn",
          children: c.linkedin_url ? (
            <a href={c.linkedin_url} target="_blank" rel="noreferrer">
              {c.linkedin_url}
            </a>
          ) : (
            "—"
          ),
        },
        {
          key: "created",
          label: "Created",
          children: dayjs(c.created_at).format("DD MMM YYYY"),
        },
      ];
    }
    const d = record as CrmDealWithRefs;
    const stage = (stages ?? []).find((s) => s.id === d.stage_id);
    return [
      {
        key: "amount",
        label: "Amount",
        children: crmMoney(d.amount, d.currency_code),
      },
      {
        key: "stage",
        label: "Stage",
        children: stage ? (
          <Tag color={stage.color}>{stage.name}</Tag>
        ) : (
          <Tag>No stage</Tag>
        ),
      },
      {
        key: "close",
        label: "Close date",
        children: d.close_date ? dayjs(d.close_date).format("DD MMM YYYY") : "—",
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
        children: dayjs(d.created_at).format("DD MMM YYYY"),
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

  const meta = target ? TYPE_META[target.type] : null;

  return (
    <Drawer
      open={Boolean(target)}
      onClose={onClose}
      width={560}
      destroyOnHidden
      title={
        meta ? (
          <Space>
            <Avatar
              size={28}
              style={{ backgroundColor: meta.color }}
              icon={<MIcon name={meta.icon} size={16} color="#fff" />}
            />
            <span>{title || "Record"}</span>
            <Tag>{meta.label}</Tag>
          </Space>
        ) : null
      }
    >
      {!record ? (
        <Empty description="This record no longer exists." />
      ) : (
        <Tabs
          defaultActiveKey="overview"
          items={[
            {
              key: "overview",
              label: "Overview",
              children: (
                <Descriptions
                  column={1}
                  size="small"
                  bordered
                  items={overviewItems}
                />
              ),
            },
            {
              key: "timeline",
              label: "Timeline",
              children: (
                <List
                  loading={activitiesLoading}
                  dataSource={activities ?? []}
                  locale={{ emptyText: "No activity yet." }}
                  renderItem={(a) => (
                    <List.Item style={{ paddingInline: 0 }}>
                      <List.Item.Meta
                        avatar={
                          <MIcon
                            name={ACTIVITY_ICONS[a.event] ?? "history"}
                            size={20}
                            color="#8c8c8c"
                            style={{ marginTop: 4 }}
                          />
                        }
                        title={
                          <Typography.Text style={{ fontWeight: 500 }}>
                            {userName(a.actor_id)}{" "}
                            <Typography.Text type="secondary">
                              {activityText(a)}
                            </Typography.Text>
                          </Typography.Text>
                        }
                        description={dayjs(a.created_at).fromNow()}
                      />
                    </List.Item>
                  )}
                />
              ),
            },
            {
              key: "tasks",
              label: `Tasks (${linkedTasks.length})`,
              children: (
                <div>
                  <Space.Compact style={{ width: "100%", marginBottom: 12 }}>
                    <Input
                      placeholder="Add a task for this record…"
                      value={newTask}
                      onChange={(e) => setNewTask(e.target.value)}
                      onPressEnter={handleAddTask}
                    />
                    <Button
                      type="primary"
                      onClick={handleAddTask}
                      loading={createTask.isPending}
                    >
                      Add
                    </Button>
                  </Space.Compact>
                  <List
                    dataSource={linkedTasks}
                    locale={{ emptyText: "No tasks linked to this record." }}
                    renderItem={(t) => (
                      <List.Item
                        style={{ paddingInline: 0 }}
                        actions={[
                          <Select
                            key="status"
                            size="small"
                            value={t.status as CrmTaskStatus}
                            style={{ width: 130 }}
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
                          />,
                          <Popconfirm
                            key="delete"
                            title="Delete this task?"
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
                            <Button
                              type="text"
                              size="small"
                              icon={<MIcon name="delete" size={16} />}
                            />
                          </Popconfirm>,
                        ]}
                      >
                        <List.Item.Meta
                          title={
                            <Typography.Text
                              delete={t.status === "DONE"}
                              style={{ fontWeight: 500 }}
                            >
                              {t.title}
                            </Typography.Text>
                          }
                          description={
                            t.due_at
                              ? `Due ${dayjs(t.due_at).format("DD MMM YYYY")} · ${userName(t.assignee_id)}`
                              : userName(t.assignee_id)
                          }
                        />
                      </List.Item>
                    )}
                  />
                </div>
              ),
            },
            {
              key: "notes",
              label: `Notes (${linkedNotes.length})`,
              children: (
                <div>
                  <Space
                    direction="vertical"
                    style={{ width: "100%", marginBottom: 12 }}
                  >
                    <Input
                      placeholder="Note title"
                      value={newNoteTitle}
                      onChange={(e) => setNewNoteTitle(e.target.value)}
                    />
                    <Input.TextArea
                      placeholder="Write a note…"
                      value={newNoteBody}
                      onChange={(e) => setNewNoteBody(e.target.value)}
                      autoSize={{ minRows: 2, maxRows: 6 }}
                    />
                    <Button
                      type="primary"
                      onClick={handleAddNote}
                      loading={createNote.isPending}
                      disabled={!newNoteTitle.trim()}
                    >
                      Add note
                    </Button>
                  </Space>
                  <List
                    dataSource={linkedNotes}
                    locale={{ emptyText: "No notes linked to this record." }}
                    renderItem={(n) => (
                      <List.Item
                        style={{ paddingInline: 0 }}
                        actions={[
                          <Popconfirm
                            key="delete"
                            title="Delete this note?"
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
                            <Button
                              type="text"
                              size="small"
                              icon={<MIcon name="delete" size={16} />}
                            />
                          </Popconfirm>,
                        ]}
                      >
                        <List.Item.Meta
                          title={n.title || "Untitled note"}
                          description={
                            <div>
                              {n.body ? (
                                <Typography.Paragraph
                                  type="secondary"
                                  ellipsis={{ rows: 3, expandable: true }}
                                  style={{ marginBottom: 4 }}
                                >
                                  {n.body}
                                </Typography.Paragraph>
                              ) : null}
                              <Typography.Text
                                type="secondary"
                                style={{ fontSize: 12 }}
                              >
                                {userName(n.created_by)} ·{" "}
                                {dayjs(n.created_at).fromNow()}
                              </Typography.Text>
                            </div>
                          }
                        />
                      </List.Item>
                    )}
                  />
                </div>
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}
