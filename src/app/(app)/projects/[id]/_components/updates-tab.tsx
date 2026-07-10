"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Card,
  Empty,
  List,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
  theme,
} from "antd";
import { SendOutlined, ThunderboltOutlined, UserOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import {
  useProjectComments,
  useAddProjectComment,
} from "@/features/projects/use-project-comments";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import {
  TeamMentionInput,
  extractMentionUserIds,
} from "@/features/team-members/team-mention-input";
import { useAiStandup, type AiStandupResult } from "@/features/ai/use-ai";
import {
  useProjectActivity,
  describeActivity,
  activityGlyph,
  type ProjectActivity,
} from "@/features/activity/use-activity";

const { Text, Title } = Typography;

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function dayLabel(iso: string): string {
  const d = dayjs(iso);
  const today = dayjs().startOf("day");
  if (d.isSame(today, "day")) return "Today";
  if (d.isSame(today.subtract(1, "day"), "day")) return "Yesterday";
  return d.format("MMM D, YYYY");
}

/** The whole-project task activity feed, grouped by day. */
function ActivityFeed({ projectId }: { projectId: string }) {
  const { token } = theme.useToken();
  const { data: activity, isLoading } = useProjectActivity(projectId);

  const groups = useMemo(() => {
    const map = new Map<string, ProjectActivity[]>();
    for (const a of activity ?? []) {
      const key = dayLabel(a.created_at);
      (map.get(key) ?? map.set(key, []).get(key)!).push(a);
    }
    return [...map.entries()];
  }, [activity]);

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
        <Spin />
      </div>
    );
  }
  if ((activity ?? []).length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="No task activity yet — changes to any task in this project show up here."
        style={{ margin: "28px 0" }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {groups.map(([day, items]) => (
        <div key={day}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, color: token.colorTextTertiary, textTransform: "uppercase", marginBottom: 8 }}>
            {day}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {items.map((a) => {
              const g = activityGlyph(a.action);
              return (
                <div key={a.id} style={{ display: "flex", gap: 10, padding: "7px 2px", alignItems: "flex-start" }}>
                  <span style={{ position: "relative", flex: "none", marginTop: 1 }}>
                    <Avatar size={26} src={a.user?.avatar_url ?? undefined} style={{ fontSize: 11 }}>
                      {initials(a.user?.name ?? "?")}
                    </Avatar>
                    <span
                      style={{
                        position: "absolute",
                        right: -3,
                        bottom: -3,
                        width: 15,
                        height: 15,
                        borderRadius: 999,
                        background: token.colorBgContainer,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 12, color: g.color }}>
                        {g.icon}
                      </span>
                    </span>
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: token.colorText, lineHeight: 1.5 }}>
                      <b>{a.user?.name ?? "Someone"}</b> {describeActivity(a)}
                      {a.task ? (
                        <>
                          {" "}
                          <Link href={`/projects/${projectId}?task=${a.task.id}`} style={{ color: token.colorPrimary }}>
                            {typeof a.task.task_no === "number" ? `#${a.task.task_no} ` : ""}
                            {a.task.name}
                          </Link>
                        </>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
                      {dayjs(a.created_at).format("h:mm A")}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local types.                                                               */
/*                                                                            */
/* The comment feed shape comes from Agent A's `useProjectComments` hook. The */
/* tab only renders a small set of fields, so it carries its own narrow row   */
/* type (a project_comments row joined to its author) and reads it            */
/* structurally to stay decoupled from the hook's exact export.              */
/* -------------------------------------------------------------------------- */

interface ProjectCommentEntry {
  id: string;
  content: string;
  created_at: string;
  mentions: string[] | null;
  author: {
    id: string;
    name: string | null;
    avatar_url: string | null;
  } | null;
}

/**
 * Project "Updates" feed.
 *
 * Shows the project's comment stream (newest-or-oldest as the hook orders it)
 * plus a composer with an @mention picker. Selected members are passed as
 * `mentions[]` (an array of user ids) to `useAddProjectComment`, whose DB
 * trigger notifies them.
 */
export function UpdatesTab({ projectId }: { projectId: string }) {
  const { message } = App.useApp();

  const { data: commentsRaw, isLoading } = useProjectComments(projectId);
  const addComment = useAddProjectComment();
  const { data: membersRaw } = useTeamMembers();

  const comments = (commentsRaw ?? []) as unknown as ProjectCommentEntry[];

  const [seg, setSeg] = useState<"activity" | "updates">("activity");
  const [content, setContent] = useState("");

  // AI standup: generated summary held locally until posted or dismissed.
  const aiStandup = useAiStandup();
  const [standup, setStandup] = useState<AiStandupResult | null>(null);

  const handleGenerateStandup = async () => {
    try {
      const result = await aiStandup.mutateAsync({ projectId, days: 7 });
      setStandup(result);
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to generate standup.",
      );
    }
  };

  const handlePostStandup = async () => {
    if (!standup) return;
    try {
      await addComment.mutateAsync({ projectId, content: standup.summary });
      setStandup(null);
      message.success("Standup posted.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to post standup.",
      );
    }
  };

  // Picker options are keyed by *user id* (mentions is a uuid[] of users), with
  // invited-but-not-joined membership rows (no user) filtered out.
  const mentionMembers = useMemo(
    () =>
      (membersRaw ?? [])
        .filter((m) => m.user != null)
        .map((m) => ({
          id: m.user!.id,
          name: m.user!.name ?? m.user!.email ?? "Unknown",
          avatarUrl: m.user!.avatar_url,
          email: m.user!.email,
        })),
    [membersRaw],
  );

  // Resolve a user id to a display name for rendering mention chips on a feed
  // item even when the author embed doesn't carry the mentioned users.
  const nameByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of membersRaw ?? []) {
      if (m.user) map.set(m.user.id, m.user.name ?? m.user.email ?? "Unknown");
    }
    return map;
  }, [membersRaw]);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const mentions = extractMentionUserIds(content, mentionMembers);
    try {
      await addComment.mutateAsync({
        projectId,
        content: trimmed,
        mentions: mentions.length > 0 ? mentions : undefined,
      });
      setContent("");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to post update.",
      );
    }
  };

  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={5} style={{ marginTop: 0, marginBottom: 4 }}>
            {seg === "activity" ? "Activity" : "Updates"}
          </Title>
          <Text type="secondary">
            {seg === "activity"
              ? "Everything that's happened on this project's tasks."
              : "Post an update and @mention teammates to notify them."}
          </Text>
        </div>
        <Segmented
          value={seg}
          onChange={(v) => setSeg(v as "activity" | "updates")}
          options={[
            { label: "Activity", value: "activity" },
            { label: "Updates", value: "updates" },
          ]}
        />
      </div>

      {seg === "activity" ? (
        <ActivityFeed projectId={projectId} />
      ) : (
      <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <Button
          icon={<ThunderboltOutlined />}
          loading={aiStandup.isPending}
          onClick={handleGenerateStandup}
        >
          Generate standup
        </Button>
      </div>

      {/* AI standup preview — post it as an update or dismiss. */}
      {standup && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            background: "#f6f7f9",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <Space size={8} wrap>
            <Text strong style={{ fontSize: 13 }}>
              AI standup — last {standup.stats.days} days
            </Text>
            <Tag style={{ borderRadius: 6, marginInlineEnd: 0 }}>
              {standup.stats.completed} done
            </Tag>
            <Tag
              color={standup.stats.overdue > 0 ? "warning" : undefined}
              style={{ borderRadius: 6, marginInlineEnd: 0 }}
            >
              {standup.stats.overdue} overdue
            </Tag>
            <Tag style={{ borderRadius: 6, marginInlineEnd: 0 }}>
              {standup.stats.dueSoon} due soon
            </Tag>
          </Space>
          <div
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {standup.summary}
          </div>
          <Space size={8}>
            <Button
              size="small"
              type="primary"
              icon={<SendOutlined />}
              loading={addComment.isPending}
              onClick={handlePostStandup}
            >
              Post as update
            </Button>
            <Button size="small" type="text" onClick={() => setStandup(null)}>
              Dismiss
            </Button>
          </Space>
        </div>
      )}

      {/* Composer ------------------------------------------------------- */}
      <div style={{ marginTop: 16, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TeamMentionInput
              value={content}
              onChange={setContent}
              members={mentionMembers}
              placeholder="Write an update…  (type @ to mention)"
              autoSize={{ minRows: 2, maxRows: 6 }}
            />
          </div>
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={addComment.isPending}
            onClick={handleSubmit}
            disabled={!content.trim()}
          >
            Post
          </Button>
        </div>
      </div>

      {/* Feed ----------------------------------------------------------- */}
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spin />
        </div>
      ) : comments.length > 0 ? (
        <List
          itemLayout="horizontal"
          dataSource={comments}
          renderItem={(c) => {
            const mentionIds = c.mentions ?? [];
            return (
              <List.Item key={c.id} style={{ paddingInline: 0 }}>
                <List.Item.Meta
                  avatar={
                    <Avatar
                      src={c.author?.avatar_url ?? undefined}
                      icon={<UserOutlined />}
                    />
                  }
                  title={
                    <Space size={8} wrap>
                      <Text strong style={{ fontSize: 13 }}>
                        {c.author?.name ?? "Unknown"}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(c.created_at).format("MMM D, YYYY h:mm A")}
                      </Text>
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={4}>
                      <Text style={{ whiteSpace: "pre-wrap" }}>{c.content}</Text>
                      {mentionIds.length > 0 ? (
                        <Space size={4} wrap>
                          {mentionIds.map((uid) => (
                            <Tag key={uid} color="blue">
                              @{nameByUserId.get(uid) ?? "member"}
                            </Tag>
                          ))}
                        </Space>
                      ) : null}
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No updates yet"
          style={{ margin: "24px 0" }}
        />
      )}
      </>
      )}
    </Card>
  );
}
