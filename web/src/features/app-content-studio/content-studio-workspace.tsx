"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dayjs, { type Dayjs } from "dayjs";
import {
  App,
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Tag,
  Typography,
  theme,
} from "antd";
import { useAppActivatedProjects } from "@/features/apps-platform/app-scope";
import { useTasks } from "@/features/tasks/use-tasks";
import {
  humanSize,
  useTeamFiles,
  type FileWithMeta,
} from "@/features/app-files/use-files";
import {
  useInstalledApps,
  useInstallApp,
  useIsTeamAdmin,
} from "@/features/apps-platform/use-installed-apps";
import {
  CONTENT_TYPES,
  CONTENT_TYPE_META,
  DESTINATION_KINDS,
  SOCIAL_POST_STATUS_META,
  isSocialContentType,
  isSocialDestinationKind,
  useCreateSocialCampaign,
  useCreateSocialChannel,
  useCreateSocialPost,
  useContentStudioCampaigns,
  useContentStudioChannels,
  useContentStudioPosts,
  useUpdateSocialPost,
  SOCIAL_PLATFORMS,
  type ContentType,
  type DestinationKind,
  type SocialCampaignWithProject,
  type SocialPlatform,
  type SocialPostStatus,
  type SocialPostWithRelations,
} from "./use-content-studio";
import {
  PLATFORM_BRANDS,
  PLATFORM_MAX_LEN,
  PlatformIcon,
  PlatformBadge,
  DestinationBadge,
  DestinationKindBadge,
  DestinationKindIcon,
  destinationKindBrand,
} from "./platform-icons";
import { MIcon, useC } from "./ui";
import { NotionEditor } from "@/features/editor/notion-editor";
import { SocialCalendarView } from "./content-calendar-view";
import { SocialRoutinesView } from "./routines-view";
import { ContentPlanner } from "./planner-view";
import { TaskDrawer } from "@/app/(app)/projects/[id]/_components/task-drawer";
import { CreateTaskModal } from "@/features/tasks/create-task-modal";
import { useCanCreateTasks } from "@/features/team-members/use-team-members";
import { useAdoptContentTask } from "./use-content-calendar";

const { Title, Paragraph } = Typography;
const { TextArea } = Input;

// Aligned to the platform design language (indigo primary, neutral greys,
// token hairlines) so Content Studio reads as part of Cubes rather than a
// separate product. Semantic status colors (red/green/gold) are kept.
// Neutral surfaces/text derive from AntD theme tokens so dark mode works.
/** Resolve a platform's brand meta with a safe fallback for unknown values. */
function brandMeta(platform: string): { label: string; mono: string; color: string } {
  const b = PLATFORM_BRANDS[platform];
  return {
    label: b?.label ?? platform,
    mono: b?.mono ?? platform.slice(0, 2).toUpperCase(),
    color: b?.color ?? "#6a6d78",
  };
}

/**
 * How to name and colour a destination. A social account is its platform — a
 * blog or a newsletter is its kind, because its `platform` column only holds a
 * slug and there is no logo behind it.
 */
function destinationMeta(
  platform: string,
  kind: string | null | undefined,
): { label: string; color: string } {
  if (isSocialDestinationKind(kind)) {
    const b = brandMeta(platform);
    return { label: b.label, color: b.color };
  }
  const k = destinationKindBrand(kind);
  return { label: k.label, color: k.color };
}

/** "@handle" reads as a social handle; other destinations just show the value. */
function destinationHandle(handle: string, kind: string | null | undefined): string {
  const bare = handle.replace(/^@/, "");
  return isSocialDestinationKind(kind) ? `@${bare}` : bare;
}

function ContentTypeTag({ type }: { type: string | null | undefined }) {
  const meta = CONTENT_TYPE_META[(type ?? "social_post") as ContentType]
    ?? CONTENT_TYPE_META.other;
  return (
    <Tag
      style={{
        margin: 0,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: meta.tone,
        background: `${meta.tone}14`,
        borderColor: `${meta.tone}33`,
      }}
    >
      <MIcon name={meta.icon} size={13} color={meta.tone} />
      {meta.label}
    </Tag>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return "No date";
  return dayjs(value).format("ddd, D MMM • h:mm A");
}

function startOfNextSlot(): string {
  return dayjs().add(1, "day").hour(10).minute(0).second(0).millisecond(0).toISOString();
}

function StatusPill({ status }: { status: SocialPostStatus }) {
  const meta = SOCIAL_POST_STATUS_META[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        borderRadius: 999,
        background: meta.soft,
        color: meta.tone,
        fontSize: 11.5,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: meta.tone,
        }}
      />
      {meta.label}
    </span>
  );
}

function PlatformChip({
  platform,
  handle,
  kind,
}: {
  platform: string;
  handle?: string | null;
  kind?: string | null;
}) {
  const C = useC();
  const social = isSocialDestinationKind(kind);
  const meta = destinationMeta(platform, kind);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 8px",
        borderRadius: 999,
        background: C.panel,
        border: `1px solid ${C.hair}`,
        fontSize: 11.5,
        color: C.textSecondary,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          background: `${meta.color}1a`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {social ? (
          <PlatformIcon platform={platform} size={12} color={meta.color} />
        ) : (
          <DestinationKindIcon kind={kind} size={12} color={meta.color} />
        )}
      </span>
      <span>{handle ? destinationHandle(handle, kind) : meta.label}</span>
    </span>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: string;
  label: string;
  value: string | number;
  detail: string;
  tone: string;
}) {
  const C = useC();
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.hair}`,
        borderRadius: 14,
        padding: "10px 12px",
        minWidth: 0,
      }}
    >
      {/* Icon sits on the label's row rather than above it: stacking a 38px tile
          with 14px beneath it was most of this card's height, and these tiles are
          read in a row of four, where height costs more than icon presence. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: `${tone}18`,
            color: tone,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 auto",
          }}
        >
          <MIcon name={icon} size={15} color={tone} />
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: C.textTertiary,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            fontWeight: 700,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.text, lineHeight: 1.15, marginTop: 6 }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: C.textSecondary,
          marginTop: 2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {detail}
      </div>
    </div>
  );
}

function ViewTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  const C = useC();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 38,
        padding: "0 14px",
        borderRadius: 12,
        border: "none",
        background: active ? C.text : C.panel,
        color: active ? C.panel : C.textSecondary,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        fontWeight: 600,
        boxShadow: active ? "0 12px 30px rgba(30,29,25,0.16)" : "none",
      }}
    >
      <MIcon name={icon} size={17} color={active ? C.panel : C.textTertiary} />
      {label}
    </button>
  );
}

function EmptyPanel({
  title,
  desc,
  action,
}: {
  title: string;
  desc: string;
  action?: React.ReactNode;
}) {
  const C = useC();
  return (
    <div
      style={{
        background: C.panel,
        border: `1px dashed ${C.hair}`,
        borderRadius: 18,
        padding: "34px 22px",
      }}
    >
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div>
            <div style={{ fontWeight: 700, color: C.text, fontSize: 15 }}>{title}</div>
            <div style={{ color: C.textSecondary, fontSize: 13, marginTop: 4 }}>{desc}</div>
          </div>
        }
      />
      {action ? <div style={{ display: "flex", justifyContent: "center" }}>{action}</div> : null}
    </div>
  );
}

function PostCard({
  post,
  onStatusChange,
}: {
  post: SocialPostWithRelations;
  onStatusChange: (post: SocialPostWithRelations, status: SocialPostStatus) => void;
}) {
  const C = useC();
  const nextAction: Partial<Record<SocialPostStatus, { label: string; to: SocialPostStatus }>> = {
    draft: { label: "Send approval", to: "pending_approval" },
    pending_approval: { label: "Schedule", to: "scheduled" },
    scheduled: { label: "Mark published", to: "published" },
    failed: { label: "Back to draft", to: "draft" },
  };
  const channels: NonNullable<SocialPostWithRelations["channels"][number]["channel"]>[] =
    post.channels
      .map((entry: SocialPostWithRelations["channels"][number]) => entry.channel)
      .filter(
        (
          entry,
        ): entry is NonNullable<SocialPostWithRelations["channels"][number]["channel"]> =>
          Boolean(entry),
      );
  const assets = post.assets.filter(
    (entry: SocialPostWithRelations["assets"][number]) => entry.file,
  );
  const action = nextAction[post.status as SocialPostStatus];

  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.hair}`,
        borderRadius: 16,
        padding: 14,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{post.title}</div>
          <div
            style={{
              fontSize: 12.5,
              color: C.textSecondary,
              marginTop: 4,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {post.body}
          </div>
        </div>
        <StatusPill status={post.status as SocialPostStatus} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {channels.map((channel: NonNullable<SocialPostWithRelations["channels"][number]["channel"]>) => (
          <PlatformChip
            key={channel.id}
            platform={channel.platform}
            handle={channel.handle}
            kind={channel.kind}
          />
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, color: C.textSecondary }}>
        <ContentTypeTag type={post.content_type} />
        {post.campaign ? <Tag style={{ margin: 0 }}>{post.campaign.name}</Tag> : null}
        {post.task ? <Tag style={{ margin: 0 }}>Task #{post.task.task_no ?? "?"}</Tag> : null}
        {post.project ? <Tag style={{ margin: 0 }}>{post.project.name}</Tag> : null}
        {post.scheduled_for ? <Tag style={{ margin: 0 }}>{formatDateTime(post.scheduled_for)}</Tag> : null}
        {assets.length ? <Tag style={{ margin: 0 }}>{assets.length} assets</Tag> : null}
      </div>

      {action ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            size="small"
            onClick={() => onStatusChange(post, action.to)}
          >
            {action.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function InstallPrompt({
  admin,
  installing,
  onInstall,
  onManage,
}: {
  admin: boolean;
  installing: boolean;
  onInstall: () => void;
  onManage: () => void;
}) {
  const C = useC();
  return (
    <div
      style={{
        minHeight: 420,
        background: C.panelSoft,
        border: `1px solid ${C.hair}`,
        borderRadius: 26,
        padding: 28,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div style={{ maxWidth: 560, textAlign: "center" }}>
        <div
          style={{
            width: 70,
            height: 70,
            borderRadius: 22,
            margin: "0 auto 18px",
            background: "linear-gradient(135deg,#6a6ae4,#4a4ad0)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 16px 40px rgba(74,74,208,0.22)",
          }}
        >
          <MIcon name="campaign" size={34} color="#fff" />
        </div>
        <Title level={2} style={{ marginBottom: 8 }}>
          Content Studio
        </Title>
        <Paragraph style={{ color: C.textSecondary, fontSize: 15 }}>
          Postiz-inspired publishing for Cubes: campaigns, content queue,
          channel planning, internal media reuse, and project-linked publishing
          workflows.
        </Paragraph>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
          {admin ? (
            <Button type="primary" size="large" loading={installing} onClick={onInstall}>
              Install Content Studio
            </Button>
          ) : (
            <Button size="large" onClick={onManage}>
              Open App Center
            </Button>
          )}
          <Button size="large" onClick={onManage}>
            Manage apps
          </Button>
        </div>
      </div>
    </div>
  );
}

type ViewKey =
  | "calendar"
  | "routines"
  | "planner"
  | "queue"
  | "media"
  | "analytics"
  | "channels";

type PostDraft = {
  projectId: string;
  taskId: string;
  campaignId: string;
  title: string;
  body: string;
  contentType: ContentType;
  status: SocialPostStatus;
  scheduledFor: Dayjs | null;
  approvalRequired: boolean;
  targetUrl: string;
  channelIds: string[];
  fileIds: string[];
};

const DEFAULT_POST_DRAFT = (projectId?: string): PostDraft => ({
  projectId: projectId ?? "",
  taskId: "",
  campaignId: "",
  title: "",
  body: "",
  contentType: "social_post",
  status: "draft",
  scheduledFor: null,
  approvalRequired: false,
  targetUrl: "",
  channelIds: [],
  fileIds: [],
});

export function ContentStudioWorkspace({
  projectId,
  embedded = false,
}: {
  projectId?: string;
  embedded?: boolean;
}) {
  const router = useRouter();
  const { token } = theme.useToken();
  const C = useC();
  const { message } = App.useApp();
  const { data: installedApps } = useInstalledApps();
  const { data: isTeamAdmin } = useIsTeamAdmin();
  const installApp = useInstallApp();
  const { data: projects } = useAppActivatedProjects("content_studio");

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(projectId);
  const [view, setView] = useState<ViewKey>("calendar");
  const [typeFilter, setTypeFilter] = useState<ContentType | "all">("all");
  const [channelOpen, setChannelOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskDue, setTaskDue] = useState<Dayjs | null>(null);

  const scopeProjectId = projectId ?? selectedProjectId;
  // The same gate Board's composer uses: the can_create_tasks RPC for the
  // project in scope (limited members, the project's own override); with no
  // project chosen it falls back to the member type.
  const canCreateTasks = useCanCreateTasks(scopeProjectId);
  const adoptTask = useAdoptContentTask();
  const { data: channels } = useContentStudioChannels(scopeProjectId, true);
  const { data: campaigns } = useContentStudioCampaigns(scopeProjectId, true);
  const { data: posts } = useContentStudioPosts(scopeProjectId, Boolean(projectId));
  const { data: files } = useTeamFiles();
  const { data: scopeTasks } = useTasks(scopeProjectId);
  const createChannel = useCreateSocialChannel();
  const createCampaign = useCreateSocialCampaign();
  const createPost = useCreateSocialPost();
  const updatePost = useUpdateSocialPost();

  const [channelDraft, setChannelDraft] = useState({
    projectId: scopeProjectId ?? "",
    kind: "social_account" as DestinationKind,
    platform: "instagram" as SocialPlatform | DestinationKind,
    name: "",
    handle: "",
    avatarUrl: "",
    themeColor: "#ff7a45",
    followersCount: "0",
  });
  const [campaignDraft, setCampaignDraft] = useState({
    projectId: scopeProjectId ?? "",
    name: "",
    brief: "",
    goal: "",
    themeColor: "#7c6cf0",
    startDate: null as Dayjs | null,
    endDate: null as Dayjs | null,
  });
  const [postDraft, setPostDraft] = useState<PostDraft>(DEFAULT_POST_DRAFT(scopeProjectId));

  const installRecord = installedApps?.find((entry) => entry.app_key === "content_studio");
  const installed = Boolean(installRecord?.enabled);

  const projectRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of posts ?? []) {
      if (post.project_id) counts.set(post.project_id, (counts.get(post.project_id) ?? 0) + 1);
    }
    return (projects ?? [])
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        color: entry.color_code ?? "#8a8d98",
        count: counts.get(entry.id) ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [projects, posts]);

  // Everything that lists or counts content respects the type filter. The
  // sidebar project counts and the channel/asset usage maps deliberately do not
  // — they answer "how much content is here", not "how much of this type".
  const visiblePosts = useMemo(() => {
    const list = posts ?? [];
    if (typeFilter === "all") return list;
    return list.filter((post) => (post.content_type ?? "social_post") === typeFilter);
  }, [posts, typeFilter]);

  const visibleFiles = useMemo(() => {
    const source = files ?? [];
    if (!scopeProjectId) return source;
    return source.filter((file) => !file.project_id || file.project_id === scopeProjectId);
  }, [files, scopeProjectId]);

  const visibleCampaigns = useMemo(() => {
    const source = campaigns ?? [];
    if (!scopeProjectId) return source;
    return source.filter((entry) => !entry.project_id || entry.project_id === scopeProjectId);
  }, [campaigns, scopeProjectId]);

  const visibleChannels = useMemo(() => {
    const source = channels ?? [];
    if (!scopeProjectId) return source;
    return source.filter((entry) => !entry.project_id || entry.project_id === scopeProjectId);
  }, [channels, scopeProjectId]);

  const channelUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const post of posts ?? []) {
      for (const entry of post.channels) {
        if (entry.channel?.id) map.set(entry.channel.id, (map.get(entry.channel.id) ?? 0) + 1);
      }
    }
    return map;
  }, [posts]);

  const assetUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const post of posts ?? []) {
      for (const entry of post.assets) {
        if (entry.file?.id) map.set(entry.file.id, (map.get(entry.file.id) ?? 0) + 1);
      }
    }
    return map;
  }, [posts]);

  const stats = useMemo(() => {
    const list = visiblePosts;
    const published = list.filter((entry) => entry.status === "published");
    const impressions = published.reduce((sum, entry) => sum + (entry.impressions ?? 0), 0);
    const engagements = published.reduce((sum, entry) => sum + (entry.engagements ?? 0), 0);
    const clicks = published.reduce((sum, entry) => sum + (entry.clicks ?? 0), 0);
    return {
      scheduled: list.filter((entry) => entry.status === "scheduled").length,
      approvals: list.filter((entry) => entry.status === "pending_approval").length,
      published: published.length,
      assets: visibleFiles.length,
      impressions,
      engagements,
      clicks,
      engagementRate:
        impressions > 0 ? `${((engagements / impressions) * 100).toFixed(1)}%` : "0%",
    };
  }, [visiblePosts, visibleFiles.length]);

  const queue = useMemo(() => {
    const groups: Record<SocialPostStatus, SocialPostWithRelations[]> = {
      draft: [],
      pending_approval: [],
      scheduled: [],
      published: [],
      failed: [],
    };
    for (const post of visiblePosts) {
      groups[post.status as SocialPostStatus].push(post);
    }
    return groups;
  }, [visiblePosts]);

  const topChannels = useMemo(() => {
    const map = new Map<
      string,
      { id: string; platform: string; kind: string; handle: string; count: number; engagements: number }
    >();
    for (const post of visiblePosts) {
      for (const link of post.channels) {
        const channel = link.channel;
        if (!channel) continue;
        const existing = map.get(channel.id) ?? {
          id: channel.id,
          platform: channel.platform,
          kind: channel.kind,
          handle: channel.handle,
          count: 0,
          engagements: 0,
        };
        existing.count += 1;
        existing.engagements += post.engagements ?? 0;
        map.set(channel.id, existing);
      }
    }
    return [...map.values()].sort((a, b) => b.engagements - a.engagements || b.count - a.count);
  }, [visiblePosts]);

  const campaignPerformance = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; color: string; posts: number; scheduled: number; published: number }
    >();
    for (const campaign of visibleCampaigns) {
      map.set(campaign.id, {
        id: campaign.id,
        name: campaign.name,
        color: campaign.theme_color,
        posts: 0,
        scheduled: 0,
        published: 0,
      });
    }
    for (const post of visiblePosts) {
      if (!post.campaign) continue;
      const current = map.get(post.campaign.id);
      if (!current) continue;
      current.posts += 1;
      if (post.status === "scheduled") current.scheduled += 1;
      if (post.status === "published") current.published += 1;
    }
    return [...map.values()].sort((a, b) => b.posts - a.posts);
  }, [visiblePosts, visibleCampaigns]);

  const openChannelModal = () => {
    setChannelDraft({
      projectId: scopeProjectId ?? "",
      kind: "social_account",
      platform: "instagram",
      name: "",
      handle: "",
      avatarUrl: "",
      themeColor: "#ff7a45",
      followersCount: "0",
    });
    setChannelOpen(true);
  };

  const openCampaignModal = () => {
    setCampaignDraft({
      projectId: scopeProjectId ?? "",
      name: "",
      brief: "",
      goal: "",
      themeColor: "#7c6cf0",
      startDate: null,
      endDate: null,
    });
    setCampaignOpen(true);
  };

  /**
   * "New task" — an ordinary project task (same modal, RPCs and triggers as
   * Board's), preselecting the project in scope and a due date: the calendar
   * places tasks by end_date, so one without a due date lands nowhere.
   */
  const openTaskModal = (due?: Dayjs) => {
    setTaskDue(due ?? dayjs());
    setTaskOpen(true);
  };

  /**
   * After the modal made the task, file the receipt that makes it Content
   * Studio's (app_content_studio_tasks), so it shows in the calendar's Social
   * scope without a reload. The task exists either way; a failed receipt is
   * a warning naming both ways to recover, never a lost task.
   */
  const handleTaskCreated = async (
    taskId: string,
    created: { projectId: string; due: Dayjs | null },
  ) => {
    try {
      await adoptTask.mutateAsync({ taskId, source: "created" });
    } catch {
      message.warning(
        "Task created, but it couldn't be added to the Social calendar — link it from a content item's Linked task picker, or switch the calendar to All tasks.",
      );
      return;
    }
    const inScope = scopeProjectId
      ? created.projectId === scopeProjectId
      : (projects ?? []).some((p) => p.id === created.projectId);
    if (!inScope) {
      message.info(
        scopeProjectId
          ? "Task created in another project — this calendar only shows this project's tasks."
          : "That project doesn't have Content Studio, so the task won't show on this calendar.",
      );
    }
  };

  /**
   * The form with a slot already chosen (a day's "+" in the Planner), and the
   * campaign the Planner is filtered to — without it the new item would be
   * filtered straight back out of view. On the workspace page with no project
   * chosen, the campaign's own project comes along so its Select lists it.
   */
  const openPostModalAt = (at?: Dayjs, campaignId?: string | null) => {
    const campaign = campaignId ? (visibleCampaigns.find((c) => c.id === campaignId) ?? null) : null;
    setPostDraft({
      ...DEFAULT_POST_DRAFT(scopeProjectId ?? campaign?.project_id ?? undefined),
      ...(typeFilter === "all" ? {} : { contentType: typeFilter }),
      ...(at ? { scheduledFor: at } : {}),
      ...(campaign ? { campaignId: campaign.id } : {}),
    });
    setPostOpen(true);
  };

  /** Gives a draft its date; the status stays what it was (a date is not an approval). */
  const schedulePost = async (post: SocialPostWithRelations, at: Dayjs): Promise<boolean> => {
    try {
      await updatePost.mutateAsync({ id: post.id, patch: { scheduled_for: at.toISOString() } });
      message.success(`“${post.title}” is on ${at.format("ddd D MMM, h:mm A")}.`);
      return true;
    } catch {
      message.error("Couldn't set the date.");
      return false;
    }
  };

  const openPostModal = () => {
    setPostDraft({
      ...DEFAULT_POST_DRAFT(scopeProjectId),
      // Start on whatever type is being filtered for. Otherwise a new item defaults
      // to social_post, is filtered straight back out of the planner, queue and
      // calendar, and reads as a save that silently failed.
      ...(typeFilter === "all" ? {} : { contentType: typeFilter }),
    });
    setPostOpen(true);
  };

  const handleInstall = async () => {
    try {
      await installApp.mutateAsync("content_studio");
      message.success("Content Studio installed.");
    } catch {
      message.error("Failed to install Content Studio.");
    }
  };

  const handleCreateChannel = async () => {
    const kindLabel = destinationKindBrand(channelDraft.kind).label.toLowerCase();
    // name and handle are both NOT NULL with a 1..160 length check. The handle field
    // reads as optional, so leaving it blank used to fail on a raw CHECK violation
    // and surface as the generic "Failed to add destination."
    if (!channelDraft.name.trim()) {
      message.warning(`Give this ${kindLabel} a name.`);
      return;
    }
    if (!channelDraft.handle.trim()) {
      message.warning(`Add the ${kindLabel}'s handle or address.`);
      return;
    }
    try {
      await createChannel.mutateAsync({
        projectId: channelDraft.projectId || null,
        kind: channelDraft.kind,
        platform: channelDraft.platform,
        name: channelDraft.name.trim(),
        handle: channelDraft.handle.trim(),
        avatarUrl: channelDraft.avatarUrl.trim() || null,
        themeColor: channelDraft.themeColor,
        followersCount: Number(channelDraft.followersCount || 0),
      });
      setChannelOpen(false);
      message.success(`${destinationKindBrand(channelDraft.kind).label} added.`);
    } catch {
      message.error("Failed to add destination.");
    }
  };

  const handleCreateCampaign = async () => {
    try {
      await createCampaign.mutateAsync({
        projectId: campaignDraft.projectId || null,
        name: campaignDraft.name.trim(),
        brief: campaignDraft.brief.trim() || null,
        goal: campaignDraft.goal.trim() || null,
        themeColor: campaignDraft.themeColor,
        startDate: campaignDraft.startDate?.format("YYYY-MM-DD") ?? null,
        endDate: campaignDraft.endDate?.format("YYYY-MM-DD") ?? null,
      });
      setCampaignOpen(false);
      message.success("Campaign created.");
    } catch {
      message.error("Failed to create campaign.");
    }
  };

  const handleCreatePost = async () => {
    try {
      await createPost.mutateAsync({
        projectId: postDraft.projectId || null,
        taskId: postDraft.taskId || null,
        campaignId: postDraft.campaignId || null,
        title: postDraft.title.trim(),
        body: postDraft.body.trim(),
        contentType: postDraft.contentType,
        status: postDraft.status,
        scheduledFor:
          postDraft.status === "scheduled"
            ? (postDraft.scheduledFor?.toISOString() ?? startOfNextSlot())
            : postDraft.scheduledFor?.toISOString() ?? null,
        targetUrl: postDraft.targetUrl.trim() || null,
        approvalRequired: postDraft.approvalRequired,
        channelIds: postDraft.channelIds,
        fileIds: postDraft.fileIds,
        impressions: postDraft.status === "published" ? 4200 : 0,
        engagements: postDraft.status === "published" ? 380 : 0,
        clicks: postDraft.status === "published" ? 86 : 0,
      });
      setPostOpen(false);
      message.success(
        `${CONTENT_TYPE_META[postDraft.contentType].label} added to Content Studio.`,
      );
    } catch {
      message.error("Failed to create content.");
    }
  };

  const handleQuickStatus = async (
    post: SocialPostWithRelations,
    status: SocialPostStatus,
  ) => {
    try {
      await updatePost.mutateAsync({
        id: post.id,
        patch: {
          status,
          scheduled_for:
            status === "scheduled"
              ? post.scheduled_for ?? startOfNextSlot()
              : post.scheduled_for,
          published_at:
            status === "published"
              ? post.published_at ?? new Date().toISOString()
              : status === "draft"
                ? null
                : post.published_at,
          impressions: status === "published" ? Math.max(post.impressions ?? 0, 4200) : post.impressions,
          engagements: status === "published" ? Math.max(post.engagements ?? 0, 340) : post.engagements,
          clicks: status === "published" ? Math.max(post.clicks ?? 0, 80) : post.clicks,
        },
      });
      message.success("Post updated.");
    } catch {
      message.error("Failed to update post.");
    }
  };

  if (!installed) {
    return (
      <InstallPrompt
        admin={Boolean(isTeamAdmin)}
        installing={installApp.isPending}
        onInstall={handleInstall}
        onManage={() => router.push("/apps?view=cubes")}
      />
    );
  }

  const plannerView = (
    <ContentPlanner
      posts={visiblePosts}
      campaigns={visibleCampaigns}
      renderPostCard={(post) => <PostCard post={post} onStatusChange={handleQuickStatus} />}
      onNewContent={openPostModalAt}
      onSchedule={schedulePost}
    />
  );

  const queueView = (
    <div
      style={{
        display: "grid",
        // Fit the 5 status columns to the width instead of scrolling sideways.
        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        gap: 12,
      }}
    >
      {(Object.keys(queue) as SocialPostStatus[]).map((status) => (
        <div
          key={status}
          style={{
            minWidth: 0,
            background: C.panel,
            border: `1px solid ${C.hair}`,
            borderRadius: 20,
            padding: 14,
            display: "grid",
            gap: 12,
            alignContent: "start",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <StatusPill status={status} />
            <span style={{ fontSize: 12, color: C.textTertiary }}>{queue[status].length}</span>
          </div>
          {queue[status].length ? (
            queue[status].map((post) => (
              <PostCard key={post.id} post={post} onStatusChange={handleQuickStatus} />
            ))
          ) : (
            <div
              style={{
                border: `1px dashed ${C.hair}`,
                borderRadius: 14,
                padding: 18,
                textAlign: "center",
                color: C.textTertiary,
                fontSize: 12.5,
              }}
            >
              No posts
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const mediaView = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 1fr",
        gap: 16,
      }}
    >
      <div
        style={{
          background: C.panel,
          border: `1px solid ${C.hair}`,
          borderRadius: 22,
          padding: 16,
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Internal media library</div>
          <div style={{ fontSize: 12.5, color: C.textSecondary }}>
            Assets come from Cubes Files, so creative stays central and Content Studio just links it into posts.
          </div>
        </div>
        {visibleFiles.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            {visibleFiles.map((file: FileWithMeta) => (
              <div
                key={file.id}
                style={{
                  border: `1px solid ${C.hair}`,
                  borderRadius: 16,
                  padding: 14,
                  background: file.mime?.startsWith("image/") ? C.bg : C.panel,
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    background: file.mime?.startsWith("video/") ? "rgba(74,74,208,0.12)" : "rgba(47,156,156,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <MIcon
                    name={file.mime?.startsWith("video/") ? "videocam" : "image"}
                    size={20}
                    color={file.mime?.startsWith("video/") ? C.accent : C.mint}
                  />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{file.name}</div>
                <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 4 }}>
                  {humanSize(file.size_bytes)}{file.project ? ` • ${file.project.name}` : " • Team-wide"}
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Tag style={{ margin: 0 }}>{assetUsage.get(file.id) ?? 0} posts</Tag>
                  {file.published ? <Tag color="success" style={{ margin: 0 }}>Published asset</Tag> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanel
            title="No internal assets yet"
            desc="Upload files in the Files app and they will appear here for reuse in content posts."
          />
        )}
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.hair}`,
            borderRadius: 22,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 10 }}>Asset usage</div>
          <div style={{ display: "grid", gap: 10 }}>
            <MetricCard icon="photo_library" label="Assets in scope" value={visibleFiles.length} detail="Ready to attach" tone={C.mint} />
            <MetricCard icon="perm_media" label="Reused assets" value={[...assetUsage.values()].filter((count) => count > 0).length} detail="Already used in posts" tone={C.accent} />
          </div>
        </div>

        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.hair}`,
            borderRadius: 22,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 10 }}>Recent post attachments</div>
          <div style={{ display: "grid", gap: 10 }}>
            {visiblePosts.filter((post) => post.assets.length > 0).slice(0, 5).map((post) => (
              <div key={post.id} style={{ border: `1px solid ${C.hair}`, borderRadius: 14, padding: 12 }}>
                <div style={{ fontWeight: 700, color: C.text }}>{post.title}</div>
                <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 4 }}>
                  {post.assets.length} linked asset{post.assets.length > 1 ? "s" : ""}
                </div>
              </div>
            ))}
            {visiblePosts.every((post) => post.assets.length === 0) ? (
              <div style={{ color: C.textTertiary, fontSize: 12.5 }}>No posts have attached assets yet.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  const analyticsView = (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          display: "grid",
          // Capped rather than 1fr: four stat tiles stretched across a wide
          // window read as slabs. They only need to be wide enough for the value.
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 200px))",
          justifyContent: "start",
          gap: 10,
        }}
      >
        <MetricCard icon="visibility" label="Impressions" value={stats.impressions.toLocaleString()} detail="Published posts reach" tone={C.accent} />
        <MetricCard icon="favorite" label="Engagements" value={stats.engagements.toLocaleString()} detail="Reactions, saves, replies" tone={C.red} />
        <MetricCard icon="ads_click" label="Clicks" value={stats.clicks.toLocaleString()} detail="Traffic driven from content" tone={C.mint} />
        <MetricCard icon="signal_cellular_alt" label="Engagement rate" value={stats.engagementRate} detail="Engagements / impressions" tone={C.lavender} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: 16,
        }}
      >
        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.hair}`,
            borderRadius: 22,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 14 }}>Top destinations</div>
          {topChannels.length ? (
            <div style={{ display: "grid", gap: 12 }}>
              {topChannels.slice(0, 8).map((channel) => (
                <div key={channel.id} style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <PlatformChip
                      platform={channel.platform}
                      handle={channel.handle}
                      kind={channel.kind}
                    />
                    <div style={{ fontSize: 12.5, color: C.textSecondary }}>
                      {channel.engagements.toLocaleString()} engagements
                    </div>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: token.colorSplit, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${Math.max(10, Math.min(100, channel.engagements / Math.max(stats.engagements, 1) * 100))}%`,
                        height: "100%",
                        background: destinationMeta(channel.platform, channel.kind).color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyPanel title="No analytics yet" desc="Publish a few posts to see channel performance." />
          )}
        </div>

        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.hair}`,
            borderRadius: 22,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 14 }}>Campaign performance</div>
          {campaignPerformance.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {campaignPerformance.map((campaign) => (
                <div
                  key={campaign.id}
                  style={{
                    border: `1px solid ${C.hair}`,
                    borderRadius: 14,
                    padding: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: campaign.color }} />
                    <div style={{ fontWeight: 700, color: C.text }}>{campaign.name}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    <Tag style={{ margin: 0 }}>{campaign.posts} posts</Tag>
                    <Tag style={{ margin: 0 }}>{campaign.scheduled} scheduled</Tag>
                    <Tag style={{ margin: 0 }}>{campaign.published} published</Tag>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyPanel title="No campaigns yet" desc="Create campaigns to group content and track performance." />
          )}
        </div>
      </div>
    </div>
  );

  // Sheets (and their Google Sheets sync) live in the Sheets app now; this tab
  // stays as a signpost so people who look for "Sheet" here find it, and can
  // start a Content calendar sheet bound to this scope in one click.
  const channelsView = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 14,
      }}
    >
      {visibleChannels.length ? (
        visibleChannels.map((channel) => (
          <div
            key={channel.id}
            style={{
              background: C.panel,
              border: `1px solid ${C.hair}`,
              borderRadius: 20,
              padding: 16,
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <DestinationBadge
                kind={channel.kind}
                platform={channel.platform}
                size={46}
                avatarUrl={channel.avatar_url}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, color: C.text }}>{channel.name}</div>
                <div style={{ fontSize: 12.5, color: C.textSecondary }}>
                  {destinationMeta(channel.platform, channel.kind).label}
                  {" • "}
                  {destinationHandle(channel.handle, channel.kind)}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {/*
                "Followers" is a social word. A blog has readers and a
                newsletter has subscribers, so the noun comes from the kind.
              */}
              <Tag style={{ margin: 0 }}>
                {channel.audience_size.toLocaleString()}{" "}
                {destinationKindBrand(channel.kind).audience}
              </Tag>
              <Tag style={{ margin: 0 }}>{channelUsage.get(channel.id) ?? 0} linked items</Tag>
              {channel.project ? <Tag style={{ margin: 0 }}>{channel.project.name}</Tag> : <Tag style={{ margin: 0 }}>Team-wide</Tag>}
            </div>
            <div style={{ fontSize: 12.5, color: C.textSecondary }}>
              {channel.connected
                ? "Connected and ready for scheduling."
                : `Saved as a draft ${destinationKindBrand(channel.kind).label.toLowerCase()}. Complete the connection before publishing.`}
            </div>
          </div>
        ))
      ) : (
        <div style={{ gridColumn: "1 / -1" }}>
          <EmptyPanel
            title="No destinations connected"
            desc="Add the places you publish — social accounts, a blog, a newsletter, a video channel — so campaigns and content can target the right one."
            action={<Button type="primary" onClick={openChannelModal}>Add destination</Button>}
          />
        </div>
      )}
    </div>
  );

  const calendarView = (
    <SocialCalendarView
      posts={visiblePosts}
      // Inside a project, the calendar is THAT project's — not every project
      // Content Studio happens to be activated for. Embedding the workspace in a
      // project tab and then showing another project's logo work is the bug
      // this scoping exists to prevent.
      projectIds={
        scopeProjectId ? [scopeProjectId] : (projects ?? []).map((p) => p.id)
      }
      renderPostCard={(post) => (
        <PostCard post={post} onStatusChange={handleQuickStatus} />
      )}
      onNewPost={openPostModal}
      onNewTask={canCreateTasks ? openTaskModal : undefined}
    />
  );

  const routinesView = (
    <SocialRoutinesView
      projects={(projects ?? []).map((p) => ({ id: p.id, name: p.name }))}
      defaultProjectId={scopeProjectId}
    />
  );

  const contentView =
    view === "calendar"
      ? calendarView
      : view === "routines"
        ? routinesView
        : view === "planner"
          ? plannerView
          : view === "queue"
            ? queueView
            : view === "media"
              ? mediaView
              : view === "analytics"
                ? analyticsView
                : channelsView;

  return (
    <>
      <div
        style={{
          display: embedded ? "block" : "flex",
          height: embedded ? "auto" : "calc(100vh - 58px)",
          margin: embedded ? 0 : "-22px -24px -48px",
          background: C.bg,
          overflow: "hidden",
        }}
      >
        {!embedded ? (
          <aside
            style={{
              width: 252,
              flex: "none",
              minHeight: 0,
              borderRight: `1px solid ${C.hair}`,
              background: C.panel,
              padding: "16px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <button
              type="button"
              onClick={() => setSelectedProjectId(undefined)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "8px 10px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                background: !scopeProjectId ? C.accentSoft : "transparent",
                color: !scopeProjectId ? C.accentDeep : C.textSecondary,
                fontSize: 13.5,
                fontWeight: !scopeProjectId ? 700 : 500,
              }}
            >
              <MIcon name="hub" size={18} color={!scopeProjectId ? C.accentDeep : C.textTertiary} />
              <span style={{ flex: 1 }}>All workspace content</span>
              <span style={{ fontSize: 11.5, color: !scopeProjectId ? C.accentDeep : C.textTertiary }}>
                {posts?.length ?? 0}
              </span>
            </button>

            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: 0.7,
                color: C.textTertiary,
                padding: "12px 10px 4px",
                textTransform: "uppercase",
              }}
            >
              Projects
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              {projectRows.map((entry) => {
                const active = scopeProjectId === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedProjectId(entry.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      background: active ? C.accentSoft : "transparent",
                      color: active ? C.accentDeep : C.textSecondary,
                      fontSize: 13.5,
                      fontWeight: active ? 700 : 500,
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: entry.color }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.name}
                    </span>
                    <span style={{ fontSize: 11.5, color: active ? C.accentDeep : C.textTertiary }}>
                      {entry.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        ) : null}

        <main
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: "auto",
            padding: embedded ? "0 0 18px" : "22px 24px 40px",
          }}
        >
          <div
            style={{
              background: C.panel,
              border: `1px solid ${C.hair}`,
              borderRadius: 14,
              padding: "12px 14px 14px",
              boxShadow: "0 1px 2px rgba(16,24,40,.04)",
            }}
          >
            {/* Just the actions. The eyebrow / project title / product blurb that
                used to sit here repeated what the project page already shows and
                pushed the real content below the fold. */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 18, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button onClick={openChannelModal}>Add destination</Button>
                <Button onClick={openCampaignModal}>New campaign</Button>
                {canCreateTasks ? <Button onClick={() => openTaskModal()}>New task</Button> : null}
                <Button type="primary" onClick={openPostModal}>
                  New content
                </Button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 200px))",
                justifyContent: "start",
                gap: 10,
                marginTop: 14,
              }}
            >
              <MetricCard icon="schedule" label="Scheduled" value={stats.scheduled} detail="Ready to publish" tone={C.accent} />
              <MetricCard icon="approval" label="Needs approval" value={stats.approvals} detail="Waiting on review" tone={C.gold} />
              <MetricCard icon="north_east" label="Published" value={stats.published} detail="Already pushed live" tone={C.green} />
              <MetricCard icon="perm_media" label="Media assets" value={stats.assets} detail="Pulled from Files" tone={C.mint} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "18px 0 16px" }}>
            <ViewTab active={view === "calendar"} icon="calendar_month" label="Calendar" onClick={() => setView("calendar")} />
            <ViewTab active={view === "routines"} icon="autorenew" label="Routines" onClick={() => setView("routines")} />
            <ViewTab active={view === "planner"} icon="view_week" label="Planner" onClick={() => setView("planner")} />
            <ViewTab active={view === "queue"} icon="view_kanban" label="Queue" onClick={() => setView("queue")} />
            <ViewTab active={view === "media"} icon="photo_library" label="Media" onClick={() => setView("media")} />
            <ViewTab active={view === "analytics"} icon="monitoring" label="Analytics" onClick={() => setView("analytics")} />
            <ViewTab active={view === "channels"} icon="hub" label="Destinations" onClick={() => setView("channels")} />
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <MIcon name="filter_list" size={18} color={C.textTertiary} />
              <Select
                size="large"
                value={typeFilter}
                onChange={(value) => setTypeFilter(value)}
                style={{ minWidth: 190 }}
                options={[
                  { value: "all", label: "All content types" },
                  ...CONTENT_TYPES.map((type) => ({
                    value: type,
                    label: CONTENT_TYPE_META[type].label,
                  })),
                ]}
              />
            </div>
          </div>

          {contentView}
        </main>
      </div>

      <Modal
        open={channelOpen}
        onCancel={() => setChannelOpen(false)}
        onOk={handleCreateChannel}
        okText="Add destination"
        confirmLoading={createChannel.isPending}
        title="Add destination"
        width={560}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 8 }}>Where does content land?</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))", gap: 8 }}>
              {DESTINATION_KINDS.map((k) => {
                const meta = destinationKindBrand(k);
                const active = channelDraft.kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      setChannelDraft((prev) => ({
                        ...prev,
                        kind: k,
                        // `platform` is free text and NOT NULL: a social account
                        // keeps a real platform slug, everything else stores its
                        // own kind there so nothing reads it as Instagram.
                        platform: k === "social_account" ? "instagram" : k,
                        name:
                          prev.name && prev.name !== destinationKindBrand(prev.kind).label
                            ? prev.name
                            : k === "social_account"
                              ? ""
                              : meta.label,
                      }))
                    }
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: "10px 6px",
                      borderRadius: 12,
                      cursor: "pointer",
                      background: active ? `${meta.color}14` : C.panel,
                      border: `1.5px solid ${active ? meta.color : C.hair}`,
                      transition: "all 120ms",
                    }}
                  >
                    <DestinationKindBadge kind={k} size={30} />
                    <span style={{ fontSize: 11.5, color: C.text, fontWeight: active ? 700 : 500 }}>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {channelDraft.kind === "social_account" ? (
            <div>
              <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 8 }}>Choose a platform</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))", gap: 8 }}>
                {SOCIAL_PLATFORMS.map((p) => {
                  const meta = brandMeta(p);
                  const active = channelDraft.platform === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() =>
                        setChannelDraft((prev) => ({
                          ...prev,
                          platform: p,
                          // Prefill the display name with the platform when blank.
                          name: prev.name && prev.name !== brandMeta(prev.platform).label ? prev.name : meta.label,
                        }))
                      }
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 6,
                        padding: "10px 6px",
                        borderRadius: 12,
                        cursor: "pointer",
                        background: active ? `${meta.color}14` : C.panel,
                        border: `1.5px solid ${active ? meta.color : C.hair}`,
                        transition: "all 120ms",
                      }}
                    >
                      <PlatformBadge platform={p} size={30} />
                      <span style={{ fontSize: 11.5, color: C.text, fontWeight: active ? 700 : 500 }}>{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!embedded ? (
            <Select
              value={channelDraft.projectId}
              onChange={(value) => setChannelDraft((prev) => ({ ...prev, projectId: value }))}
              options={[
                { value: "", label: "Team-wide destination" },
                ...(projects ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
              ]}
            />
          ) : null}
          <Input
            placeholder="Display name"
            value={channelDraft.name}
            onChange={(event) => setChannelDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
          <Input
            placeholder={
              channelDraft.kind === "social_account"
                ? "@handle"
                : "Address — the site, feed or list this publishes to"
            }
            value={channelDraft.handle}
            onChange={(event) => setChannelDraft((prev) => ({ ...prev, handle: event.target.value }))}
          />
          <Input
            placeholder="Avatar image URL (optional)"
            value={channelDraft.avatarUrl}
            onChange={(event) => setChannelDraft((prev) => ({ ...prev, avatarUrl: event.target.value }))}
          />
          <Input
            placeholder={`Audience size — ${destinationKindBrand(channelDraft.kind).audience}`}
            value={channelDraft.followersCount}
            onChange={(event) => setChannelDraft((prev) => ({ ...prev, followersCount: event.target.value }))}
          />
        </div>
      </Modal>

      <Modal
        open={campaignOpen}
        onCancel={() => setCampaignOpen(false)}
        onOk={handleCreateCampaign}
        okText="Create campaign"
        confirmLoading={createCampaign.isPending}
        title="Create campaign"
      >
        <div style={{ display: "grid", gap: 12 }}>
          {!embedded ? (
            <Select
              value={campaignDraft.projectId}
              onChange={(value) => setCampaignDraft((prev) => ({ ...prev, projectId: value }))}
              options={[
                { value: "", label: "Team-wide campaign" },
                ...(projects ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
              ]}
            />
          ) : null}
          <Input
            placeholder="Campaign name"
            value={campaignDraft.name}
            onChange={(event) => setCampaignDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
          <NotionEditor
            value={campaignDraft.brief}
            onChange={(next) => setCampaignDraft((prev) => ({ ...prev, brief: next }))}
            // The modal's Create button is the commit; blur must not write.
            onCommit={() => {}}
            placeholder="Brief — what this campaign is for, who it targets, the angle…"
            minRows={4}
            maxRows={12}
            linkPreviews={false}
          />
          <Input
            placeholder="Goal"
            value={campaignDraft.goal}
            onChange={(event) => setCampaignDraft((prev) => ({ ...prev, goal: event.target.value }))}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Input
              type="date"
              value={campaignDraft.startDate?.format("YYYY-MM-DD") ?? ""}
              onChange={(event) =>
                setCampaignDraft((prev) => ({
                  ...prev,
                  startDate: event.target.value ? dayjs(event.target.value) : null,
                }))
              }
            />
            <Input
              type="date"
              value={campaignDraft.endDate?.format("YYYY-MM-DD") ?? ""}
              onChange={(event) =>
                setCampaignDraft((prev) => ({
                  ...prev,
                  endDate: event.target.value ? dayjs(event.target.value) : null,
                }))
              }
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={postOpen}
        onCancel={() => setPostOpen(false)}
        onOk={handleCreatePost}
        okText="Create content"
        width={760}
        confirmLoading={createPost.isPending}
        title="Create content"
      >
        <div style={{ display: "grid", gap: 12 }}>
          {!embedded ? (
            <Select
              value={postDraft.projectId}
              onChange={(value) =>
                setPostDraft((prev) => ({
                  ...prev,
                  projectId: value,
                  taskId: "",
                  campaignId: "",
                }))
              }
              options={[
                { value: "", label: "No project" },
                ...(projects ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
              ]}
            />
          ) : null}
          <div>
            <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 8 }}>
              What kind of content is this?
            </div>
            <Select
              value={postDraft.contentType}
              onChange={(value) => setPostDraft((prev) => ({ ...prev, contentType: value }))}
              style={{ width: "100%" }}
              options={CONTENT_TYPES.map((type) => ({
                value: type,
                label: (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <MIcon
                      name={CONTENT_TYPE_META[type].icon}
                      size={15}
                      color={CONTENT_TYPE_META[type].tone}
                    />
                    {CONTENT_TYPE_META[type].label}
                  </span>
                ),
              }))}
            />
          </div>
          <Input
            placeholder="Title"
            value={postDraft.title}
            onChange={(event) => setPostDraft((prev) => ({ ...prev, title: event.target.value }))}
          />
          <TextArea
            rows={5}
            placeholder="Write the body, hook, CTA, or destination-specific notes"
            value={postDraft.body}
            onChange={(event) => setPostDraft((prev) => ({ ...prev, body: event.target.value }))}
          />
          {(() => {
            // Strictest character limit across the selected social accounts.
            // Only social posts are capped: a blog post has no 280-character
            // ceiling, and a newsletter list has no platform to borrow one from.
            if (!isSocialContentType(postDraft.contentType)) return null;
            const picked = (channels ?? []).filter(
              (c) => postDraft.channelIds.includes(c.id) && isSocialDestinationKind(c.kind),
            );
            if (picked.length === 0) return null;
            const limit = Math.min(
              ...picked.map((c) => PLATFORM_MAX_LEN[c.platform] ?? 5000),
            );
            const over = postDraft.body.length > limit;
            const tightest = picked.reduce((a, c) =>
              (PLATFORM_MAX_LEN[c.platform] ?? 5000) < (PLATFORM_MAX_LEN[a.platform] ?? 5000) ? c : a,
            );
            return (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: -6, fontSize: 11.5 }}>
                <span style={{ color: over ? C.red : C.textSecondary }}>
                  {postDraft.body.length} / {limit}
                  {over ? ` — too long for ${brandMeta(tightest.platform).label}` : ` (limit: ${brandMeta(tightest.platform).label})`}
                </span>
              </div>
            );
          })()}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Select
              value={postDraft.status}
              onChange={(value) =>
                setPostDraft((prev) => ({
                  ...prev,
                  status: value,
                  scheduledFor:
                    value === "scheduled" && !prev.scheduledFor ? dayjs(startOfNextSlot()) : prev.scheduledFor,
                }))
              }
              options={Object.entries(SOCIAL_POST_STATUS_META).map(([value, meta]) => ({
                value,
                label: meta.label,
              }))}
            />
            <Input
              type="datetime-local"
              value={postDraft.scheduledFor ? postDraft.scheduledFor.format("YYYY-MM-DDTHH:mm") : ""}
              onChange={(event) =>
                setPostDraft((prev) => ({
                  ...prev,
                  scheduledFor: event.target.value ? dayjs(event.target.value) : null,
                }))
              }
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Select
              placeholder="Linked task"
              value={postDraft.taskId || undefined}
              onChange={(value) => setPostDraft((prev) => ({ ...prev, taskId: value ?? "" }))}
              allowClear
              options={(scopeTasks ?? []).map((task) => ({
                value: task.id,
                label: `#${task.task_no ?? "?"} ${task.name}`,
              }))}
            />
            <Select
              placeholder="Campaign"
              value={postDraft.campaignId || undefined}
              onChange={(value) => setPostDraft((prev) => ({ ...prev, campaignId: value ?? "" }))}
              allowClear
              options={visibleCampaigns
                .filter(
                  (campaign: SocialCampaignWithProject) =>
                    !postDraft.projectId || !campaign.project_id || campaign.project_id === postDraft.projectId,
                )
                .map((campaign) => ({
                  value: campaign.id,
                  label: campaign.name,
                }))}
            />
          </div>
          <Input
            placeholder="Target URL (optional)"
            value={postDraft.targetUrl}
            onChange={(event) => setPostDraft((prev) => ({ ...prev, targetUrl: event.target.value }))}
          />
          <Select
            mode="multiple"
            placeholder="Publish to destinations"
            value={postDraft.channelIds}
            onChange={(value) => setPostDraft((prev) => ({ ...prev, channelIds: value }))}
            options={visibleChannels
              .filter((channel) => !postDraft.projectId || !channel.project_id || channel.project_id === postDraft.projectId)
              .map((channel) => ({
                value: channel.id,
                label: `${destinationMeta(channel.platform, channel.kind).label} • ${destinationHandle(channel.handle, channel.kind)}`,
              }))}
          />
          <Select
            mode="multiple"
            placeholder="Attach internal assets"
            value={postDraft.fileIds}
            onChange={(value) => setPostDraft((prev) => ({ ...prev, fileIds: value }))}
            options={visibleFiles
              .filter((file) => !postDraft.projectId || !file.project_id || file.project_id === postDraft.projectId)
              .map((file) => ({
                value: file.id,
                label: `${file.name} • ${humanSize(file.size_bytes)}`,
              }))}
          />
        </div>
      </Modal>

      {/*
        The product's own task drawer, mounted here so a task chip on the
        calendar opens the same panel as the project board and /schedule —
        subtasks, dependencies, assignees and comments included. It reads the
        open id from a store, so there is nothing to pass it.
      */}
      {/*
        The product's create-task modal, opened by "New task" here and by a
        day's "+" on the calendar. Its own instance: app-shell's global one
        and the drawer's subtask composer keep their own open state.
      */}
      <CreateTaskModal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        defaultProjectId={scopeProjectId}
        defaultDue={taskDue}
        onCreated={(id, created) => void handleTaskCreated(id, created)}
      />
      {/* Only ONE may be mounted: inside a project tab the project page already
          has one, and two would open two stacked drawers per chip click. */}
      {!embedded ? <TaskDrawer /> : null}
    </>
  );
}
