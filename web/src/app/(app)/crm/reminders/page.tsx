"use client";

import { useMemo, useState } from "react";
import { App, Button, Checkbox, Popconfirm, Spin, Tooltip, theme } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useAuth } from "@/features/auth/use-auth";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import {
  useCompleteCrmReminder,
  useCrmReminders,
  useDeleteCrmReminder,
  useUpdateCrmReminder,
} from "@/features/app-crm/use-crm-reminders";
import {
  crmPersonName,
  type CrmReminder,
  type CrmTargetRef,
  type CrmTargetType,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { DealGlyph } from "../_components/deal-glyph";
import { RecordDrawer } from "../_components/record-drawer";
import {
  ReminderReschedule,
  crmDefaultRemindAt,
} from "../_components/reminder-controls";
import {
  useContextMenu,
  type CrmMenuAction,
  type CrmMenuItem,
} from "../_components/data-table";
import { useRecordMenu } from "../_components/record-menu";
import { CrmListRow } from "../_components/list-row";
import { CrmToggle } from "../_components/crm-toggle";
import { BulkBar, useBulkRun } from "../_components/bulk-bar";
import { TILE_GRID } from "../_components/layout";
import { entityMeta } from "../_components/entity-meta";
import { ScopedEmptyState } from "../_components/crm-scope-bar";
import {
  useCrmScope,
  useCrmScopeResolver,
  useResetOnScopeChange,
} from "../_lib/crm-scope";
import {
  CrmPageHeader,
  CrmSearch,
  CrmToolbar,
  EmptyState,
  ErrorState,
  EntityAvatar,
  Panel,
  SoftChip,
  StatTile,
  crmDateTime,
  crmFromNow,
  crmPageStyle,
} from "../_lib/ui";

/** What a reminder points at, once the record has been looked up. */
type LinkedRecord =
  | {
      name: string;
      avatar: string | null;
      /** In its page's Deleted view: still openable, but nothing new goes on it. */
      deleted: boolean;
      email: string | null;
      phone: string | null;
      /** A company's domain. */
      website: string | null;
    }
  | undefined;

/** The clickable record half of a row — a real button, so no nested buttons. */
const RECORD_BUTTON: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  flex: 1,
  minWidth: 0,
  border: "none",
  background: "transparent",
  padding: 0,
  textAlign: "left",
  fontFamily: "inherit",
  fontSize: "inherit",
  lineHeight: "inherit",
  color: "inherit",
};

const ELLIPSIS: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/**
 * Snooze times — the same three the record menu's "Remind me" offers, so
 * "in an hour" and "next Monday" land on the same minute everywhere.
 */
function inAnHour(): Dayjs {
  const t = dayjs().add(1, "hour");
  return t
    .minute(Math.ceil(t.minute() / 5) * 5)
    .second(0)
    .millisecond(0);
}

function nextMonday10(): Dayjs {
  const d = dayjs();
  const days = (8 - d.day()) % 7 || 7;
  return d.add(days, "day").hour(10).minute(0).second(0).millisecond(0);
}

/**
 * Whether a right-click on a row gets the reminder menu rather than the
 * browser's — the tables' rule: not with Shift held, not in a text field, not
 * over selected text (so Copy still works). A right-click inside a popover the
 * row opened (the Reschedule picker, a portal) is not a right-click on the row.
 */
function wantsRowMenu(e: React.MouseEvent<HTMLElement>): boolean {
  if (e.shiftKey) return false;
  const target = e.target;
  if (!(target instanceof Node) || !e.currentTarget.contains(target))
    return false;
  const el = target instanceof Element ? target : target.parentElement;
  if (el?.closest('input, textarea, select, [contenteditable="true"]'))
    return false;
  const selection = window.getSelection();
  if (
    selection &&
    !selection.isCollapsed &&
    selection.toString().trim() &&
    e.currentTarget.contains(selection.anchorNode)
  )
    return false;
  return true;
}

/**
 * Reminders — every open reminder set FOR ME, split by how late it is.
 *
 * A reminder is "remind ME about this record at this time", so this desk is
 * personal: `useCrmReminders()` fetches the whole team (one query backs the
 * record drawer's list too, which honestly shows whose each nudge is), and the
 * `user_id` filter here is what makes the page match the promise. Reminders fire
 * a real notification on their own (the `crm_fire_due_reminders` sweep); this
 * screen is the standing list behind those pings: what slipped, what lands
 * today, what is queued. Clearing one here is the same "Done" the record drawer
 * offers.
 */
export default function CrmRemindersPage() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const { user, loading: authLoading } = useAuth();
  const {
    data: reminders,
    isLoading: remindersLoading,
    isError,
    error,
    refetch,
  } = useCrmReminders();
  const { isScoped, project } = useCrmScope();
  const { ready: scopeReady, targetInScope } = useCrmScopeResolver();
  // Until auth resolves, "mine" is unknowable — don't flash an empty desk.
  // Same for the current project while the people, companies and deals its
  // reminders resolve through are still cold: "No reminders in <project>"
  // must never be a guess.
  const isLoading =
    remindersLoading || authLoading || (isScoped && !scopeReady);
  const { data: people } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const { data: deals } = useCrmDeals();
  const { data: members } = useTeamMembers();
  const completeReminder = useCompleteCrmReminder();
  const deleteReminder = useDeleteCrmReminder();
  const updateReminder = useUpdateCrmReminder();
  const rowMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  /** The row whose right-click menu is open, outlined like a table row's. */
  const [menuRowId, setMenuRowId] = useState<string | null>(null);
  const [viewTarget, setViewTarget] = useState<CrmTargetRef | null>(null);
  const [search, setSearch] = useState("");
  const [onlyMine, setOnlyMine] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const bulk = useBulkRun(() => setSelected([]));
  // A flip of the current project swaps the whole list under the checkboxes.
  useResetOnScopeChange(() => setSelected([]));

  /** One lookup for all three record types, keyed like the polymorphic pair. */
  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) if (m.user) map.set(m.user.id, m.user.name);
    return (id: string) =>
      id === user?.id ? "you" : (map.get(id) ?? "a teammate");
  }, [members, user?.id]);

  const recordInfo = useMemo(() => {
    const map = new Map<string, NonNullable<LinkedRecord>>();
    const personById = new Map((people ?? []).map((p) => [p.id, p]));
    for (const p of people ?? []) {
      map.set(`person:${p.id}`, {
        name: crmPersonName(p) || "Unnamed person",
        avatar: p.avatar_url,
        deleted: Boolean(p.deleted_at),
        email: p.email,
        phone: p.phone,
        website: null,
      });
    }
    for (const c of companies ?? []) {
      map.set(`company:${c.id}`, {
        name: c.name,
        avatar: null,
        deleted: Boolean(c.deleted_at),
        email: null,
        phone: null,
        website: c.domain,
      });
    }
    for (const d of deals ?? []) {
      // A deal is reached through its contact.
      const contact = d.contact_id ? personById.get(d.contact_id) : undefined;
      map.set(`deal:${d.id}`, {
        name: d.name,
        avatar: null,
        deleted: Boolean(d.deleted_at),
        email: contact?.email ?? null,
        phone: d.phone ?? contact?.phone ?? null,
        website: null,
      });
    }
    return map;
  }, [people, companies, deals]);

  const groups = useMemo(() => {
    const now = dayjs();
    const endOfToday = now.endOf("day");
    const weekEnd = now.add(7, "day");
    // The hook sorts remind_at ASC, so each bucket comes out soonest-first.
    const needle = search.trim().toLowerCase();
    const open = (reminders ?? [])
      .filter((r) => !r.done_at)
      // "Mine" is the default because a reminder is a personal nudge, but a
      // lead desk also needs to see what the team has queued on an account.
      .filter((r) => !onlyMine || r.user_id === user?.id)
      // The current project, resolved through the person, company or deal the
      // reminder sits on (under "No project": one filed under no project). A
      // no-op (always true) only in a workspace with no projects.
      .filter((r) => targetInScope(r))
      .filter((r) => {
        if (!needle) return true;
        // The note alone is rarely enough to recognise a reminder — what it
        // is ON is the half people actually remember.
        const record =
          recordInfo.get(`${r.target_type}:${r.target_id}`)?.name ?? "";
        return `${r.note ?? ""} ${record}`.toLowerCase().includes(needle);
      });
    const overdue: CrmReminder[] = [];
    const today: CrmReminder[] = [];
    const upcoming: CrmReminder[] = [];
    let thisWeek = 0;
    for (const r of open) {
      const at = dayjs(r.remind_at);
      if (at.isBefore(now)) {
        overdue.push(r);
        continue;
      }
      if (at.isBefore(weekEnd)) thisWeek += 1;
      if (at.isAfter(endOfToday)) upcoming.push(r);
      else today.push(r);
    }
    return { open, overdue, today, upcoming, thisWeek };
  }, [reminders, user?.id, onlyMine, targetInScope, search, recordInfo]);

  const markDone = async (id: string) => {
    try {
      await completeReminder.mutateAsync(id);
      // A cleared reminder leaves the list, so it leaves the selection too —
      // otherwise the bulk bar would count (and delete) a row nobody can see.
      setSelected((prev) => prev.filter((x) => x !== id));
      message.success("Reminder cleared.");
    } catch (err) {
      message.error(errMsg(err, "Failed to update reminder."));
    }
  };

  const toggleOne = (id: string, on: boolean) =>
    setSelected((prev) =>
      on ? [...prev, id] : prev.filter((x) => x !== id),
    );

  /** Same write as the row's Reschedule picker — it also clears `notified_at`. */
  const snooze = async (id: string, at: Dayjs) => {
    try {
      await updateReminder.mutateAsync({ id, remind_at: at.toISOString() });
      message.success(`Snoozed to ${crmDateTime(at.toISOString())}.`);
    } catch (err) {
      message.error(errMsg(err, "Failed to reschedule."));
    }
  };

  const confirmDelete = (id: string) => {
    modal.confirm({
      title: "Delete this reminder?",
      content: "This cannot be undone — reminders have no Deleted bin.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteReminder.mutateAsync(id);
          setSelected((prev) => prev.filter((x) => x !== id));
          message.success("Reminder deleted.");
        } catch (err) {
          message.error(errMsg(err, "Failed to delete reminder."));
        }
      },
    });
  };

  /**
   * A row's right-click menu: the reminder's own actions (done, snooze,
   * select, delete) inside the record menu of what it is on — so a nudge can
   * become a task or a note on the spot. A reminder on a record that no
   * longer resolves gets only its own actions.
   */
  const rowMenuItems = (
    reminder: CrmReminder,
    linked: {
      target: CrmTargetRef;
      info: NonNullable<LinkedRecord>;
      open: () => void;
    } | null,
  ): CrmMenuItem[] => {
    const isSelected = selected.includes(reminder.id);
    const current = dayjs(reminder.remind_at);
    /**
     * Snooze only ever pushes a reminder later: a time at or before the one it
     * is set for would pull it forward and fire it sooner than asked. The
     * current minute shows checked; an earlier one shows, greyed out, so the
     * list still reads the same on every row (the Reschedule picker on the row
     * is the way to move one earlier).
     */
    const snoozeTo = (
      key: string,
      label: string,
      at: Dayjs,
      format: string,
    ): CrmMenuAction => {
      const same = current.isSame(at, "minute");
      const later = at.isAfter(current, "minute");
      return {
        key,
        label,
        extra: at.format(format),
        checked: same,
        disabled: !later && !same,
        onSelect: later ? () => void snooze(reminder.id, at) : undefined,
      };
    };
    const snoozeOptions = [
      snoozeTo("hour", "In an hour", inAnHour(), "h:mm A"),
      snoozeTo(
        "tomorrow",
        "Tomorrow morning",
        crmDefaultRemindAt(),
        "ddd, h A",
      ),
      snoozeTo("monday", "Next Monday", nextMonday10(), "D MMM, h A"),
    ];
    const own: CrmMenuItem[] = [
      {
        key: "done",
        label: "Mark done",
        icon: "check",
        onSelect: () => void markDone(reminder.id),
      },
      {
        key: "snooze",
        label: "Snooze",
        icon: "snooze",
        // Due after every option (next week or later): nothing to snooze to.
        disabled: snoozeOptions.every((o) => !o.onSelect),
        children: snoozeOptions,
      },
      {
        key: "select",
        label: isSelected ? "Unselect" : "Select",
        icon: isSelected ? "check_box_outline_blank" : "check_box",
        onSelect: () => toggleOne(reminder.id, !isSelected),
      },
    ];
    const remove: CrmMenuItem = {
      key: "delete",
      label: "Delete reminder…",
      icon: "delete",
      danger: true,
      onSelect: () => confirmDelete(reminder.id),
    };
    if (!linked) return [...own, { type: "divider" }, remove];

    const { target, info, open } = linked;
    const live = !info.deleted;
    return (
      recordMenu
        .build({
          target,
          name: info.name,
          email: live ? info.email : null,
          phone: live ? info.phone : null,
          website: live ? info.website : null,
          canCreate: live,
          manage: [
            {
              key: "open",
              label: `Open ${entityMeta(target.type).label.toLowerCase()}`,
              icon: "open_in_new",
              onSelect: open,
            },
            { type: "divider" },
            ...own,
          ],
          danger: [remove],
        })
        // "Remind me" would add a second reminder beside the one being
        // snoozed — on this page Snooze is the only timing control.
        .filter((item) => item.type !== undefined || item.key !== "remind")
    );
  };

  const renderRow = (reminder: CrmReminder, index: number) => {
    const key = `${reminder.target_type}:${reminder.target_id}`;
    const info: LinkedRecord = recordInfo.get(key);
    const meta = entityMeta(reminder.target_type);
    const name = info?.name ?? "A deleted record";
    const overdue = dayjs(reminder.remind_at).isBefore(dayjs());
    const target: CrmTargetRef = {
      type: reminder.target_type as CrmTargetType,
      id: reminder.target_id,
    };
    const linked = info
      ? { target, info, open: () => setViewTarget(target) }
      : null;
    const open = linked?.open;

    return (
      // CrmListRow takes no event props; the wrapper catches the right-click.
      <div
        key={reminder.id}
        onContextMenu={(e) => {
          if (!wantsRowMenu(e)) return;
          rowMenu.open(e, rowMenuItems(reminder, linked), {
            onClose: () => setMenuRowId(null),
          });
          // After open(): it runs the previous menu's onClose, which clears it.
          setMenuRowId(reminder.id);
        }}
      >
        <CrmListRow
          first={index === 0}
          align="flex-start"
          hover={Boolean(open)}
          style={
            menuRowId === reminder.id
              ? {
                  background: token.colorFillQuaternary,
                  boxShadow: `inset 2px 0 0 ${token.colorPrimary}`,
                }
              : undefined
          }
        >
          {/* Clearing follow-ups is a batch job — eight overdue nudges after a
            week off should not cost eight clicks. */}
          <Checkbox
            checked={selected.includes(reminder.id)}
            onChange={(e) => toggleOne(reminder.id, e.target.checked)}
            aria-label={`Select reminder on ${name}`}
            style={{ marginTop: 6, flex: "none" }}
          />
          <button
            type="button"
            onClick={open}
            disabled={!open}
            style={{ ...RECORD_BUTTON, cursor: open ? "pointer" : "default" }}
          >
            {reminder.target_type === "deal" ? (
              <DealGlyph name={name} size={28} />
            ) : (
              <EntityAvatar
                name={name}
                kind={reminder.target_type === "company" ? "company" : "person"}
                src={info?.avatar ?? null}
                size={28}
              />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
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
                    fontWeight: 500,
                    fontSize: 13,
                    lineHeight: 1.4,
                    color: info ? token.colorText : token.colorTextTertiary,
                    ...ELLIPSIS,
                  }}
                >
                  {name}
                </span>
                <SoftChip
                  tone="custom"
                  color={meta.color}
                  icon={meta.icon}
                  style={{ flex: "none", height: 18 }}
                >
                  {meta.label}
                </SoftChip>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: reminder.note
                    ? token.colorTextSecondary
                    : token.colorTextQuaternary,
                  wordBreak: "break-word",
                }}
              >
                {reminder.note?.trim() || "No note"}
              </div>
              {/* Only worth the row's width once the list is showing the
                team's — in "Mine only" every one of these would say you. */}
              {!onlyMine ? (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 11.5,
                    color: token.colorTextTertiary,
                  }}
                >
                  For {memberName(reminder.user_id)}
                </div>
              ) : null}
            </div>
          </button>

          <div style={{ flex: "none", textAlign: "right", paddingTop: 1 }}>
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.4,
                whiteSpace: "nowrap",
                fontWeight: overdue ? 500 : 400,
                color: overdue ? token.colorError : token.colorTextSecondary,
              }}
            >
              {crmDateTime(reminder.remind_at)}
            </div>
            <div
              style={{
                fontSize: 11.5,
                lineHeight: 1.4,
                whiteSpace: "nowrap",
                color: token.colorTextTertiary,
              }}
            >
              {crmFromNow(reminder.remind_at)}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", flex: "none" }}>
            <ReminderReschedule reminder={reminder} />
            <Tooltip title="Mark done">
              <Button
                size="small"
                onClick={() => markDone(reminder.id)}
                icon={<MIcon name="check" size={15} />}
              >
                Done
              </Button>
            </Tooltip>
          </div>
        </CrmListRow>
      </div>
    );
  };

  const section = (
    title: string,
    icon: string,
    rows: CrmReminder[],
    hint: string,
  ) =>
    rows.length === 0 ? null : (
      <Panel
        key={title}
        title={
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <MIcon name={icon} size={17} color={token.colorTextTertiary} />
            {title}
          </span>
        }
        extra={
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
            {rows.length} {rows.length === 1 ? "reminder" : "reminders"} · {hint}
          </span>
        }
        padding={0}
      >
        {rows.map(renderRow)}
      </Panel>
    );

  return (
    <div style={crmPageStyle()}>
      <CrmPageHeader
        title="Reminders"
        subtitle="The nudges you set on your leads, people and companies — what slipped, what lands today, what's queued next."
        count={isLoading ? null : groups.open.length}
      />

      <CrmToolbar>
        <CrmSearch
          value={search}
          onChange={setSearch}
          placeholder="Search reminders and what they're on…"
          width={280}
        />
        <CrmToggle checked={onlyMine} onChange={setOnlyMine} label="Mine only" />
      </CrmToolbar>

      <div style={TILE_GRID}>
        <StatTile
          icon="alarm"
          color={token.colorError}
          label="Overdue"
          value={groups.overdue.length}
          hint={
            groups.overdue.length > 0
              ? `Oldest ${crmFromNow(groups.overdue[0].remind_at)}`
              : "Nothing late"
          }
        />
        <StatTile
          icon="today"
          color={token.colorWarning}
          label="Today"
          value={groups.today.length}
          hint={
            groups.today.length > 0
              ? `Next ${crmFromNow(groups.today[0].remind_at)}`
              : "Nothing left today"
          }
        />
        <StatTile
          icon="date_range"
          color={token.colorPrimary}
          label="This week"
          value={groups.thisWeek}
          hint="Due in the next 7 days"
        />
      </div>

      {isLoading ? (
        <Panel padding={8}>
          <div style={{ display: "grid", placeItems: "center", padding: 56 }}>
            <Spin size="large" />
          </div>
        </Panel>
      ) : isError ? (
        // "Nothing on your plate" is the most dangerous empty state in the
        // CRM — it says the follow-ups are handled. Never say it on a failure.
        <Panel padding={8}>
          <ErrorState
            title="Couldn't load reminders"
            error={error}
            onRetry={() => void refetch()}
          />
        </Panel>
      ) : groups.open.length === 0 ? (
        <Panel padding={8}>
          {search.trim() ? (
            <EmptyState
              icon="search_off"
              title="No reminders match that search"
              description="Searches cover a reminder's note and the record it sits on."
              action={
                <Button onClick={() => setSearch("")}>Clear search</Button>
              }
            />
          ) : project ? (
            // A project is chosen (`project` is non-null exactly when
            // `isScoped`) and nothing is due on its records. No create here:
            // a reminder is set FROM a record, so point at the drawer.
            <ScopedEmptyState
              nouns="reminders"
              description={`Set one from any person, company or deal in ${project.name} — it lands here when it is due.`}
            />
          ) : onlyMine ? (
            <EmptyState
              icon="alarm"
              accent={token.colorPrimary}
              title="Nothing on your plate"
              description="Open any lead, person or company and set a reminder from its Reminders tab — it lands here and pings you when it's due."
              action={
                <Button onClick={() => setOnlyMine(false)}>
                  {`See the team's`}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon="alarm"
              accent={token.colorPrimary}
              title="No reminders waiting"
              description="Open any lead, person or company and set a reminder from its Reminders tab — it lands here and pings you when it's due."
            />
          )}
        </Panel>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {section("Overdue", "priority_high", groups.overdue, "past due")}
          {section("Today", "today", groups.today, "still to come")}
          {section("Upcoming", "event_upcoming", groups.upcoming, "queued")}

          <BulkBar count={selected.length} onClear={() => setSelected([])}>
            <Button
              size="small"
              disabled={bulk.busy}
              icon={<MIcon name="check" size={15} />}
              onClick={() =>
                void bulk.run(selected, "Cleared", (id) =>
                  completeReminder.mutateAsync(id),
                )
              }
            >
              Mark done
            </Button>
            <Popconfirm
              title={`Delete ${selected.length} reminder${selected.length === 1 ? "" : "s"}?`}
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() =>
                void bulk.run(selected, "Deleted", (id) =>
                  deleteReminder.mutateAsync(id),
                )
              }
            >
              <Button
                size="small"
                danger
                disabled={bulk.busy}
                icon={<MIcon name="delete" size={15} />}
              >
                Delete
              </Button>
            </Popconfirm>
          </BulkBar>
        </div>
      )}

      <RecordDrawer target={viewTarget} onClose={() => setViewTarget(null)} />
      {/* Outside every row: the menu's and dialogs' portal events bubble here. */}
      {rowMenu.element}
      {recordMenu.dialogs}
    </div>
  );
}
