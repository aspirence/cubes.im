"use client";

import { useMemo, useRef, useState } from "react";
import { App, DatePicker, Form, Input, Modal, Select, Typography, theme } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useAuth } from "@/features/auth/use-auth";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useCreateCrmTask } from "@/features/app-crm/use-crm-tasks";
import { useCreateCrmNote } from "@/features/app-crm/use-crm-notes";
import { useCreateCrmReminder } from "@/features/app-crm/use-crm-reminders";
import { useUpdateCrmDeal } from "@/features/app-crm/use-crm-deals";
import { useCrmStages } from "@/features/app-crm/use-crm-stages";
import { CRM_LEAD_STATUSES, crmLeadStatusMeta, type CrmLeadStatus, type CrmTargetRef } from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "./m-icon";
import { leadStatusIcon, entityMeta } from "./entity-meta";
import { CRM_REMIND_AT_FORMAT, crmDefaultRemindAt, crmDisabledRemindDate, crmReminderPresets } from "./reminder-controls";
import type { CrmMenuItem } from "./data-table";
import { NO_PROJECT, useCrmScope, useScopeMismatchNotice } from "../_lib/crm-scope";
import { CRM_RECORD_PARAM } from "../_lib/record-deep-link";

/**
 * The right-click menu every CRM record shares — a deal, a person or a
 * company, in a table row or on a board card:
 *
 *   Open · Edit…
 *   (the page's own items: status, stage, project…)
 *   New task… · Add note… · Remind me ▸
 *   Send email · Call · Open website · Copy ▸
 *   (the page's destructive items: delete, restore…)
 *
 * `useRecordMenu()` returns `build(spec)` for the items and `dialogs`, the
 * quick New task / Add note / Remind me dialogs those items open — render
 * `dialogs` once per page, outside any row or card. The quick dialogs link
 * what they create to the record, so it shows in the record's drawer and in
 * the Tasks / Notes / Reminders pages under the record's project.
 *
 * `useDealMenuItems()` and `useProjectMoveItem()` build the Status, Stage and
 * "Move to project" submenus the deal, person and company menus add.
 */

export interface RecordMenuSpec {
  target: CrmTargetRef;
  /** The record's display name: dialog headers and "Copy name". */
  name: string;
  onOpen?: () => void;
  onEdit?: () => void;
  email?: string | null;
  phone?: string | null;
  /** A company's domain or a URL. */
  website?: string | null;
  linkedin?: string | null;
  /**
   * Send email / Call / Open website / Open LinkedIn. Defaults to
   * `canCreate` — a deleted record keeps Copy ▸ Email/Phone but not these.
   */
  contactActions?: boolean;
  /** False leaves out "Remind me" (surfaces that offer their own snooze). */
  remind?: boolean;
  /** The page's own items, after Open/Edit (status, stage, project…). */
  manage?: CrmMenuItem[];
  /** Destructive items, last (delete, restore, delete forever). */
  danger?: CrmMenuItem[];
  /** False for a deleted record: nothing new is attached to it. */
  canCreate?: boolean;
}

type Dialog =
  | { kind: "task"; target: CrmTargetRef; name: string }
  | { kind: "note"; target: CrmTargetRef; name: string }
  | { kind: "reminder"; target: CrmTargetRef; name: string };

/** Where each record type's page lives, for "Copy link" (`?m=` opens its drawer). */
const RECORD_PAGE: Record<CrmTargetRef["type"], string> = {
  deal: "/crm/deals",
  person: "/crm/people",
  company: "/crm/companies",
};

function websiteUrl(site: string): string {
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

/** The tel: target: digits and a leading +, with any extension ("x12", "ext. 12", ";12") dropped. */
function telHref(phone: string): string {
  const main = phone.split(/\s*(?:ext\.?|extension|x|;|,)\s*\d*$/i)[0] ?? phone;
  return `tel:${main.replace(/[^\d+]/g, "")}`;
}

/** How a reminder time reads in the CRM's toasts (24-hour, like the picker). */
const REMIND_TOAST_FORMAT = "ddd D MMM, HH:mm";

export function useRecordMenu() {
  const { message } = App.useApp();
  const createReminder = useCreateCrmReminder();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const copy = (text: string, what: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      message.error("Copying needs a secure (https) page.");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => message.success(`${what} copied.`),
      () => message.error(`Couldn't copy the ${what.toLowerCase()}.`),
    );
  };

  const remind = async (target: CrmTargetRef, at: Dayjs) => {
    try {
      await createReminder.mutateAsync({
        target_type: target.type,
        target_id: target.id,
        remind_at: at.toISOString(),
      });
      message.success(`Reminder set for ${at.format(REMIND_TOAST_FORMAT)}.`);
    } catch (err) {
      message.error(errMsg(err, "Couldn't set the reminder."));
    }
  };

  const openDialog = (kind: Dialog["kind"], target: CrmTargetRef, name: string) => setDialog({ kind, target, name });

  const build = (spec: RecordMenuSpec): CrmMenuItem[] => {
    const { target, name } = spec;
    const canCreate = spec.canCreate ?? true;
    const contact = spec.contactActions ?? canCreate;
    const copyItems: CrmMenuItem[] = [
      { key: "name", label: "Name", icon: "badge", onSelect: () => copy(name, "Name") },
      ...(spec.email ? [{ key: "email", label: "Email", icon: "mail", extra: spec.email, onSelect: () => copy(spec.email as string, "Email") }] : []),
      ...(spec.phone ? [{ key: "phone", label: "Phone", icon: "call", extra: spec.phone, onSelect: () => copy(spec.phone as string, "Phone") }] : []),
      ...(spec.website ? [{ key: "website", label: "Website", icon: "language", onSelect: () => copy(spec.website as string, "Website") }] : []),
      ...(spec.linkedin ? [{ key: "linkedin", label: "LinkedIn", icon: "person_pin", onSelect: () => copy(spec.linkedin as string, "LinkedIn link") }] : []),
      {
        key: "link",
        label: "Link to this record",
        icon: "link",
        onSelect: () => copy(`${window.location.origin}${RECORD_PAGE[target.type]}?${CRM_RECORD_PARAM}=${target.id}`, "Link"),
      },
    ];
    const presets = crmReminderPresets();

    return [
      ...(spec.onOpen ? [{ key: "open", label: "Open", icon: "open_in_new", onSelect: spec.onOpen }] : []),
      ...(spec.onEdit ? [{ key: "edit", label: "Edit…", icon: "edit", onSelect: spec.onEdit }] : []),
      { type: "divider" },
      ...(spec.manage ?? []),
      { type: "divider" },
      ...(canCreate
        ? ([
            { key: "task", label: "New task…", icon: "add_task", onSelect: () => openDialog("task", target, name) },
            { key: "note", label: "Add note…", icon: "sticky_note_2", onSelect: () => openDialog("note", target, name) },
            ...(spec.remind === false
              ? []
              : [
                  {
                    key: "remind",
                    label: "Remind me",
                    icon: "alarm",
                    children: [
                      ...presets.map((p) => ({
                        key: p.key,
                        label: p.label,
                        extra: p.key === "hour" ? p.at.format("HH:mm") : p.at.format("ddd D MMM, HH:mm"),
                        onSelect: () => void remind(target, p.at),
                      })),
                      { type: "divider" as const },
                      { key: "custom", label: "Pick a time…", icon: "edit_calendar", onSelect: () => openDialog("reminder", target, name) },
                    ],
                  },
                ]),
          ] satisfies CrmMenuItem[])
        : []),
      { type: "divider" },
      ...(contact && spec.email ? [{ key: "mailto", label: "Send email", icon: "mail", onSelect: () => window.open(`mailto:${spec.email}`, "_self") }] : []),
      ...(contact && spec.phone ? [{ key: "tel", label: "Call", icon: "call", onSelect: () => window.open(telHref(spec.phone as string), "_self") }] : []),
      ...(contact && spec.website
        ? [{ key: "site", label: "Open website", icon: "language", onSelect: () => window.open(websiteUrl(spec.website as string), "_blank", "noopener,noreferrer") }]
        : []),
      ...(contact && spec.linkedin
        ? [{ key: "linkedin", label: "Open LinkedIn", icon: "person_pin", onSelect: () => window.open(websiteUrl(spec.linkedin as string), "_blank", "noopener,noreferrer") }]
        : []),
      { key: "copy", label: "Copy", icon: "content_copy", children: copyItems },
      { type: "divider" },
      ...(spec.danger ?? []),
    ];
  };

  const dialogs = (
    <>
      <QuickTaskDialog dialog={dialog?.kind === "task" ? dialog : null} onClose={() => setDialog(null)} />
      <QuickNoteDialog dialog={dialog?.kind === "note" ? dialog : null} onClose={() => setDialog(null)} />
      <QuickReminderDialog dialog={dialog?.kind === "reminder" ? dialog : null} onClose={() => setDialog(null)} />
    </>
  );

  return { build, dialogs, openDialog };
}

/* ------------------------------------------------------- deal submenus */

/**
 * Status and Stage submenus for a deal — the same writes as the status chip
 * and the drawer's Stage field (a plain update; the board orders by position
 * within the stage, and the drawer moves stages the same way).
 */
export function useDealMenuItems() {
  const { message } = App.useApp();
  const updateDeal = useUpdateCrmDeal();
  const { data: stages } = useCrmStages();

  const save = async (id: string, patch: { status?: CrmLeadStatus; stage_id?: string | null }, done: string) => {
    try {
      await updateDeal.mutateAsync({ id, patch });
      message.success(done);
    } catch (err) {
      message.error(errMsg(err, "Couldn't update the deal."));
    }
  };

  const status = (deal: { id: string; status: string | null }): CrmMenuItem => {
    const current = crmLeadStatusMeta(deal.status);
    return {
      key: "status",
      label: "Status",
      icon: "flag",
      extra: current.label,
      children: CRM_LEAD_STATUSES.map((s) => ({
        key: s.value,
        label: s.label,
        icon: leadStatusIcon(s.value),
        checked: s.value === current.value,
        onSelect: s.value === current.value ? undefined : () => void save(deal.id, { status: s.value }, `Status: ${s.label}.`),
      })),
    };
  };

  const stage = (deal: { id: string; stage_id: string | null }): CrmMenuItem => {
    const list = stages ?? [];
    const current = list.find((s) => s.id === deal.stage_id) ?? null;
    return {
      key: "stage",
      label: "Stage",
      icon: "view_kanban",
      extra: current?.name ?? "No stage",
      disabled: list.length === 0,
      children: [
        ...list.map((s) => ({
          key: s.id,
          label: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color ?? "#999", flex: "none" }} />
              {s.name}
            </span>
          ),
          checked: s.id === deal.stage_id,
          onSelect: s.id === deal.stage_id ? undefined : () => void save(deal.id, { stage_id: s.id }, `Moved to ${s.name}.`),
        })),
        { type: "divider" as const },
        {
          key: "none",
          label: "No stage",
          checked: deal.stage_id === null,
          onSelect: deal.stage_id === null ? undefined : () => void save(deal.id, { stage_id: null }, "Stage cleared."),
        },
      ],
    };
  };

  return { status, stage };
}

/* ------------------------------------------------------ project move */

/**
 * "Move to project ▸": the workspace's projects A–Z (the current one ticked)
 * and "No project". `onMove` performs the write (each record type has its own
 * update); a record moved out of the project on screen is announced the same
 * way the drawer's Project field announces it.
 */
export function useProjectMoveItem() {
  const { message } = App.useApp();
  const { projects, inScope } = useCrmScope();
  const notify = useScopeMismatchNotice();

  return (input: {
    current: string | null;
    /** "Deal", "Person", "Company" — for the notice. */
    noun: string;
    onMove: (projectId: string | null) => Promise<unknown>;
  }): CrmMenuItem => {
    const move = async (projectId: string | null) => {
      try {
        await input.onMove(projectId);
        // Moved out of the view on screen: the scope notice says where it went
        // (with Switch) — one message, as the drawer's Project field does.
        if (!inScope(projectId)) {
          notify({ recordProjectId: projectId, noun: input.noun, verb: "moved to" });
          return;
        }
        const name = projectId ? (projects.find((p) => p.id === projectId)?.name ?? "the project") : "no project";
        message.success(`Moved to ${name}.`);
      } catch (err) {
        message.error(errMsg(err, "Couldn't move it."));
      }
    };
    return {
      key: "project",
      label: "Move to project",
      icon: "drive_file_move",
      extra: input.current ? (projects.find((p) => p.id === input.current)?.name ?? undefined) : "No project",
      children: [
        ...projects.map((p) => ({
          key: p.id,
          label: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: p.color ?? "#999", flex: "none" }} />
              {p.name}
            </span>
          ),
          checked: p.id === input.current,
          onSelect: p.id === input.current ? undefined : () => void move(p.id),
        })),
        { type: "divider" as const },
        {
          key: NO_PROJECT,
          label: "No project",
          icon: "folder_off",
          checked: input.current === null,
          onSelect: input.current === null ? undefined : () => void move(null),
        },
      ],
    };
  };
}

/* ------------------------------------------------------------ dialogs */

function LinkedTo({ target, name }: { target: CrmTargetRef; name: string }) {
  const { token } = theme.useToken();
  const meta = entityMeta(target.type);
  return (
    <Typography.Text type="secondary" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 14 }}>
      <MIcon name={meta.icon} size={16} color={meta.color ?? token.colorTextTertiary} />
      For <Typography.Text strong>{name}</Typography.Text>
    </Typography.Text>
  );
}

interface TaskValues {
  title: string;
  due_at?: Dayjs | null;
  assignee_id?: string | null;
  body?: string;
}

function QuickTaskDialog({ dialog, onClose }: { dialog: Extract<Dialog, { kind: "task" }> | null; onClose: () => void }) {
  const { message } = App.useApp();
  const { user } = useAuth();
  const { data: members } = useTeamMembers();
  const createTask = useCreateCrmTask();
  const [form] = Form.useForm<TaskValues>();

  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.active && m.user)
        .map((m) => ({ value: m.user!.id, label: m.user!.id === user?.id ? `${m.user!.name} (you)` : m.user!.name })),
    [members, user?.id],
  );

  const busy = useRef(false);
  const submit = async (values: TaskValues) => {
    if (!dialog || busy.current) return;
    busy.current = true;
    try {
      await createTask.mutateAsync({
        title: values.title.trim(),
        body: values.body?.trim() || null,
        status: "TODO",
        // Due BY the end of that day — a task due "today" isn't overdue the
        // moment it's saved (the Tasks page's own due choices do the same).
        due_at: values.due_at ? values.due_at.endOf("day").toISOString() : null,
        assignee_id: values.assignee_id ?? null,
        targets: [dialog.target],
      });
      message.success("Task created.");
      onClose();
    } catch (err) {
      message.error(errMsg(err, "Couldn't create the task."));
    } finally {
      busy.current = false;
    }
  };

  return (
    <Modal
      open={dialog !== null}
      title="New task"
      okText="Create task"
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={createTask.isPending}
      // No closing while it saves: a slow save must not close a dialog opened
      // for another record afterwards.
      closable={!createTask.isPending}
      maskClosable={!createTask.isPending}
      keyboard={!createTask.isPending}
      cancelButtonProps={{ disabled: createTask.isPending }}
      destroyOnHidden
      width={460}
      afterOpenChange={(open) => {
        if (open) form.getFieldInstance("title")?.focus?.();
      }}
    >
      {dialog ? <LinkedTo target={dialog.target} name={dialog.name} /> : null}
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        preserve={false}
        initialValues={{ assignee_id: user?.id ?? null }}
        requiredMark={false}
      >
        <Form.Item name="title" label="Title" rules={[{ required: true, whitespace: true, message: "Give the task a title" }]}>
          <Input placeholder="What needs doing?" maxLength={200} />
        </Form.Item>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Form.Item name="due_at" label="Due date">
            <DatePicker
              style={{ width: "100%" }}
              format="D MMM YYYY"
              presets={[
                { label: "Today", value: dayjs() },
                { label: "Tomorrow", value: dayjs().add(1, "day") },
                { label: "Next week", value: dayjs().add(7, "day") },
              ]}
            />
          </Form.Item>
          <Form.Item name="assignee_id" label="Assignee">
            <Select allowClear showSearch optionFilterProp="label" options={memberOptions} placeholder="Unassigned" />
          </Form.Item>
        </div>
        <Form.Item name="body" label="Details" style={{ marginBottom: 0 }}>
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="Optional" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface NoteValues {
  title: string;
  body?: string;
}

function QuickNoteDialog({ dialog, onClose }: { dialog: Extract<Dialog, { kind: "note" }> | null; onClose: () => void }) {
  const { message } = App.useApp();
  const createNote = useCreateCrmNote();
  const [form] = Form.useForm<NoteValues>();

  const busy = useRef(false);
  const submit = async (values: NoteValues) => {
    if (!dialog || busy.current) return;
    busy.current = true;
    try {
      await createNote.mutateAsync({
        title: values.title.trim(),
        body: values.body?.trim() || null,
        targets: [dialog.target],
      });
      message.success("Note added.");
      onClose();
    } catch (err) {
      message.error(errMsg(err, "Couldn't add the note."));
    } finally {
      busy.current = false;
    }
  };

  return (
    <Modal
      open={dialog !== null}
      title="Add note"
      okText="Add note"
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={createNote.isPending}
      closable={!createNote.isPending}
      maskClosable={!createNote.isPending}
      keyboard={!createNote.isPending}
      cancelButtonProps={{ disabled: createNote.isPending }}
      destroyOnHidden
      width={500}
      afterOpenChange={(open) => {
        if (open) form.getFieldInstance("title")?.focus?.();
      }}
    >
      {dialog ? <LinkedTo target={dialog.target} name={dialog.name} /> : null}
      <Form form={form} layout="vertical" onFinish={submit} preserve={false} requiredMark={false}>
        <Form.Item name="title" label="Title" rules={[{ required: true, whitespace: true, message: "Give the note a title" }]}>
          <Input
            placeholder="Call summary, next steps…"
            maxLength={200}
            // Enter moves on to the note itself instead of saving a title-only note.
            onPressEnter={(e) => {
              e.preventDefault();
              form.getFieldInstance("body")?.focus?.();
            }}
          />
        </Form.Item>
        <Form.Item name="body" label="Note" style={{ marginBottom: 0 }}>
          <Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} placeholder="Write it down while it's fresh" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface ReminderValues {
  remind_at: Dayjs;
  note?: string;
}

function QuickReminderDialog({ dialog, onClose }: { dialog: Extract<Dialog, { kind: "reminder" }> | null; onClose: () => void }) {
  const { message } = App.useApp();
  const createReminder = useCreateCrmReminder();
  const [form] = Form.useForm<ReminderValues>();

  const busy = useRef(false);
  const submit = async (values: ReminderValues) => {
    if (!dialog || busy.current) return;
    busy.current = true;
    try {
      await createReminder.mutateAsync({
        target_type: dialog.target.type,
        target_id: dialog.target.id,
        remind_at: values.remind_at.toISOString(),
        note: values.note?.trim() || null,
      });
      message.success(`Reminder set for ${values.remind_at.format(REMIND_TOAST_FORMAT)}.`);
      onClose();
    } catch (err) {
      message.error(errMsg(err, "Couldn't set the reminder."));
    } finally {
      busy.current = false;
    }
  };

  return (
    <Modal
      open={dialog !== null}
      title="Remind me"
      okText="Set reminder"
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={createReminder.isPending}
      closable={!createReminder.isPending}
      maskClosable={!createReminder.isPending}
      keyboard={!createReminder.isPending}
      cancelButtonProps={{ disabled: createReminder.isPending }}
      destroyOnHidden
      width={440}
    >
      {dialog ? <LinkedTo target={dialog.target} name={dialog.name} /> : null}
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        preserve={false}
        initialValues={{ remind_at: crmDefaultRemindAt() }}
        requiredMark={false}
      >
        <Form.Item name="remind_at" label="When" rules={[{ required: true, message: "Pick a time" }]}>
          <DatePicker
            style={{ width: "100%" }}
            showTime={{ format: "HH:mm", minuteStep: 5 }}
            format={CRM_REMIND_AT_FORMAT}
            disabledDate={crmDisabledRemindDate}
            allowClear={false}
          />
        </Form.Item>
        <Form.Item name="note" label="About" style={{ marginBottom: 0 }}>
          <Input placeholder="What should we remind you about?" maxLength={200} onPressEnter={() => form.submit()} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
