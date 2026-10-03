"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, DatePicker, Popover, Tooltip } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { MIcon, useC } from "./ui";
import { PLATFORM_BRANDS, PlatformIcon } from "./platform-icons";
import {
  CONTENT_TYPE_META,
  SOCIAL_POST_STATUS_META,
  type SocialCampaignWithProject,
  type SocialPostStatus,
  type SocialPostWithRelations,
} from "./use-content-studio";

/**
 * The Planner: one week of content, and what still has no slot.
 *
 * A week board, not a calendar — the month grid is the Calendar tab. Each day
 * is a column of compact chips (time, status, title, destinations); a chip
 * opens the full post card in a popover, where the status action lives. Empty
 * days stay quiet: the "+" to plan something appears on hover (always on touch
 * screens). "Needs a slot" lists drafts and approvals with no date, each with
 * a date picker that puts it on the board (and moves the board to that week).
 *
 * Layout follows the Planner's OWN width, not the viewport's (the app shell
 * and the project rail eat 300px+): wide → seven columns and the side panel,
 * medium → seven columns with the panel below, narrow → one day per row.
 *
 * Campaign chips on top filter the board and the list; new content made while
 * a campaign is chosen is filed under it, so it does not vanish from view.
 */

const DEFAULT_HOUR = 10;
/** Below this, seven columns are too narrow for a chip. */
const WEEK_MIN_WIDTH = 820;
/** Below this, the side panel moves under the board. */
const SIDE_MIN_WIDTH = 1180;

type Layout = "wide" | "medium" | "narrow";

export function ContentPlanner({
  posts,
  campaigns,
  renderPostCard,
  onNewContent,
  onSchedule,
}: {
  posts: SocialPostWithRelations[];
  campaigns: SocialCampaignWithProject[];
  /** The workspace's own PostCard, reused in the chip popover (status action and all). */
  renderPostCard: (post: SocialPostWithRelations) => React.ReactNode;
  /** Opens the content form, with the slot (and campaign) preselected when known. */
  onNewContent: (at?: Dayjs, campaignId?: string | null) => void;
  /** Gives an unscheduled item its slot. Resolves true when it was saved. */
  onSchedule: (post: SocialPostWithRelations, at: Dayjs) => Promise<boolean>;
}) {
  const C = useC();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [weekStart, setWeekStart] = useState<Dayjs>(() => startOfWeek(dayjs()));
  const [pickedCampaign, setPickedCampaign] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 1200));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const layout: Layout = width >= SIDE_MIN_WIDTH ? "wide" : width >= WEEK_MIN_WIDTH ? "medium" : "narrow";
  const stacked = layout === "narrow";

  const today = dayjs().startOf("day");
  const liveCampaigns = useMemo(
    () => campaigns.filter((c) => !c.end_date || !dayjs(c.end_date).isBefore(dayjs().startOf("day"), "day")),
    [campaigns],
  );
  // The filter that is really applied: a campaign from another project scope
  // (the sidebar switched) or one that ended is simply no filter.
  const campaignId = pickedCampaign && liveCampaigns.some((c) => c.id === pickedCampaign) ? pickedCampaign : null;

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => weekStart.add(i, "day")), [weekStart]);

  const byDay = useMemo(() => {
    const map = new Map<string, SocialPostWithRelations[]>();
    for (const d of days) map.set(d.format("YYYY-MM-DD"), []);
    for (const p of posts) {
      if (!p.scheduled_for || (campaignId && p.campaign?.id !== campaignId)) continue;
      map.get(dayjs(p.scheduled_for).format("YYYY-MM-DD"))?.push(p);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""));
    }
    return map;
  }, [days, posts, campaignId]);

  const unscheduled = useMemo(
    () =>
      posts
        .filter(
          (p) =>
            !p.scheduled_for &&
            (p.status === "draft" || p.status === "pending_approval") &&
            (!campaignId || p.campaign?.id === campaignId),
        )
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
    [posts, campaignId],
  );

  const weekCount = [...byDay.values()].reduce((n, l) => n + l.length, 0);
  const isThisWeek = weekStart.isSame(startOfWeek(dayjs()), "day");

  const schedule = async (post: SocialPostWithRelations, at: Dayjs) => {
    // Show where it went: an item dated into another week would otherwise
    // leave the list and appear nowhere on screen.
    if (await onSchedule(post, at)) setWeekStart(startOfWeek(at));
  };

  const board = (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.hair}`,
        borderRadius: 16,
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: stacked ? "minmax(0, 1fr)" : "repeat(7, minmax(0, 1fr))",
        minWidth: 0,
      }}
    >
      {days.map((day, i) => {
        const key = day.format("YYYY-MM-DD");
        const items = byDay.get(key) ?? [];
        const isToday = day.isSame(today, "day");
        const past = day.isBefore(today, "day");
        return (
          <div
            key={key}
            className="cs-plan-day"
            style={{
              minWidth: 0,
              minHeight: stacked ? undefined : 260,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              borderLeft: !stacked && i > 0 ? `1px solid ${C.hair}` : undefined,
              borderTop: stacked && i > 0 ? `1px solid ${C.hair}` : undefined,
              background: isToday ? C.accentSoft : "transparent",
              opacity: past ? 0.6 : 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: isToday ? C.accent : C.textTertiary,
                  flex: "none",
                }}
              >
                {day.format("ddd")}
              </span>
              <span style={{ fontSize: 15, fontWeight: 800, color: isToday ? C.accent : C.text, flex: "none" }}>
                {day.format("D")}
              </span>
              {isToday && (stacked || layout === "wide") ? (
                <span style={{ fontSize: 11, fontWeight: 600, color: C.accent, overflow: "hidden", whiteSpace: "nowrap" }}>Today</span>
              ) : null}
              <span style={{ flex: 1 }} />
              {!past ? (
                <Tooltip title={`Plan something for ${day.format("ddd D MMM")}`}>
                  <button
                    type="button"
                    className="cs-plan-add"
                    aria-label={`New content on ${day.format("D MMM")}`}
                    onClick={() => onNewContent(slotFor(day), campaignId)}
                    style={{
                      border: "none",
                      background: C.accentSoft,
                      color: C.accent,
                      borderRadius: 6,
                      width: 22,
                      height: 22,
                      padding: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      flex: "none",
                    }}
                  >
                    <MIcon name="add" size={16} />
                  </button>
                </Tooltip>
              ) : null}
            </div>
            {items.map((post) => (
              <PlanChip key={post.id} post={post} stacked={stacked} renderPostCard={renderPostCard} />
            ))}
            {items.length === 0 && stacked ? (
              <span style={{ fontSize: 12, color: C.textTertiary }}>Nothing planned</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  const sidePanel = (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.hair}`,
        borderRadius: 16,
        padding: 12,
        display: "grid",
        gap: 8,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <MIcon name="pending_actions" size={17} color={C.textSecondary} />
        <span style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>Needs a slot</span>
        <span style={{ fontSize: 12, color: C.textTertiary }}>{unscheduled.length || ""}</span>
      </div>
      {unscheduled.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.textTertiary, display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
          <MIcon name="check_circle" size={16} color={C.green} />
          Every draft has a date.
        </div>
      ) : (
        unscheduled.map((post) => (
          <UnscheduledRow key={post.id} post={post} stacked={layout !== "wide"} renderPostCard={renderPostCard} onSchedule={schedule} />
        ))
      )}
    </div>
  );

  return (
    <div ref={wrapRef} style={{ display: "grid", gap: 14, minWidth: 0 }}>
      {/* Week navigation + the one primary action. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Button aria-label="Previous week" icon={<MIcon name="chevron_left" size={18} />} onClick={() => setWeekStart((w) => w.subtract(7, "day"))} />
          <Button disabled={isThisWeek} onClick={() => setWeekStart(startOfWeek(dayjs()))}>
            This week
          </Button>
          <Button aria-label="Next week" icon={<MIcon name="chevron_right" size={18} />} onClick={() => setWeekStart((w) => w.add(7, "day"))} />
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>{weekLabel(weekStart)}</div>
        <span style={{ fontSize: 12.5, color: C.textTertiary }}>
          {weekCount === 0 ? "Nothing planned" : `${weekCount} planned`}
        </span>
        <span style={{ flex: 1 }} />
        <Button type="primary" icon={<MIcon name="add" size={16} />} onClick={() => onNewContent(undefined, campaignId)}>
          New content
        </Button>
      </div>

      {/* Campaigns as filter chips, not cards. */}
      {liveCampaigns.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} role="group" aria-label="Filter by campaign">
          <span style={{ fontSize: 12, color: C.textTertiary, marginRight: 2 }}>Campaign</span>
          <FilterChip active={campaignId === null} onClick={() => setPickedCampaign(null)}>
            All
          </FilterChip>
          {liveCampaigns.map((c) => (
            <FilterChip
              key={c.id}
              active={campaignId === c.id}
              color={c.theme_color}
              onClick={() => setPickedCampaign(campaignId === c.id ? null : c.id)}
            >
              {c.name}
            </FilterChip>
          ))}
        </div>
      ) : null}

      {layout === "wide" ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 14, alignItems: "start" }}>
          {board}
          {sidePanel}
        </div>
      ) : (
        <>
          {board}
          {sidePanel}
        </>
      )}

      <style>{`
        .cs-plan-add { opacity: 0; transition: opacity .12s ease; }
        .cs-plan-day:hover .cs-plan-add, .cs-plan-add:focus-visible { opacity: 1; }
        @media (hover: none) { .cs-plan-add { opacity: 1; } }
      `}</style>
    </div>
  );
}

/** One post on a day: time, status dot, title, destination logos. Opens the full card. */
function PlanChip({
  post,
  stacked,
  renderPostCard,
}: {
  post: SocialPostWithRelations;
  stacked: boolean;
  renderPostCard: (post: SocialPostWithRelations) => React.ReactNode;
}) {
  const C = useC();
  const status = SOCIAL_POST_STATUS_META[post.status as SocialPostStatus] ?? SOCIAL_POST_STATUS_META.draft;
  const platforms = [
    ...new Set(
      post.channels
        .map((c) => c.channel?.platform)
        .filter((p): p is string => Boolean(p && PLATFORM_BRANDS[p])),
    ),
  ];
  const time = post.scheduled_for ? dayjs(post.scheduled_for).format("h:mm A") : "";
  return (
    <PostPopover stacked={stacked} placement="rightTop" content={renderPostCard(post)}>
      <button
        type="button"
        aria-label={`${time} · ${status.label} · ${post.title}`}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 4,
          width: "100%",
          minWidth: 0,
          overflow: "hidden",
          textAlign: "left",
          padding: "7px 8px",
          borderRadius: 10,
          border: `1px solid ${C.hair}`,
          borderLeft: `3px solid ${post.campaign?.theme_color ?? status.tone}`,
          background: C.panel,
          cursor: "pointer",
          color: C.text,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textTertiary, minWidth: 0, overflow: "hidden" }}>
          <span title={status.label} style={{ width: 7, height: 7, borderRadius: 999, background: status.tone, flex: "none" }} />
          <span style={{ whiteSpace: "nowrap", flex: "none" }}>{time}</span>
          <span style={{ flex: 1, minWidth: 0 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" }}>
            {platforms.slice(0, 2).map((p) => (
              <PlatformIcon key={p} platform={p} size={12} color={brandColor(p, C.text)} />
            ))}
            {platforms.length > 2 ? <span style={{ whiteSpace: "nowrap" }}>+{platforms.length - 2}</span> : null}
          </span>
        </span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1.3,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            wordBreak: "break-word",
          }}
        >
          {post.title}
        </span>
      </button>
    </PostPopover>
  );
}

/**
 * The full post card in a popover. Focus moves into it on open (so its status
 * action is reachable from the keyboard) and back to the trigger on close; in
 * narrow layouts it opens below the trigger, the only side with room.
 */
function PostPopover({
  stacked,
  placement,
  content,
  children,
}: {
  stacked: boolean;
  placement: "rightTop" | "leftTop";
  content: React.ReactNode;
  children: React.ReactElement;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  return (
    <Popover
      trigger="click"
      placement={stacked ? "bottom" : placement}
      onOpenChange={(open) => {
        if (open) requestAnimationFrame(() => bodyRef.current?.focus());
        else (triggerRef.current?.querySelector("button") as HTMLButtonElement | null)?.focus();
      }}
      content={
        <div ref={bodyRef} tabIndex={-1} style={{ width: 320, maxWidth: "80vw", outline: "none" }}>
          {content}
        </div>
      }
    >
      <span ref={triggerRef} style={{ display: "block", minWidth: 0 }}>
        {children}
      </span>
    </Popover>
  );
}

/** A draft or approval with no date, and the date picker that gives it one. */
function UnscheduledRow({
  post,
  stacked,
  renderPostCard,
  onSchedule,
}: {
  post: SocialPostWithRelations;
  stacked: boolean;
  renderPostCard: (post: SocialPostWithRelations) => React.ReactNode;
  onSchedule: (post: SocialPostWithRelations, at: Dayjs) => Promise<void>;
}) {
  const C = useC();
  const [picking, setPicking] = useState(false);
  const status = SOCIAL_POST_STATUS_META[post.status as SocialPostStatus] ?? SOCIAL_POST_STATUS_META.draft;
  const type = CONTENT_TYPE_META[post.content_type as keyof typeof CONTENT_TYPE_META];
  const now = dayjs();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 8px",
        borderRadius: 10,
        border: `1px solid ${C.hair}`,
        minWidth: 0,
      }}
    >
      <PostPopover stacked={stacked} placement="leftTop" content={renderPostCard(post)}>
        <button
          type="button"
          style={{ width: "100%", minWidth: 0, textAlign: "left", border: "none", background: "transparent", padding: 0, cursor: "pointer", color: C.text }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{post.title}</div>
          <div style={{ fontSize: 11, color: C.textTertiary, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: status.tone }} />
            {status.label}
            {type ? ` · ${type.label}` : ""}
          </div>
        </button>
      </PostPopover>
      <span style={{ flex: 1 }} />
      {picking ? (
        <DatePicker
          open
          autoFocus
          size="small"
          showTime={{ format: "HH:mm", defaultValue: slotFor(now).startOf("minute") }}
          format="D MMM HH:mm"
          disabledDate={(d) => d.isBefore(now.startOf("day"))}
          disabledTime={(d) =>
            d && d.isSame(now, "day")
              ? {
                  disabledHours: () => Array.from({ length: now.hour() }, (_, h) => h),
                  disabledMinutes: (h: number) => (h === now.hour() ? Array.from({ length: now.minute() + 1 }, (_, m) => m) : []),
                }
              : {}
          }
          onOpenChange={(open) => {
            if (!open) setPicking(false);
          }}
          onChange={(value) => {
            setPicking(false);
            if (value) void onSchedule(post, value);
          }}
          style={{ width: 130, flex: "none" }}
        />
      ) : (
        <Button size="small" style={{ flex: "none" }} onClick={() => setPicking(true)}>
          Pick a date
        </Button>
      )}
    </div>
  );
}

function FilterChip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const C = useC();
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${active ? C.accent : C.hair}`,
        background: active ? C.accentSoft : C.panel,
        color: active ? C.accent : C.textSecondary,
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
      }}
    >
      {color ? <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} /> : null}
      {children}
    </button>
  );
}

/**
 * The slot a day's "+" proposes: 10:00 — or, today after 10:00, the next
 * whole hour, so a new item is never born in the past.
 */
function slotFor(day: Dayjs): Dayjs {
  const at = day.hour(DEFAULT_HOUR).minute(0).second(0).millisecond(0);
  const now = dayjs();
  return day.isSame(now, "day") && at.isBefore(now) ? now.add(1, "hour").startOf("hour") : at;
}

/** Brand colours that vanish on the panel (X, TikTok, Threads are black) draw in the text colour. */
function brandColor(platform: string, text: string): string {
  const c = PLATFORM_BRANDS[platform]?.color;
  return !c || c.toLowerCase() === "#000000" || c.toLowerCase() === "#000" ? text : c;
}

/** Monday-first, like the Calendar tab. */
function startOfWeek(d: Dayjs): Dayjs {
  const day = d.startOf("day");
  return day.subtract((day.day() + 6) % 7, "day");
}

function weekLabel(start: Dayjs): string {
  const end = start.add(6, "day");
  if (start.month() === end.month()) return `${start.format("D")} – ${end.format("D MMM YYYY")}`;
  if (start.year() === end.year()) return `${start.format("D MMM")} – ${end.format("D MMM YYYY")}`;
  return `${start.format("D MMM YYYY")} – ${end.format("D MMM YYYY")}`;
}
