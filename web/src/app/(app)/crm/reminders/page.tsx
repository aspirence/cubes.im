"use client";

import { useMemo, useState } from "react";
import { App, Button, Checkbox, Popconfirm, Spin, Tooltip, theme } from "antd";
import dayjs from "dayjs";
import { useAuth } from "@/features/auth/use-auth";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import {
  useCompleteCrmReminder,
  useCrmReminders,
  useDeleteCrmReminder,
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
import { ReminderReschedule } from "../_components/reminder-controls";
import { CrmListRow } from "../_components/list-row";
import { CrmToggle } from "../_components/crm-toggle";
import { BulkBar, useBulkRun } from "../_components/bulk-bar";
import { TILE_GRID } from "../_components/layout";
import { entityMeta } from "../_components/entity-meta";
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
type LinkedRecord = { name: string; avatar: string | null } | undefined;

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
  const { message } = App.useApp();
  const { user, loading: authLoading } = useAuth();
  const {
    data: reminders,
    isLoading: remindersLoading,
    isError,
    error,
    refetch,
  } = useCrmReminders();
  // Until auth resolves, "mine" is unknowable — don't flash an empty desk.
  const isLoading = remindersLoading || authLoading;
  const { data: people } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const { data: deals } = useCrmDeals();
  const { data: members } = useTeamMembers();
  const completeReminder = useCompleteCrmReminder();
  const deleteReminder = useDeleteCrmReminder();
  const [viewTarget, setViewTarget] = useState<CrmTargetRef | null>(null);
  const [search, setSearch] = useState("");
  const [onlyMine, setOnlyMine] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const bulk = useBulkRun(() => setSelected([]));

  /** One lookup for all three record types, keyed like the polymorphic pair. */
  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) if (m.user) map.set(m.user.id, m.user.name);
    return (id: string) =>
      id === user?.id ? "you" : (map.get(id) ?? "a teammate");
  }, [members, user?.id]);

  const recordInfo = useMemo(() => {
    const map = new Map<string, { name: string; avatar: string | null }>();
    for (const p of people ?? []) {
      map.set(`person:${p.id}`, {
        name: crmPersonName(p) || "Unnamed person",
        avatar: p.avatar_url,
      });
    }
    for (const c of companies ?? []) {
      map.set(`company:${c.id}`, { name: c.name, avatar: null });
    }
    for (const d of deals ?? []) {
      map.set(`deal:${d.id}`, { name: d.name, avatar: null });
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
  }, [reminders, user?.id, onlyMine, search, recordInfo]);

  const markDone = async (id: string) => {
    try {
      await completeReminder.mutateAsync(id);
      message.success("Reminder cleared.");
    } catch (err) {
      message.error(errMsg(err, "Failed to update reminder."));
    }
  };

  const toggleOne = (id: string, on: boolean) =>
    setSelected((prev) =>
      on ? [...prev, id] : prev.filter((x) => x !== id),
    );

  const renderRow = (reminder: CrmReminder, index: number) => {
    const key = `${reminder.target_type}:${reminder.target_id}`;
    const info: LinkedRecord = recordInfo.get(key);
    const meta = entityMeta(reminder.target_type);
    const name = info?.name ?? "A deleted record";
    const overdue = dayjs(reminder.remind_at).isBefore(dayjs());
    const open = info
      ? () =>
          setViewTarget({
            type: reminder.target_type as CrmTargetType,
            id: reminder.target_id,
          })
      : undefined;

    return (
      <CrmListRow
        key={reminder.id}
        first={index === 0}
        align="flex-start"
        hover={Boolean(open)}
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
    </div>
  );
}
