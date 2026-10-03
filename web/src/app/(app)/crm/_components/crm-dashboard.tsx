"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  DatePicker,
  Modal,
  Select,
  Spin,
  Tooltip,
  theme,
} from "antd";
import { useRouter } from "next/navigation";
import dayjs, { type Dayjs } from "dayjs";
import { EChart, CHART_FONT } from "@/features/home/echart";
import { useAuth } from "@/features/auth/use-auth";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useCrmStages } from "@/features/app-crm/use-crm-stages";
import {
  useCrmTasks,
  useDeleteCrmTask,
  useUpdateCrmTask,
  type CrmTaskPatch,
} from "@/features/app-crm/use-crm-tasks";
import { useCrmRecentActivities } from "@/features/app-crm/use-crm-activities";
import {
  useCompleteCrmReminder,
  useCrmReminders,
  useDeleteCrmReminder,
  useUpdateCrmReminder,
} from "@/features/app-crm/use-crm-reminders";
import {
  CRM_LEAD_STATUSES,
  CRM_TASK_STATUSES,
  crmLeadStatusMeta,
  type CrmActivity,
  type CrmLeadStatus,
  type CrmReminder,
  type CrmTargetRef,
  type CrmTaskStatus,
  type CrmTaskWithTargets,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "./m-icon";
import { RecordDrawer } from "./record-drawer";
import { DealQuickCreate, PasteDealHint } from "./paste-deal";
import { LeadImportDialog } from "./lead-import-dialog";
import { DealGlyph } from "./deal-glyph";
import {
  CRM_REMIND_AT_FORMAT,
  crmDefaultRemindAt,
  crmDisabledRemindDate,
  openReminders,
} from "./reminder-controls";
import {
  NO_STAGE_COLOR,
  entityMeta,
  leadStatusIcon,
} from "./entity-meta";
import { CONTENT_GRID } from "./layout";
import { CrmListRow } from "./list-row";
import { DealsTable } from "./deals-table";
import { useContextMenu, type CrmMenuItem } from "./data-table";
import { useDealMenuItems, useRecordMenu } from "./record-menu";
import { ScopedEmptyState } from "./crm-scope-bar";
import {
  CrmPageHeader,
  EmptyState,
  ErrorState,
  EntityAvatar,
  Panel,
  SoftChip,
  crmDate,
  crmDateTime,
  crmFromNow,
  crmPageStyle,
  crmPersonName,
  type SoftChipTone,
} from "../_lib/ui";
import { useCrmScope, useCrmScopeResolver } from "../_lib/crm-scope";
import { useCrmPrefsStore } from "../_lib/crm-prefs-store";

function activityLine(a: CrmActivity, recordName: string): string {
  const props = (a.properties ?? {}) as Record<string, unknown>;
  switch (a.event) {
    case "created":
      return `created ${recordName}`;
    case "updated":
      return `updated ${recordName}`;
    case "stage_changed":
      return `moved ${recordName} to ${String(props.to ?? "no stage")}`;
    case "status_changed":
      return `marked ${recordName} ${crmLeadStatusMeta(
        String(props.to ?? ""),
      ).label.toLowerCase()}`;
    case "deleted":
      return `deleted ${recordName}`;
    case "restored":
      return `restored ${recordName}`;
    case "note_added":
      return `added a note on ${recordName}`;
    case "task_added":
      return `added a task on ${recordName}`;
    default:
      return `${a.event} — ${recordName}`;
  }
}

/** Soft chip vocabulary for the activity feed's event kinds. */
const EVENT_META: Record<
  string,
  { label: string; icon: string; tone: SoftChipTone }
> = {
  created: { label: "Created", icon: "add_circle", tone: "success" },
  updated: { label: "Updated", icon: "edit", tone: "neutral" },
  stage_changed: { label: "Stage", icon: "swap_horiz", tone: "accent" },
  status_changed: { label: "Status", icon: "flag", tone: "warning" },
  deleted: { label: "Deleted", icon: "delete", tone: "danger" },
  restored: { label: "Restored", icon: "restore_from_trash", tone: "success" },
  note_added: { label: "Note", icon: "sticky_note_2", tone: "neutral" },
  task_added: { label: "Task", icon: "task_alt", tone: "accent" },
};

function eventMeta(event: string) {
  return (
    EVENT_META[event] ?? {
      label: event.replace(/_/g, " "),
      icon: "history",
      tone: "neutral" as SoftChipTone,
    }
  );
}

/** Non-entity leading glyph (tasks), same footprint as an EntityAvatar. */
function GlyphChip({ icon }: { icon: string }) {
  const { token } = theme.useToken();
  return (
    <span
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: token.colorFillTertiary,
      }}
    >
      <MIcon name={icon} size={16} color={token.colorTextTertiary} />
    </span>
  );
}

/** In-panel loading treatment — same shape in every panel on the page. */
function PanelSpin() {
  return (
    <div style={{ display: "grid", placeItems: "center", padding: 40 }}>
      <Spin size="small" />
    </div>
  );
}

/* ------------------------------------------------- right-click menus */

/** Snooze to the next "o'clock + 5 min" boundary at least an hour away. */
function inAnHour(): Dayjs {
  const t = dayjs().add(1, "hour");
  return t.minute(Math.ceil(t.minute() / 5) * 5).second(0).millisecond(0);
}

function nextMonday10(): Dayjs {
  const d = dayjs();
  const days = (8 - d.day()) % 7 || 7;
  return d.add(days, "day").hour(10).minute(0).second(0).millisecond(0);
}

/**
 * A due date set from the menu lands at the END of that day, as on the Tasks
 * page: a task is overdue once `due_at` has passed, so "Today" stamped with
 * the current time would turn red a second later.
 */
const dueBy = (day: Dayjs) => day.endOf("day").toISOString();

/** The Tasks page's status glyphs, for the Status submenu. */
const TASK_STATUS_ICON: Record<CrmTaskStatus, string> = {
  TODO: "radio_button_unchecked",
  IN_PROGRESS: "pending",
  DONE: "check_circle",
};

/**
 * Whether a right-click on a panel row gets the CRM menu rather than the
 * browser's — as in the CRM tables: not with Shift held, and not on text the
 * user has selected in the row (so Copy still works).
 */
function wantsRowMenu(e: React.MouseEvent<HTMLElement>): boolean {
  if (e.shiftKey) return false;
  const selection = window.getSelection();
  return !(
    selection &&
    !selection.isCollapsed &&
    selection.toString().trim() &&
    e.currentTarget.contains(selection.anchorNode)
  );
}

/** A record name in a submenu, clipped so a long one can't stretch the menu. */
function MenuName({ children }: { children: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        maxWidth: 220,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "bottom",
      }}
    >
      {children}
    </span>
  );
}

/**
 * The CRM dashboard — the /crm/dashboard page, and the same screen inside a
 * project's CRM tab (`embedded`, under a pinned CrmScopeProvider).
 *
 * Embedded, it drops the page padding and the page header (title, blurb,
 * paste hint, Reports / Open pipeline — the project page already frames it),
 * and every link into the CRM that remains first points the CRM's own project
 * switcher at this project, so it lands on this project's records rather than
 * on whatever project /crm was last showing.
 */
export function CrmDashboard({ embedded = false }: { embedded?: boolean }) {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  // The scope (the /crm project bar, or the project a project's CRM tab is
  // pinned to) picks the project; every panel here obeys it.
  const { isScoped, isNoProject, inScope, project, fixed, projectId, teamId } = useCrmScope();
  const setScope = useCrmPrefsStore((st) => st.setScope);
  /** Into the CRM — from a project's tab, onto this project first. */
  const go = (path: string) => {
    if (fixed && projectId && teamId) setScope(teamId, projectId);
    router.push(path);
  };
  const { ready, targetInScope, targetsInScope } = useCrmScopeResolver();
  const { data: people } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const {
    data: deals,
    isLoading: dealsLoading,
    isError: dealsError,
    refetch: refetchDeals,
  } = useCrmDeals();
  const {
    data: stages,
    isLoading: stagesLoading,
    isError: stagesError,
    refetch: refetchStages,
  } = useCrmStages();
  const {
    data: tasks,
    isLoading: tasksFetching,
    isError: tasksError,
    refetch: refetchTasks,
  } = useCrmTasks();
  // Scoped, the feed is filtered client-side, so it asks for a deeper page
  // (its own cache entry) to still find 12 of the project's events.
  const { data: activities, isLoading: activitiesFetching } =
    useCrmRecentActivities(isScoped ? 100 : 12);
  const {
    data: reminders,
    isLoading: remindersFetching,
    isError: remindersError,
    refetch: refetchReminders,
  } = useCrmReminders();
  const { data: members } = useTeamMembers();
  const completeReminder = useCompleteCrmReminder();
  const updateReminder = useUpdateCrmReminder();
  const deleteReminder = useDeleteCrmReminder();
  const updateTask = useUpdateCrmTask();
  const deleteTask = useDeleteCrmTask();
  const [drawerTarget, setDrawerTarget] = useState<CrmTargetRef | null>(null);
  // The quick-deal dialog also opens on paste; this is the button route.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  // The lead importer: the Import button, or a block of sheet rows pasted here.
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState<string | null>(null);
  // Right-click menus on the reminder and task rows (the deals table has its
  // own), and the quick New task / Add note dialogs they open.
  const rowMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  const dealMenu = useDealMenuItems();
  /** The panel row whose menu is open, lit while it is. */
  const [menuRow, setMenuRow] = useState<string | null>(null);
  /** The reminder "Snooze ▸ Pick a time…" is moving, and to when. */
  const [snoozing, setSnoozing] = useState<CrmReminder | null>(null);
  const [snoozeAt, setSnoozeAt] = useState<Dayjs | null>(null);

  /**
   * The tiles here are sums across several queries, so ONE failed fetch makes
   * every number on the page quietly wrong — not missing, wrong. That can't be
   * left to the per-panel empty states, hence one banner for the whole screen.
   */
  const loadFailed = dealsError || stagesError || tasksError || remindersError;
  const retryAll = () => {
    if (dealsError) void refetchDeals();
    if (stagesError) void refetchStages();
    if (tasksError) void refetchTasks();
    if (remindersError) void refetchReminders();
  };

  /** While any of these is cold the tiles show "—" instead of a confident 0. */
  const pipelineLoading = dealsLoading || stagesLoading;

  /**
   * Reminders, tasks and activities reach the project through the deal,
   * person or company they point at, so while scoped and that lookup is still
   * cold the panels are loading — not "nothing in this project".
   */
  const scopeResolving = isScoped && !ready;
  const tasksLoading = tasksFetching || scopeResolving;
  const remindersLoading = remindersFetching || scopeResolving;
  const activitiesLoading = activitiesFetching || scopeResolving;

  const liveDeals = useMemo(
    () => (deals ?? []).filter((d) => !d.deleted_at && inScope(d.project_id)),
    [deals, inScope],
  );

  /**
   * The reminder desk: MY undismissed reminders, soonest first (the hook sorts
   * `remind_at` ASC and fetches the whole team, so the "mine" filter is ours).
   * A reminder is "remind ME" — counting a colleague's nudges here would make
   * the tile a number nobody can act on. "Due" means it has already come up —
   * overdue plus anything still landing today — because that is what a human
   * can clear before going home.
   */
  const myReminders = useMemo(() => {
    const open = openReminders(reminders).filter(
      (r) => r.user_id === user?.id && targetInScope(r),
    );
    const now = dayjs();
    const endOfToday = now.endOf("day");
    let overdue = 0;
    let today = 0;
    for (const r of open) {
      const at = dayjs(r.remind_at);
      if (at.isBefore(now)) overdue += 1;
      else if (!at.isAfter(endOfToday)) today += 1;
    }
    return { open, overdue, today, due: overdue + today, next: open.slice(0, 6) };
  }, [reminders, user?.id, targetInScope]);

  /** Deal lookup so a reminder on a deal can show that lead's status chip. */
  const dealById = useMemo(
    () => new Map((deals ?? []).map((d) => [d.id, d])),
    [deals],
  );

  // One row per stage (board order), plus "No stage" only when needed.
  const stageRows = useMemo(() => {
    const rows = (stages ?? []).map((s) => ({
      name: s.name,
      color: s.color,
      count: liveDeals.filter((d) => d.stage_id === s.id).length,
    }));
    const orphans = liveDeals.filter(
      (d) => !d.stage_id || !(stages ?? []).some((s) => s.id === d.stage_id),
    );
    if (orphans.length > 0) {
      rows.push({
        name: "No stage",
        color: NO_STAGE_COLOR,
        count: orphans.length,
      });
    }
    return rows;
  }, [stages, liveDeals]);

  const userName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) if (m.user) map.set(m.user.id, m.user.name);
    return (id: string | null | undefined) => (id && map.get(id)) || "Someone";
  }, [members]);

  /**
   * Every record a reminder, task or activity can point at, keyed like the
   * polymorphic pair — its name, whether it sits in Deleted, and the contact
   * details its right-click menu offers (a deal's email is its contact's).
   */
  const records = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        deleted: boolean;
        email?: string | null;
        phone?: string | null;
        website?: string | null;
      }
    >();
    const emailOf = new Map<string, string | null>();
    for (const p of people ?? []) {
      emailOf.set(p.id, p.email);
      map.set(`person:${p.id}`, {
        name: crmPersonName(p) || "Unnamed person",
        deleted: Boolean(p.deleted_at),
        email: p.email,
        phone: p.phone,
      });
    }
    for (const c of companies ?? [])
      map.set(`company:${c.id}`, {
        name: c.name,
        deleted: Boolean(c.deleted_at),
        website: c.domain,
      });
    for (const d of deals ?? [])
      map.set(`deal:${d.id}`, {
        name: d.name,
        deleted: Boolean(d.deleted_at),
        email: d.contact_id ? emailOf.get(d.contact_id) : null,
        phone: d.phone,
      });
    return map;
  }, [people, companies, deals]);

  const recordName = (type: string, id: string) =>
    records.get(`${type}:${id}`)?.name ?? "a deleted record";

  const myOpenTasks = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => t.assignee_id === user?.id && t.status !== "DONE")
        .filter((t) => targetsInScope(t.targets))
        .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"))
        .slice(0, 8),
    [tasks, user?.id, targetsInScope],
  );

  /** The feed's rows: the project's events (or everyone's), newest 12. */
  const visibleActivities = useMemo(
    () => (activities ?? []).filter(targetInScope).slice(0, 12),
    [activities, targetInScope],
  );

  // Overdue first, then the next closes — the "what needs attention" list.
  /* ------------------------------------------------ lead-desk controls */

  const [statusFilter, setStatusFilter] = useState<"ALL" | CrmLeadStatus>("ALL");
  const [sortBy, setSortBy] = useState<"attention" | "newest" | "name">(
    "attention",
  );

  /** The table's rows: the live deals under the toolbar's filter and sort. */
  const visibleDeals = useMemo(() => {
    const rows =
      statusFilter === "ALL"
        ? liveDeals
        : liveDeals.filter(
            (d) => crmLeadStatusMeta(d.status).value === statusFilter,
          );
    const sorted = [...rows];
    if (sortBy === "newest") {
      sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    } else if (sortBy === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // "Needs attention": dated deals soonest first (so overdue leads), then
      // the undated ones by recency.
      sorted.sort((a, b) => {
        if (a.close_date && b.close_date) {
          return a.close_date.localeCompare(b.close_date);
        }
        if (a.close_date) return -1;
        if (b.close_date) return 1;
        return b.created_at.localeCompare(a.created_at);
      });
    }
    return sorted;
  }, [liveDeals, statusFilter, sortBy]);

  /** Exactly what the table is showing, as CSV. */
  const exportDeals = () => {
    const cell = (v: string | number) => {
      const s = String(v);
      return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const stageName = new Map((stages ?? []).map((s) => [s.id, s.name]));
    const header = [
      "Deal",
      "Company",
      "Contact",
      "Mobile",
      "Status",
      "Stage",
      "Close date",
    ];
    const lines = visibleDeals.map((d) =>
      [
        cell(d.name),
        cell(d.company?.name ?? ""),
        cell(crmPersonName(d.contact)),
        cell(d.phone ?? ""),
        cell(crmLeadStatusMeta(d.status).label),
        cell(d.stage_id ? (stageName.get(d.stage_id) ?? "") : ""),
        cell(d.close_date ?? ""),
      ].join(","),
    );
    const csv = [header.map(cell).join(","), ...lines].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `crm-deals-${dayjs().format("YYYY-MM-DD")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  // Tooltip chrome tracks the theme so dark mode stays legible.
  const chartTooltip = useMemo(
    () => ({
      backgroundColor: token.colorBgElevated,
      borderColor: token.colorBorderSecondary,
      textStyle: {
        color: token.colorText,
        fontFamily: CHART_FONT,
        fontSize: 12,
      },
    }),
    [token.colorBgElevated, token.colorBorderSecondary, token.colorText],
  );

  // Horizontal bars: stage identity comes from the axis label (color is the
  // stage's own entity color, mirrored from the board); counts direct-labeled.
  const chartOption = useMemo(
    () => ({
      grid: { left: 8, right: 28, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "value" as const,
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: "category" as const,
        inverse: true,
        data: stageRows.map((r) => r.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: token.colorTextSecondary,
          fontFamily: CHART_FONT,
        },
      },
      tooltip: {
        ...chartTooltip,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = Array.isArray(params) ? params[0] : params;
          const idx = (p as { dataIndex?: number }).dataIndex ?? 0;
          const row = stageRows[idx];
          if (!row) return "";
          return `${row.name}: ${row.count} deal${row.count === 1 ? "" : "s"}`;
        },
      },
      series: [
        {
          type: "bar" as const,
          data: stageRows.map((r) => ({
            value: r.count,
            itemStyle: { color: r.color, borderRadius: [0, 4, 4, 0] },
          })),
          barWidth: 16,
          label: {
            show: true,
            position: "right" as const,
            color: token.colorTextSecondary,
            fontFamily: CHART_FONT,
            formatter: "{c}",
          },
        },
      ],
    }),
    [stageRows, token.colorTextSecondary, chartTooltip],
  );

  /** Dismiss a reminder from the panel — same call the record drawer makes. */
  const markReminderDone = async (id: string) => {
    try {
      await completeReminder.mutateAsync(id);
      message.success("Reminder cleared.");
    } catch (err) {
      message.error(errMsg(err, "Failed to update reminder."));
    }
  };

  /* ------------------------------------------------ right-click menus */

  /**
   * Right-click on a reminder or task row: its menu at the pointer, the row
   * lit while it is open. The menu opens before the row is marked, so a
   * second right-click on the same row (whose old menu's close clears the
   * mark) keeps it lit.
   */
  const openRowMenu =
    (key: string, items: () => CrmMenuItem[]) =>
    (e: React.MouseEvent<HTMLElement>) => {
      if (!wantsRowMenu(e)) return;
      rowMenu.open(e, items(), { onClose: () => setMenuRow(null) });
      setMenuRow(key);
    };
  const litRow: React.CSSProperties = {
    background: token.colorFillQuaternary,
    boxShadow: `inset 2px 0 0 ${token.colorPrimary}`,
  };

  /**
   * Move a reminder later — the reschedule hook the Reminders page uses, which
   * also re-arms the notification. False when the write failed.
   */
  const snoozeReminder = async (id: string, at: Dayjs) => {
    try {
      await updateReminder.mutateAsync({ id, remind_at: at.toISOString() });
      message.success(`Snoozed until ${at.format("ddd D MMM, h:mm A")}.`);
      return true;
    } catch (err) {
      message.error(errMsg(err, "Couldn't snooze the reminder."));
      return false;
    }
  };

  const openSnooze = (r: CrmReminder) => {
    setSnoozing(r);
    // Its own time while that is still ahead; an overdue one starts at the
    // usual tomorrow morning rather than on a day the picker refuses.
    const at = dayjs(r.remind_at);
    setSnoozeAt(at.isAfter(dayjs()) ? at : crmDefaultRemindAt());
  };

  const submitSnooze = async () => {
    if (!snoozing || !snoozeAt) return;
    if (await snoozeReminder(snoozing.id, snoozeAt)) setSnoozing(null);
  };

  const confirmDeleteReminder = (r: CrmReminder) => {
    modal.confirm({
      title: "Delete this reminder?",
      content: "This cannot be undone — reminders have no Deleted bin.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteReminder.mutateAsync(r.id);
          message.success("Reminder deleted.");
        } catch (err) {
          message.error(errMsg(err, "Failed to delete reminder."));
        }
      },
    });
  };

  /**
   * A reminder row's menu — the record menu of what it reminds about, with the
   * reminder's own actions in the middle:
   *
   *   Open
   *   Mark done · Snooze ▸ · Status ▸ (a deal's)
   *   New task… · Add note…
   *   Send email · Call · Open website · Copy ▸
   *   Delete reminder…
   *
   * "Remind me ▸" is left out: on a reminder, Snooze is that. A record in
   * Deleted drops the contact actions and the create items, as its own menus
   * do; a record that no longer exists keeps only the reminder's own actions.
   */
  const reminderMenu = (r: CrmReminder): CrmMenuItem[] => {
    const at = dayjs(r.remind_at);
    // Same rule as the Reminders page: snoozing only pushes a reminder later.
    // The preset it is already set to shows ticked; an earlier one greys out
    // ("Pick a time…" is the way to move it earlier).
    const preset = (
      key: string,
      label: string,
      when: Dayjs,
      extra: string,
    ): CrmMenuItem => {
      const same = at.isSame(when, "minute");
      const later = when.isAfter(at, "minute");
      return {
        key,
        label,
        extra,
        checked: same,
        disabled: !later && !same,
        onSelect: later ? () => void snoozeReminder(r.id, when) : undefined,
      };
    };
    const own: CrmMenuItem[] = [
      {
        key: "done",
        label: "Mark done",
        icon: "check_circle",
        onSelect: () => void markReminderDone(r.id),
      },
      {
        key: "snooze",
        label: "Snooze",
        icon: "snooze",
        children: [
          preset("hour", "In an hour", inAnHour(), inAnHour().format("h:mm A")),
          preset(
            "tomorrow",
            "Tomorrow morning",
            crmDefaultRemindAt(),
            crmDefaultRemindAt().format("ddd, h A"),
          ),
          preset(
            "monday",
            "Next Monday",
            nextMonday10(),
            nextMonday10().format("D MMM, h A"),
          ),
          { type: "divider" },
          {
            key: "custom",
            label: "Pick a time…",
            icon: "edit_calendar",
            onSelect: () => openSnooze(r),
          },
        ],
      },
    ];
    const remove: CrmMenuItem = {
      key: "delete",
      label: "Delete reminder…",
      icon: "delete",
      danger: true,
      onSelect: () => confirmDeleteReminder(r),
    };
    const type = r.target_type as CrmTargetRef["type"];
    const target: CrmTargetRef = { type, id: r.target_id };
    const record = records.get(`${type}:${r.target_id}`);
    if (!record) return [...own, { type: "divider" }, remove];
    const live = !record.deleted;
    const deal = type === "deal" ? dealById.get(r.target_id) : undefined;
    return recordMenu
      .build({
        target,
        name: record.name,
        onOpen: () => setDrawerTarget(target),
        email: live ? record.email : null,
        phone: live ? record.phone : null,
        website: live ? record.website : null,
        manage: [
          ...own,
          ...(deal && live ? [dealMenu.status(deal)] : []),
        ],
        danger: [remove],
        canCreate: live,
      })
      .filter((item) => !(item.type === undefined && item.key === "remind"));
  };

  /** One field change on a task from the menu, with a toast. */
  const saveTask = async (id: string, patch: CrmTaskPatch, done: string) => {
    try {
      await updateTask.mutateAsync({ id, patch });
      message.success(done);
    } catch (err) {
      message.error(errMsg(err, "Couldn't update the task."));
    }
  };

  const copyTitle = (title: string) => {
    void navigator.clipboard.writeText(title).then(
      () => message.success("Title copied."),
      () => message.error("Couldn't copy the title."),
    );
  };

  const confirmDeleteTask = (t: CrmTaskWithTargets) => {
    modal.confirm({
      title: "Delete this task?",
      content: `“${t.title}” will be deleted. This cannot be undone — tasks have no Deleted bin.`,
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteTask.mutateAsync(t.id);
          message.success("Task deleted.");
        } catch (err) {
          message.error(errMsg(err, "Failed to delete task."));
        }
      },
    });
  };

  /**
   * A task row's menu, built from the task as it is now:
   *
   *   Open in Tasks · Open deal (or Open linked record ▸)
   *   Mark done · Status ▸ · Due date ▸
   *   New task… (for the one record it is linked to)
   *   Copy title
   *   Delete…
   */
  const taskMenu = (t: CrmTaskWithTargets): CrmMenuItem[] => {
    const status =
      CRM_TASK_STATUSES.find((s) => s.value === t.status) ??
      CRM_TASK_STATUSES[0];
    const due = t.due_at ? dayjs(t.due_at) : null;
    const today = dayjs();
    const dueChoice = (
      key: string,
      label: string,
      day: Dayjs,
      extra: string,
    ): CrmMenuItem => {
      const picked = Boolean(due?.isSame(day, "day"));
      return {
        key,
        label,
        extra,
        checked: picked,
        onSelect: picked
          ? undefined
          : () =>
              void saveTask(
                t.id,
                { due_at: dueBy(day) },
                `Due ${day.format("ddd D MMM")}.`,
              ),
      };
    };
    // The records it is linked to that still exist (a hard-deleted one has
    // no drawer to open).
    const linked = t.targets.flatMap((x) => {
      const record = records.get(`${x.target_type}:${x.target_id}`);
      if (!record) return [];
      const target: CrmTargetRef = {
        type: x.target_type as CrmTargetRef["type"],
        id: x.target_id,
      };
      return [{ key: x.id, target, record, meta: entityMeta(target.type) }];
    });
    const only = linked.length === 1 ? linked[0] : null;
    // "New task…" on the one record the task is linked to: the record menu's
    // quick dialog, linking the new task the same way.
    const newTask =
      only && !only.record.deleted
        ? recordMenu
            .build({ target: only.target, name: only.record.name })
            .find((item) => item.type === undefined && item.key === "task")
        : undefined;
    const openLinked: CrmMenuItem[] = only
      ? [
          {
            key: "linked",
            label: `Open ${only.meta.label.toLowerCase()}`,
            icon: only.meta.icon,
            onSelect: () => setDrawerTarget(only.target),
          },
        ]
      : linked.length > 1
        ? [
            {
              key: "linked",
              label: "Open linked record",
              icon: "link",
              children: linked.map((l) => ({
                key: l.key,
                label: <MenuName>{l.record.name}</MenuName>,
                icon: l.meta.icon,
                extra: l.meta.label,
                onSelect: () => setDrawerTarget(l.target),
              })),
            },
          ]
        : [];

    return [
      {
        key: "tasks",
        label: "Open in Tasks",
        icon: "open_in_new",
        onSelect: () => go("/crm/tasks"),
      },
      ...openLinked,
      { type: "divider" },
      {
        key: "done",
        label: "Mark done",
        icon: "check_circle",
        onSelect: () => void saveTask(t.id, { status: "DONE" }, "Task done."),
      },
      {
        key: "status",
        label: "Status",
        icon: "flag",
        extra: status.label,
        children: CRM_TASK_STATUSES.map((s) => ({
          key: s.value,
          label: s.label,
          icon: TASK_STATUS_ICON[s.value],
          checked: s.value === status.value,
          onSelect:
            s.value === status.value
              ? undefined
              : () =>
                  void saveTask(t.id, { status: s.value }, `Status: ${s.label}.`),
        })),
      },
      {
        key: "due",
        label: "Due date",
        icon: "event",
        extra: due ? due.format("D MMM") : "None",
        children: [
          dueChoice("today", "Today", today, today.format("ddd")),
          dueChoice(
            "tomorrow",
            "Tomorrow",
            today.add(1, "day"),
            today.add(1, "day").format("ddd"),
          ),
          dueChoice(
            "week",
            "Next week",
            today.add(7, "day"),
            today.add(7, "day").format("ddd D MMM"),
          ),
          ...(due
            ? ([
                { type: "divider" },
                {
                  key: "clear",
                  label: "Clear due date",
                  icon: "event_busy",
                  onSelect: () =>
                    void saveTask(t.id, { due_at: null }, "Due date cleared."),
                },
              ] satisfies CrmMenuItem[])
            : []),
        ],
      },
      { type: "divider" },
      ...(newTask ? [newTask] : []),
      { type: "divider" },
      {
        key: "copy",
        label: "Copy title",
        icon: "content_copy",
        onSelect: () => copyTitle(t.title),
      },
      { type: "divider" },
      {
        key: "delete",
        label: "Delete…",
        icon: "delete",
        danger: true,
        onSelect: () => confirmDeleteTask(t),
      },
    ];
  };

  const mutedLine: React.CSSProperties = {
    fontSize: 12,
    lineHeight: 1.35,
    color: token.colorTextTertiary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const primaryLine: React.CSSProperties = {
    fontWeight: 500,
    lineHeight: 1.35,
    color: token.colorText,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const panelExtraText: React.CSSProperties = {
    fontSize: 12,
    color: token.colorTextTertiary,
  };
  const scopedDealsEmpty = isScoped && !dealsLoading && liveDeals.length === 0;
  /**
   * The panels' empty titles name the project; under "No project" that
   * would read "Nothing in No project yet", so that view gets its own line
   * (same phrasing as ScopedEmptyState). Null when unscoped: each panel
   * keeps its own wording then.
   */
  const nothingHereTitle = !project
    ? null
    : isNoProject
      ? "Nothing without a project yet"
      : `Nothing in ${project.name} yet`;

  return (
    <div style={embedded ? undefined : crmPageStyle()}>
      {/* Inside a project's CRM tab the project page is the header: no
          title, blurb or navigation buttons there — the toolbar's New deal
          (and pasting a lead anywhere) still start a deal. */}
      {embedded ? null : (
        <CrmPageHeader
          title="CRM Dashboard"
          subtitle="Where the pipeline stands, what closes next, and what the team just touched."
          right={
            <>
              <PasteDealHint style={{ marginRight: 4 }} />
              <Button
                icon={<MIcon name="monitoring" size={16} />}
                onClick={() => go("/crm/reports")}
              >
                Reports
              </Button>
              <Button
                type="primary"
                icon={<MIcon name="view_kanban" size={16} />}
                onClick={() => go("/crm/deals")}
              >
                Open pipeline
              </Button>
            </>
          }
        />
      )}

      {loadFailed ? (
        <div style={{ marginBottom: 14 }}>
          <Panel padding={8}>
            <ErrorState
              compact
              title="Some of this dashboard didn't load"
              onRetry={retryAll}
            />
          </Panel>
        </div>
      ) : null}

      {/* Toolbar: what the screen shows, then what you can do to it. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <Select
          size="middle"
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ minWidth: 150 }}
          options={[
            { value: "ALL", label: "All statuses" },
            ...CRM_LEAD_STATUSES.map((s) => ({
              value: s.value,
              label: s.label,
            })),
          ]}
        />
        <Select
          size="middle"
          value={sortBy}
          onChange={setSortBy}
          style={{ minWidth: 168 }}
          options={[
            { value: "attention", label: "Sort: needs attention" },
            { value: "newest", label: "Sort: newest first" },
            { value: "name", label: "Sort: name A–Z" },
          ]}
        />
        <span style={{ flex: 1 }} />
        <Button
          icon={<MIcon name="upload_file" size={16} />}
          onClick={() => setImportOpen(true)}
        >
          Import
        </Button>
        <Button
          icon={<MIcon name="download" size={16} />}
          onClick={exportDeals}
          disabled={visibleDeals.length === 0}
        >
          Export
        </Button>
        <Button
          type="primary"
          icon={<MIcon name="add" size={16} />}
          onClick={() => setDealFormOpen(true)}
        >
          New deal
        </Button>
      </div>

      {/* The lead desk itself — every deal, selectable in bulk. A project with
          no deals at all gets the scoped empty state (the toolbar's status
          filter hiding rows is the table's own empty, as before). */}
      <Panel padding={scopedDealsEmpty ? 8 : 0} style={{ marginBottom: 16 }}>
        {scopedDealsEmpty ? (
          <ScopedEmptyState
            compact
            nouns="deals"
            onCreate={() => setDealFormOpen(true)}
          />
        ) : (
          <DealsTable
            deals={visibleDeals}
            stages={stages ?? []}
            loading={dealsLoading}
            onOpen={(id) => setDrawerTarget({ type: "deal", id })}
          />
        )}
      </Panel>

      <div style={CONTENT_GRID}>
        <Panel
          title="Pipeline by stage"
          extra={
            pipelineLoading ? null : (
              <span style={panelExtraText}>
                {liveDeals.length} deal{liveDeals.length === 1 ? "" : "s"} total
                {project ? ` · ${project.name}` : ""}
              </span>
            )
          }
          padding={pipelineLoading || stageRows.length === 0 ? 8 : 16}
        >
          {pipelineLoading ? (
            <PanelSpin />
          ) : stageRows.length === 0 ? (
            <EmptyState
              compact
              icon="flag"
              title="No stages yet"
              description="Set up the pipeline in CRM Settings and every deal shows up here by stage."
              action={
                <Button
                  type="primary"
                  onClick={() => go("/crm/settings")}
                >
                  Set up the pipeline
                </Button>
              }
            />
          ) : (
            <EChart
              option={chartOption}
              height={Math.max(180, stageRows.length * 44)}
            />
          )}
        </Panel>

        <Panel
          title="My reminders"
          extra={
            <Button
              type="link"
              size="small"
              style={{ paddingInline: 0 }}
              onClick={() => go("/crm/reminders")}
            >
              All reminders
            </Button>
          }
          padding={
            remindersLoading || authLoading || myReminders.next.length === 0 ? 8 : 0
          }
        >
          {remindersLoading || authLoading ? (
            <PanelSpin />
          ) : remindersError ? (
            <ErrorState
              compact
              title="Couldn't load reminders"
              onRetry={() => void refetchReminders()}
            />
          ) : myReminders.next.length === 0 ? (
            <EmptyState
              compact
              icon="alarm"
              title={nothingHereTitle ?? "Nothing to chase"}
              description="Set a reminder on a lead — “call back Thursday at 4” — and it lands here, overdue first, and fires a notification when it's due."
              action={
                <Button
                  type="primary"
                  onClick={() => go("/crm/deals")}
                >
                  Open the pipeline
                </Button>
              }
            />
          ) : (
            myReminders.next.map((r, index) => {
              const type = r.target_type as CrmTargetRef["type"];
              const name = recordName(r.target_type, r.target_id);
              const exists = name !== "a deleted record";
              const overdue = dayjs(r.remind_at).isBefore(dayjs());
              const deal = type === "deal" ? dealById.get(r.target_id) : null;
              const status = deal ? crmLeadStatusMeta(deal.status) : null;
              const menuKey = `reminder:${r.id}`;
              return (
                <div
                  key={r.id}
                  onContextMenu={openRowMenu(menuKey, () => reminderMenu(r))}
                >
                  <CrmListRow
                    first={index === 0}
                    align="flex-start"
                    style={menuRow === menuKey ? litRow : undefined}
                  >
                    {type === "deal" ? (
                      <DealGlyph name={name} size={28} />
                    ) : (
                      <EntityAvatar kind={type} name={name} size={28} />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {/* The row carries a real Done button, so the record link
                          is its own control rather than the whole row. */}
                      <button
                        type="button"
                        disabled={!exists}
                        onClick={() => setDrawerTarget({ type, id: r.target_id })}
                        style={{
                          ...primaryLine,
                          display: "block",
                          maxWidth: "100%",
                          padding: 0,
                          border: "none",
                          background: "none",
                          fontFamily: "inherit",
                          fontSize: "inherit",
                          textAlign: "left",
                          cursor: exists ? "pointer" : "default",
                        }}
                      >
                        {name}
                      </button>
                      {r.note ? <div style={mutedLine}>{r.note}</div> : null}
                      <div
                        style={{
                          ...mutedLine,
                          color: overdue
                            ? token.colorError
                            : token.colorTextTertiary,
                        }}
                      >
                        {overdue ? "Overdue · " : ""}
                        {crmDateTime(r.remind_at)}
                      </div>
                    </div>
                    {status ? (
                      <SoftChip
                        tone={status.tone}
                        icon={leadStatusIcon(status.value)}
                        style={{ flex: "none" }}
                      >
                        {status.label}
                      </SoftChip>
                    ) : null}
                    <Tooltip title="Dismiss this reminder">
                      <Button
                        type="text"
                        size="small"
                        style={{ flex: "none" }}
                        icon={<MIcon name="check_circle" size={16} />}
                        onClick={() => markReminderDone(r.id)}
                      >
                        Done
                      </Button>
                    </Tooltip>
                  </CrmListRow>
                </div>
              );
            })
          )}
        </Panel>

        <Panel
          title="My open tasks"
          extra={
            <Button
              type="link"
              size="small"
              style={{ paddingInline: 0 }}
              onClick={() => go("/crm/tasks")}
            >
              All tasks
            </Button>
          }
          padding={tasksLoading || myOpenTasks.length === 0 ? 8 : 0}
        >
          {tasksLoading ? (
            <PanelSpin />
          ) : tasksError ? (
            <ErrorState
              compact
              title="Couldn't load tasks"
              onRetry={() => void refetchTasks()}
            />
          ) : myOpenTasks.length === 0 ? (
            <EmptyState
              compact
              icon="task_alt"
              title={nothingHereTitle ?? "Nothing assigned to you"}
              description="No open CRM tasks are waiting on you. Enjoy the calm — or line the next one up."
              action={
                <Button
                  type="primary"
                  onClick={() => go("/crm/tasks")}
                >
                  Create a task
                </Button>
              }
            />
          ) : (
            myOpenTasks.map((t, index) => {
              const overdue = Boolean(
                t.due_at && dayjs(t.due_at).isBefore(dayjs()),
              );
              const menuKey = `task:${t.id}`;
              return (
                <div
                  key={t.id}
                  onContextMenu={openRowMenu(menuKey, () => taskMenu(t))}
                >
                  <CrmListRow
                    first={index === 0}
                    hover={false}
                    style={menuRow === menuKey ? litRow : undefined}
                  >
                    <GlyphChip icon="task_alt" />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={primaryLine}>{t.title}</div>
                      <div style={mutedLine}>
                        {t.due_at ? `Due ${crmDate(t.due_at)}` : "No due date"}
                      </div>
                    </div>
                    {overdue ? (
                      <SoftChip tone="danger" icon="schedule">
                        Overdue
                      </SoftChip>
                    ) : null}
                  </CrmListRow>
                </div>
              );
            })
          )}
        </Panel>

        <Panel
          title="Recent activity"
          extra={
            <span style={panelExtraText}>
              Latest 12{project ? ` · ${project.name}` : ""}
            </span>
          }
          padding={activitiesLoading || visibleActivities.length === 0 ? 8 : 0}
        >
          {activitiesLoading ? (
            <PanelSpin />
          ) : visibleActivities.length === 0 ? (
            <EmptyState
              compact
              icon="history"
              title={nothingHereTitle ?? "No CRM activity yet"}
              description="Add a person, company, or deal — every create, edit, and stage move shows up in this feed."
              action={
                <Button
                  type="primary"
                  onClick={() => go("/crm/people")}
                >
                  Add your first person
                </Button>
              }
            />
          ) : (
            visibleActivities.map((a, index) => {
              const name = recordName(a.target_type, a.target_id);
              const exists = name !== "a deleted record";
              const meta = eventMeta(a.event);
              const actor = userName(a.actor_id);
              return (
                <CrmListRow
                  key={a.id}
                  first={index === 0}
                  onClick={
                    exists
                      ? () =>
                          setDrawerTarget({
                            type: a.target_type as CrmTargetRef["type"],
                            id: a.target_id,
                          })
                      : undefined
                  }
                >
                  <EntityAvatar kind="person" name={actor} size={28} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        lineHeight: 1.4,
                        color: token.colorTextSecondary,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 500,
                          color: token.colorText,
                        }}
                      >
                        {actor}
                      </span>{" "}
                      {activityLine(a, name)}
                    </div>
                    <Tooltip title={crmDateTime(a.created_at)}>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 11.5,
                          lineHeight: 1.4,
                          color: token.colorTextTertiary,
                        }}
                      >
                        {crmFromNow(a.created_at)}
                      </span>
                    </Tooltip>
                  </div>
                  <SoftChip
                    tone={meta.tone}
                    icon={meta.icon}
                    style={{ flex: "none" }}
                  >
                    {meta.label}
                  </SoftChip>
                </CrmListRow>
              );
            })
          )}
        </Panel>
      </div>

      <RecordDrawer
        target={drawerTarget}
        onClose={() => setDrawerTarget(null)}
      />

      {/* The reminder and task rows' right-click menu and what it opens —
          out here, so their portal events never bubble through a row. */}
      {rowMenu.element}
      {recordMenu.dialogs}
      <Modal
        open={snoozing !== null}
        title="Snooze reminder"
        okText="Snooze"
        onOk={() => void submitSnooze()}
        onCancel={() => setSnoozing(null)}
        okButtonProps={{ disabled: !snoozeAt }}
        confirmLoading={updateReminder.isPending}
        destroyOnHidden
        width={420}
      >
        {snoozing ? (
          <div style={{ ...mutedLine, fontSize: 13, marginBottom: 12 }}>
            {recordName(snoozing.target_type, snoozing.target_id)}
            {snoozing.note ? ` · ${snoozing.note}` : ""}
          </div>
        ) : null}
        <DatePicker
          value={snoozeAt}
          onChange={(value) => setSnoozeAt(value ?? null)}
          showTime={{ format: "HH:mm", minuteStep: 5 }}
          format={CRM_REMIND_AT_FORMAT}
          disabledDate={crmDisabledRemindDate}
          allowClear={false}
          style={{ width: "100%" }}
        />
      </Modal>

      {/* Paste a lead anywhere on this page, or use New deal. */}
      <DealQuickCreate
        open={dealFormOpen}
        onClose={() => setDealFormOpen(false)}
        onPasteTable={(text) => {
          setImportText(text);
          setImportOpen(true);
        }}
      />

      <LeadImportDialog
        open={importOpen}
        initialText={importText}
        onClose={() => {
          setImportOpen(false);
          setImportText(null);
        }}
      />
    </div>
  );
}
