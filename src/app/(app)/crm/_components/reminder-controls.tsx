"use client";

/**
 * "Remind me about this record at this time."
 *
 * Reminders are deliberately NOT CRM tasks: a task is work the team can see and
 * hand around, a reminder is a private nudge that fires a real notification
 * (`crm_fire_due_reminders()` sweeps every five minutes). These two controls are
 * the whole surface — the record drawer's Reminders tab and anywhere else a
 * record can be nudged from use them unchanged.
 */

import { useMemo, useState } from "react";
import {
  App,
  Button,
  DatePicker,
  Input,
  Popconfirm,
  Popover,
  Spin,
  Tooltip,
  theme,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useAuth } from "@/features/auth/use-auth";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import {
  useCompleteCrmReminder,
  useCreateCrmReminder,
  useDeleteCrmReminder,
  useRecordReminders,
  useUpdateCrmReminder,
} from "@/features/app-crm/use-crm-reminders";
import type { CrmReminder, CrmTargetRef } from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "./m-icon";
import { CrmListRow } from "./list-row";
import {
  EmptyState,
  EntityAvatar,
  Panel,
  RowActions,
  SoftChip,
  crmDateTime,
  crmFromNow,
  tint,
} from "../_lib/ui";

/**
 * The nudge everyone actually wants: tomorrow morning. Shared with the quick
 * deal dialog so "remind me to follow up" means the same thing everywhere.
 */
export function crmDefaultRemindAt(): Dayjs {
  return dayjs().add(1, "day").hour(10).minute(0).second(0).millisecond(0);
}

/** The picker format — same shape as `crmDateTime`, so set and shown agree. */
export const CRM_REMIND_AT_FORMAT = "DD MMM YYYY, HH:mm";

/**
 * Every reminder picker in the product refuses a day that has already gone.
 * The sweep runs every five minutes, so a fat-fingered year isn't a harmless
 * typo — it fires a notification almost immediately, for a nudge nobody wanted.
 */
export function crmDisabledRemindDate(current: Dayjs): boolean {
  return current.isBefore(dayjs(), "day");
}

/** Open (undismissed) reminders, soonest first. */
export function openReminders(
  reminders: CrmReminder[] | undefined,
): CrmReminder[] {
  return (reminders ?? []).filter((r) => !r.done_at);
}

/** Is this reminder already past its time and still undismissed? */
export function isReminderOverdue(reminder: CrmReminder): boolean {
  return !reminder.done_at && dayjs(reminder.remind_at).isBefore(dayjs());
}

/** Resolves `user_id` to a display name, with "You" for the signed-in user. */
function useReminderRecipientName() {
  const { user } = useAuth();
  const { data: members } = useTeamMembers();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) {
      if (m.user) map.set(m.user.id, m.user.name);
    }
    return (id: string | null | undefined) => {
      if (id && user?.id === id) return "You";
      return (id && map.get(id)) || "Someone";
    };
  }, [members, user?.id]);
}

/**
 * The compact "nudge me" row: when, an optional note, Add. Defaults to tomorrow
 * at 10:00 so the common case is one click.
 */
export function ReminderQuickAdd({ target }: { target: CrmTargetRef }) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const createReminder = useCreateCrmReminder();

  const [remindAt, setRemindAt] = useState<Dayjs | null>(crmDefaultRemindAt());
  const [note, setNote] = useState("");

  const handleAdd = async () => {
    if (!remindAt) return;
    try {
      await createReminder.mutateAsync({
        target_type: target.type,
        target_id: target.id,
        remind_at: remindAt.toISOString(),
        note: note.trim() || null,
      });
      setNote("");
      setRemindAt(crmDefaultRemindAt());
      message.success("Reminder set.");
    } catch (err) {
      message.error(errMsg(err, "Failed to set reminder."));
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
        padding: 8,
        borderRadius: 10,
        background: token.colorFillQuaternary,
        border: `1px solid ${token.colorBorderSecondary}`,
        marginBottom: 10,
      }}
    >
      <DatePicker
        size="small"
        value={remindAt}
        onChange={(value) => setRemindAt(value ?? null)}
        showTime={{ format: "HH:mm", minuteStep: 5 }}
        format={CRM_REMIND_AT_FORMAT}
        disabledDate={crmDisabledRemindDate}
        allowClear={false}
        placeholder="When?"
        style={{ width: 186, flex: "none" }}
        suffixIcon={
          <MIcon name="alarm" size={15} color={token.colorTextTertiary} />
        }
      />
      <Input
        size="small"
        variant="borderless"
        placeholder="What should we remind you about?"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onPressEnter={handleAdd}
        maxLength={200}
        style={{ flex: 1, minWidth: 140, paddingInline: 4 }}
      />
      <Button
        type="primary"
        size="small"
        onClick={handleAdd}
        loading={createReminder.isPending}
        disabled={!remindAt}
        icon={<MIcon name="add" size={16} />}
        style={{ flex: "none" }}
      >
        Add
      </Button>
    </div>
  );
}

/**
 * "Push this to Friday" — a one-control reschedule, so moving a nudge doesn't
 * mean deleting it and retyping the note.
 *
 * The hook behind it also clears `notified_at`, which is the part that matters:
 * the sweep skips anything already stamped, so a reminder moved forward without
 * that reset would go quiet forever. Used by the record drawer's list and by the
 * Reminders page, which is why it lives here rather than in either of them.
 */
export function ReminderReschedule({ reminder }: { reminder: CrmReminder }) {
  const { message } = App.useApp();
  const updateReminder = useUpdateCrmReminder();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<Dayjs | null>(null);

  const save = async () => {
    if (!value) return;
    try {
      await updateReminder.mutateAsync({
        id: reminder.id,
        remind_at: value.toISOString(),
      });
      setOpen(false);
      message.success(`Moved to ${crmDateTime(value.toISOString())}.`);
    } catch (err) {
      message.error(errMsg(err, "Failed to reschedule."));
    }
  };

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Re-seed from the stored time each time it opens, so a cancelled
        // reschedule never leaves a stale value behind.
        if (next) setValue(dayjs(reminder.remind_at));
      }}
      title="Reschedule"
      content={
        <div style={{ display: "flex", gap: 8 }}>
          <DatePicker
            value={value}
            onChange={(next) => setValue(next)}
            showTime={{ format: "HH:mm", minuteStep: 5 }}
            format={CRM_REMIND_AT_FORMAT}
            disabledDate={crmDisabledRemindDate}
            allowClear={false}
            style={{ width: 196 }}
          />
          <Button
            type="primary"
            onClick={save}
            loading={updateReminder.isPending}
            disabled={!value}
          >
            Save
          </Button>
        </div>
      }
    >
      <Button
        type="text"
        size="small"
        title="Reschedule"
        aria-label="Reschedule reminder"
        icon={<MIcon name="edit_calendar" size={16} />}
      />
    </Popover>
  );
}

/**
 * This record's reminders — open ones first (soonest at the top), dismissed ones
 * after, so the list answers "what is still coming" before "what did I clear".
 */
export function ReminderList({ target }: { target: CrmTargetRef }) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { data: reminders, isLoading } = useRecordReminders(
    target.type,
    target.id,
  );
  const completeReminder = useCompleteCrmReminder();
  const deleteReminder = useDeleteCrmReminder();
  const recipientName = useReminderRecipientName();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = reminders ?? [];
    // The hook already sorts remind_at ASC; only the done/open split is ours.
    return [
      ...all.filter((r) => !r.done_at),
      ...all.filter((r) => r.done_at).reverse(),
    ];
  }, [reminders]);

  if (isLoading) {
    return (
      <div style={{ display: "grid", placeItems: "center", padding: 40 }}>
        <Spin size="small" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon="alarm"
        title="No reminders yet"
        description="Set one above and we'll notify you when it's due — reminders are yours alone, unlike tasks the whole team works."
      />
    );
  }

  const markDone = async (id: string) => {
    try {
      await completeReminder.mutateAsync(id);
    } catch (err) {
      message.error(errMsg(err, "Failed to update reminder."));
    }
  };

  return (
    <Panel padding={0}>
      {rows.map((r, index) => {
        const done = Boolean(r.done_at);
        const overdue = isReminderOverdue(r);
        const accent = done
          ? token.colorSuccess
          : overdue
            ? token.colorError
            : token.colorPrimary;
        return (
          <CrmListRow key={r.id} first={index === 0} align="flex-start">
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
                name={done ? "alarm_on" : "alarm"}
                size={16}
                color={accent}
              />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontWeight: 500,
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: done
                    ? token.colorTextTertiary
                    : overdue
                      ? token.colorError
                      : token.colorText,
                  textDecoration: done ? "line-through" : undefined,
                }}
              >
                {crmDateTime(r.remind_at)}
              </div>
              {r.note ? (
                <div
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    color: token.colorTextSecondary,
                    wordBreak: "break-word",
                  }}
                >
                  {r.note}
                </div>
              ) : null}
              <div
                style={{
                  marginTop: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                  fontSize: 11.5,
                  color: token.colorTextTertiary,
                }}
              >
                <EntityAvatar
                  name={recipientName(r.user_id)}
                  kind="person"
                  size={16}
                />
                <span>For {recipientName(r.user_id)}</span>
                <span>·</span>
                {done ? (
                  <SoftChip tone="success" style={{ height: 18 }}>
                    Done
                  </SoftChip>
                ) : overdue ? (
                  <SoftChip tone="danger" icon="schedule" style={{ height: 18 }}>
                    Overdue
                  </SoftChip>
                ) : (
                  <span>{crmFromNow(r.remind_at)}</span>
                )}
              </div>
            </div>
            <RowActions open={confirmId === r.id} style={{ flex: "none" }}>
              {done ? null : (
                <>
                  <ReminderReschedule reminder={r} />
                  <Tooltip title="Mark done">
                    <Button
                      type="text"
                      size="small"
                      aria-label="Mark reminder done"
                      onClick={() => markDone(r.id)}
                      icon={<MIcon name="check_circle" size={16} />}
                    />
                  </Tooltip>
                </>
              )}
              <Popconfirm
                title="Delete this reminder?"
                description="This cannot be undone — reminders have no Deleted bin."
                okText="Delete"
                okButtonProps={{ danger: true }}
                onOpenChange={(open) =>
                  setConfirmId((current) =>
                    open ? r.id : current === r.id ? null : current,
                  )
                }
                onConfirm={async () => {
                  try {
                    await deleteReminder.mutateAsync(r.id);
                  } catch (err) {
                    message.error(errMsg(err, "Failed to delete reminder."));
                  }
                }}
              >
                <Tooltip title="Delete">
                  <Button
                    type="text"
                    size="small"
                    aria-label="Delete reminder"
                    icon={<MIcon name="delete" size={16} />}
                  />
                </Tooltip>
              </Popconfirm>
            </RowActions>
          </CrmListRow>
        );
      })}
    </Panel>
  );
}
