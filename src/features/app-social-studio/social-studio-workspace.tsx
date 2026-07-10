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
} from "antd";
import { useProject } from "@/features/projects/use-projects";
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
import { useActiveTeam } from "@/features/teams/use-teams";
import {
  SOCIAL_POST_STATUS_META,
  useCreateSocialCampaign,
  useCreateSocialChannel,
  useCreateSocialPost,
  useSocialStudioCampaigns,
  useSocialStudioChannels,
  useSocialStudioPosts,
  useUpdateSocialPost,
  SOCIAL_PLATFORMS,
  type SocialCampaignWithProject,
  type SocialPlatform,
  type SocialPostStatus,
  type SocialPostWithRelations,
} from "./use-social-studio";
import {
  PLATFORM_BRANDS,
  PLATFORM_MAX_LEN,
  PlatformIcon,
  PlatformBadge,
} from "./platform-icons";

const { Title, Paragraph } = Typography;
const { TextArea } = Input;

// Aligned to the platform design language (indigo primary, neutral greys,
// #ececf0 hairlines) so Social Studio reads as part of Cubes rather than a
// separate product. Semantic status colors (red/green/gold) are kept.
const C = {
  bg: "#f6f7f9",
  panel: "#ffffff",
  panelSoft: "#f5f6f8",
  hair: "#ececf0",
  text: "#17171c",
  textSecondary: "#6a6d78",
  textTertiary: "#9a9da8",
  accent: "#4a4ad0",
  accentSoft: "rgba(74,74,208,0.10)",
  accentDeep: "#3a3ab0",
  mint: "#2f9c9c",
  lavender: "#7a5af5",
  red: "#c0453c",
  green: "#2f8f5f",
  gold: "#b8842a",
};

/** Resolve a platform's brand meta with a safe fallback for unknown values. */
function brandMeta(platform: string): { label: string; mono: string; color: string } {
  const b = PLATFORM_BRANDS[platform];
  return {
    label: b?.label ?? platform,
    mono: b?.mono ?? platform.slice(0, 2).toUpperCase(),
    color: b?.color ?? "#6a6d78",
  };
}

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1, color }}
    >
      {name}
    </span>
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
}: {
  platform: SocialPlatform;
  handle?: string | null;
}) {
  const meta = brandMeta(platform);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 8px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.72)",
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
        <PlatformIcon platform={platform} size={12} color={meta.color} />
      </span>
      <span>{handle ? `@${handle.replace(/^@/, "")}` : meta.label}</span>
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
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.hair}`,
        borderRadius: 18,
        padding: "16px 18px",
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          background: `${tone}18`,
          color: tone,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
        }}
      >
        <MIcon name={icon} size={20} color={tone} />
      </div>
      <div style={{ fontSize: 12, color: C.textTertiary, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: C.text, lineHeight: 1.1, marginTop: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 6 }}>{detail}</div>
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
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 38,
        padding: "0 14px",
        borderRadius: 12,
        border: "none",
        background: active ? C.text : "#fff",
        color: active ? "#fff" : C.textSecondary,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        fontWeight: 600,
        boxShadow: active ? "0 12px 30px rgba(30,29,25,0.16)" : "none",
      }}
    >
      <MIcon name={icon} size={17} color={active ? "#fff" : C.textTertiary} />
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
        background: "#fff",
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
            {post.caption}
          </div>
        </div>
        <StatusPill status={post.status as SocialPostStatus} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {channels.map((channel: NonNullable<SocialPostWithRelations["channels"][number]["channel"]>) => (
          <PlatformChip
            key={channel.id}
            platform={channel.platform as SocialPlatform}
            handle={channel.handle}
          />
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, color: C.textSecondary }}>
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
  return (
    <div
      style={{
        minHeight: 420,
        background: "linear-gradient(180deg,#f4f4fb 0%, #f6f7f9 100%)",
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
          Social Studio
        </Title>
        <Paragraph style={{ color: C.textSecondary, fontSize: 15 }}>
          Postiz-inspired publishing for Cubes: campaigns, content queue,
          channel planning, internal media reuse, and project-linked publishing
          workflows.
        </Paragraph>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
          {admin ? (
            <Button type="primary" size="large" loading={installing} onClick={onInstall}>
              Install Social Studio
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

type ViewKey = "planner" | "queue" | "media" | "analytics" | "channels";

type PostDraft = {
  projectId: string;
  taskId: string;
  campaignId: string;
  title: string;
  caption: string;
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
  caption: "",
  status: "draft",
  scheduledFor: null,
  approvalRequired: false,
  targetUrl: "",
  channelIds: [],
  fileIds: [],
});

export function SocialStudioWorkspace({
  projectId,
  embedded = false,
}: {
  projectId?: string;
  embedded?: boolean;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const { data: activeTeam } = useActiveTeam();
  const { data: installedApps } = useInstalledApps();
  const { data: isTeamAdmin } = useIsTeamAdmin();
  const installApp = useInstallApp();
  const { data: projects } = useAppActivatedProjects("social_studio");
  const { data: project } = useProject(projectId);

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(projectId);
  const [view, setView] = useState<ViewKey>("planner");
  const [channelOpen, setChannelOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [postOpen, setPostOpen] = useState(false);

  const scopeProjectId = projectId ?? selectedProjectId;
  const { data: channels } = useSocialStudioChannels(scopeProjectId, true);
  const { data: campaigns } = useSocialStudioCampaigns(scopeProjectId, true);
  const { data: posts } = useSocialStudioPosts(scopeProjectId, Boolean(projectId));
  const { data: files } = useTeamFiles();
  const { data: scopeTasks } = useTasks(scopeProjectId);
  const createChannel = useCreateSocialChannel();
  const createCampaign = useCreateSocialCampaign();
  const createPost = useCreateSocialPost();
  const updatePost = useUpdateSocialPost();

  const [channelDraft, setChannelDraft] = useState({
    projectId: scopeProjectId ?? "",
    platform: "instagram" as SocialPlatform,
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

  const installRecord = installedApps?.find((entry) => entry.app_key === "social_studio");
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
    const list = posts ?? [];
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
  }, [posts, visibleFiles.length]);

  const plannerDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => dayjs().startOf("day").add(index, "day")),
    [],
  );

  const plannerMap = useMemo(() => {
    const map = new Map<string, SocialPostWithRelations[]>();
    for (const day of plannerDays) map.set(day.format("YYYY-MM-DD"), []);
    for (const post of posts ?? []) {
      if (!post.scheduled_for) continue;
      const key = dayjs(post.scheduled_for).format("YYYY-MM-DD");
      if (!map.has(key)) continue;
      map.get(key)?.push(post);
    }
    return map;
  }, [plannerDays, posts]);

  const unscheduled = useMemo(
    () =>
      (posts ?? []).filter(
        (post) =>
          !post.scheduled_for &&
          (post.status === "draft" || post.status === "pending_approval"),
      ),
    [posts],
  );

  const queue = useMemo(() => {
    const groups: Record<SocialPostStatus, SocialPostWithRelations[]> = {
      draft: [],
      pending_approval: [],
      scheduled: [],
      published: [],
      failed: [],
    };
    for (const post of posts ?? []) {
      groups[post.status as SocialPostStatus].push(post);
    }
    return groups;
  }, [posts]);

  const topChannels = useMemo(() => {
    const map = new Map<
      string,
      { id: string; platform: SocialPlatform; handle: string; count: number; engagements: number }
    >();
    for (const post of posts ?? []) {
      for (const link of post.channels) {
        const channel = link.channel;
        if (!channel) continue;
        const existing = map.get(channel.id) ?? {
          id: channel.id,
          platform: channel.platform as SocialPlatform,
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
  }, [posts]);

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
    for (const post of posts ?? []) {
      if (!post.campaign) continue;
      const current = map.get(post.campaign.id);
      if (!current) continue;
      current.posts += 1;
      if (post.status === "scheduled") current.scheduled += 1;
      if (post.status === "published") current.published += 1;
    }
    return [...map.values()].sort((a, b) => b.posts - a.posts);
  }, [posts, visibleCampaigns]);

  const openChannelModal = () => {
    setChannelDraft({
      projectId: scopeProjectId ?? "",
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

  const openPostModal = () => {
    setPostDraft(DEFAULT_POST_DRAFT(scopeProjectId));
    setPostOpen(true);
  };

  const handleInstall = async () => {
    try {
      await installApp.mutateAsync("social_studio");
      message.success("Social Studio installed.");
    } catch {
      message.error("Failed to install Social Studio.");
    }
  };

  const handleCreateChannel = async () => {
    try {
      await createChannel.mutateAsync({
        projectId: channelDraft.projectId || null,
        platform: channelDraft.platform,
        name: channelDraft.name.trim(),
        handle: channelDraft.handle.trim(),
        avatarUrl: channelDraft.avatarUrl.trim() || null,
        themeColor: channelDraft.themeColor,
        followersCount: Number(channelDraft.followersCount || 0),
      });
      setChannelOpen(false);
      message.success("Channel added.");
    } catch {
      message.error("Failed to add channel.");
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
        caption: postDraft.caption.trim(),
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
      message.success("Post added to Social Studio.");
    } catch {
      message.error("Failed to create post.");
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

  const selectedProjectName = project?.name
    ?? projectRows.find((entry) => entry.id === scopeProjectId)?.name
    ?? activeTeam?.name
    ?? "Workspace";
  const selectedProjectColor = project?.color_code
    ?? projectRows.find((entry) => entry.id === scopeProjectId)?.color
    ?? C.accent;

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
    <div style={{ display: "grid", gap: 18 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
        }}
      >
        {visibleCampaigns.slice(0, 4).map((campaign) => (
          <div
            key={campaign.id}
            style={{
              background: "#fff",
              border: `1px solid ${C.hair}`,
              borderRadius: 18,
              padding: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: campaign.theme_color,
                }}
              />
              <div style={{ fontWeight: 700, color: C.text }}>{campaign.name}</div>
            </div>
            <div style={{ fontSize: 12.5, color: C.textSecondary }}>
              {campaign.brief || campaign.goal || "Content campaign ready for scheduling."}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              {campaign.start_date ? <Tag style={{ margin: 0 }}>{dayjs(campaign.start_date).format("D MMM")}</Tag> : null}
              {campaign.project ? <Tag style={{ margin: 0 }}>{campaign.project.name}</Tag> : null}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          background: C.panel,
          border: `1px solid ${C.hair}`,
          borderRadius: 22,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Publishing calendar</div>
            <div style={{ fontSize: 12.5, color: C.textSecondary }}>
              Modeled on Postiz launches and queue planning, but tied to Cubes projects and tasks.
            </div>
          </div>
          <Button type="primary" onClick={openPostModal}>
            New post
          </Button>
        </div>
        <div
          style={{
            display: "grid",
            // Fit all 7 days to the content width instead of forcing a
            // horizontal scroll (minmax(0,1fr) lets columns shrink to fit).
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 10,
            paddingBottom: 4,
          }}
        >
          {plannerDays.map((day) => {
            const dayPosts = plannerMap.get(day.format("YYYY-MM-DD")) ?? [];
            return (
              <div
                key={day.toISOString()}
                style={{
                  minWidth: 0,
                  background: C.panelSoft,
                  border: `1px solid ${C.hair}`,
                  borderRadius: 14,
                  padding: 12,
                  display: "grid",
                  gap: 10,
                  alignContent: "start",
                  minHeight: 240,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: C.textTertiary, textTransform: "uppercase", fontWeight: 700 }}>
                    {day.format("ddd")}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>
                    {day.format("D MMM")}
                  </div>
                </div>
                {dayPosts.length ? (
                  dayPosts.map((post) => (
                    <PostCard key={post.id} post={post} onStatusChange={handleQuickStatus} />
                  ))
                ) : (
                  <div
                    style={{
                      border: `1px dashed ${C.hair}`,
                      borderRadius: 14,
                      padding: 16,
                      color: C.textTertiary,
                      fontSize: 12.5,
                      textAlign: "center",
                    }}
                  >
                    No scheduled posts
                  </div>
                )}
              </div>
            );
          })}
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Needs scheduling</div>
            <div style={{ fontSize: 12.5, color: C.textSecondary }}>
              Drafts and approvals that are still waiting for a launch slot.
            </div>
          </div>
        </div>
        {unscheduled.length ? (
          <div style={{ display: "grid", gap: 12 }}>
            {unscheduled.map((post) => (
              <PostCard key={post.id} post={post} onStatusChange={handleQuickStatus} />
            ))}
          </div>
        ) : (
          <EmptyPanel
            title="Everything has a slot"
            desc="Your draft and approval queue is empty or already scheduled."
          />
        )}
      </div>
    </div>
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
            Assets come from Cubes Files, so creative stays central and Social Studio just links it into posts.
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
                  background: file.mime?.startsWith("image/") ? "#f6f7f9" : "#fff",
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
            {(posts ?? []).filter((post) => post.assets.length > 0).slice(0, 5).map((post) => (
              <div key={post.id} style={{ border: `1px solid ${C.hair}`, borderRadius: 14, padding: 12 }}>
                <div style={{ fontWeight: 700, color: C.text }}>{post.title}</div>
                <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 4 }}>
                  {post.assets.length} linked asset{post.assets.length > 1 ? "s" : ""}
                </div>
              </div>
            ))}
            {(posts ?? []).every((post) => post.assets.length === 0) ? (
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
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
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
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 14 }}>Top channels</div>
          {topChannels.length ? (
            <div style={{ display: "grid", gap: 12 }}>
              {topChannels.slice(0, 8).map((channel) => (
                <div key={channel.id} style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <PlatformChip platform={channel.platform} handle={channel.handle} />
                    <div style={{ fontSize: 12.5, color: C.textSecondary }}>
                      {channel.engagements.toLocaleString()} engagements
                    </div>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: "#ececf0", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${Math.max(10, Math.min(100, channel.engagements / Math.max(stats.engagements, 1) * 100))}%`,
                        height: "100%",
                        background: brandMeta(channel.platform).color,
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
              <PlatformBadge platform={channel.platform} size={46} avatarUrl={channel.avatar_url} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, color: C.text }}>{channel.name}</div>
                <div style={{ fontSize: 12.5, color: C.textSecondary }}>
                  {brandMeta(channel.platform).label} • @{channel.handle.replace(/^@/, "")}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Tag style={{ margin: 0 }}>{channel.followers_count.toLocaleString()} followers</Tag>
              <Tag style={{ margin: 0 }}>{channelUsage.get(channel.id) ?? 0} linked posts</Tag>
              {channel.project ? <Tag style={{ margin: 0 }}>{channel.project.name}</Tag> : <Tag style={{ margin: 0 }}>Team-wide</Tag>}
            </div>
            <div style={{ fontSize: 12.5, color: C.textSecondary }}>
              {channel.connected
                ? "Connected and ready for scheduling."
                : "Saved as a draft channel. Complete the connection before publishing."}
            </div>
          </div>
        ))
      ) : (
        <div style={{ gridColumn: "1 / -1" }}>
          <EmptyPanel
            title="No channels connected"
            desc="Add the channels you manage so campaigns and posts can target the right distribution."
            action={<Button type="primary" onClick={openChannelModal}>Add channel</Button>}
          />
        </div>
      )}
    </div>
  );

  const contentView =
    view === "planner"
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
              background: "#ffffff",
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
              padding: "20px 20px 16px",
              boxShadow: "0 1px 2px rgba(16,24,40,.04)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
              <div style={{ maxWidth: 760 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                  {scopeProjectId ? (
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 999,
                        background: selectedProjectColor,
                      }}
                    />
                  ) : (
                    <MIcon name="campaign" size={18} color={C.accent} />
                  )}
                  <span style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: C.textTertiary, fontWeight: 700 }}>
                    {scopeProjectId ? "Project publishing workspace" : "Workspace publishing hub"}
                  </span>
                </div>
                <Title level={2} style={{ margin: 0 }}>
                  {selectedProjectName}
                </Title>
                <Paragraph style={{ margin: "8px 0 0", color: C.textSecondary, maxWidth: 720 }}>
                  A Cubes-native social publishing app inspired by Postiz. Plan campaigns, attach internal files,
                  link posts to tasks, and manage your publishing queue without leaving the workspace.
                </Paragraph>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button onClick={openChannelModal}>Add channel</Button>
                <Button onClick={openCampaignModal}>New campaign</Button>
                <Button type="primary" onClick={openPostModal}>
                  New post
                </Button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 14,
                marginTop: 18,
              }}
            >
              <MetricCard icon="schedule" label="Scheduled" value={stats.scheduled} detail="Ready to publish" tone={C.accent} />
              <MetricCard icon="approval" label="Needs approval" value={stats.approvals} detail="Waiting on review" tone={C.gold} />
              <MetricCard icon="north_east" label="Published" value={stats.published} detail="Already pushed live" tone={C.green} />
              <MetricCard icon="perm_media" label="Media assets" value={stats.assets} detail="Pulled from Files" tone={C.mint} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "18px 0 16px" }}>
            <ViewTab active={view === "planner"} icon="calendar_month" label="Planner" onClick={() => setView("planner")} />
            <ViewTab active={view === "queue"} icon="view_kanban" label="Queue" onClick={() => setView("queue")} />
            <ViewTab active={view === "media"} icon="photo_library" label="Media" onClick={() => setView("media")} />
            <ViewTab active={view === "analytics"} icon="monitoring" label="Analytics" onClick={() => setView("analytics")} />
            <ViewTab active={view === "channels"} icon="hub" label="Channels" onClick={() => setView("channels")} />
          </div>

          {contentView}
        </main>
      </div>

      <Modal
        open={channelOpen}
        onCancel={() => setChannelOpen(false)}
        onOk={handleCreateChannel}
        okText="Add channel"
        confirmLoading={createChannel.isPending}
        title="Add social channel"
        width={560}
      >
        <div style={{ display: "grid", gap: 14 }}>
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
                      background: active ? `${meta.color}14` : "#fff",
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

          {!embedded ? (
            <Select
              value={channelDraft.projectId}
              onChange={(value) => setChannelDraft((prev) => ({ ...prev, projectId: value }))}
              options={[
                { value: "", label: "Team-wide channel" },
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
            placeholder="@handle"
            value={channelDraft.handle}
            onChange={(event) => setChannelDraft((prev) => ({ ...prev, handle: event.target.value }))}
          />
          <Input
            placeholder="Avatar image URL (optional)"
            value={channelDraft.avatarUrl}
            onChange={(event) => setChannelDraft((prev) => ({ ...prev, avatarUrl: event.target.value }))}
          />
          <Input
            placeholder="Followers count"
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
          <TextArea
            rows={4}
            placeholder="Brief"
            value={campaignDraft.brief}
            onChange={(event) => setCampaignDraft((prev) => ({ ...prev, brief: event.target.value }))}
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
        okText="Create post"
        width={760}
        confirmLoading={createPost.isPending}
        title="Create content post"
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
          <Input
            placeholder="Post title"
            value={postDraft.title}
            onChange={(event) => setPostDraft((prev) => ({ ...prev, title: event.target.value }))}
          />
          <TextArea
            rows={5}
            placeholder="Write the caption, hook, CTA, or platform-specific notes"
            value={postDraft.caption}
            onChange={(event) => setPostDraft((prev) => ({ ...prev, caption: event.target.value }))}
          />
          {(() => {
            // Strictest character limit across the selected channels' platforms.
            const picked = (channels ?? []).filter((c) => postDraft.channelIds.includes(c.id));
            if (picked.length === 0) return null;
            const limit = Math.min(
              ...picked.map((c) => PLATFORM_MAX_LEN[c.platform] ?? 5000),
            );
            const over = postDraft.caption.length > limit;
            const tightest = picked.reduce((a, c) =>
              (PLATFORM_MAX_LEN[c.platform] ?? 5000) < (PLATFORM_MAX_LEN[a.platform] ?? 5000) ? c : a,
            );
            return (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: -6, fontSize: 11.5 }}>
                <span style={{ color: over ? C.red : C.textSecondary }}>
                  {postDraft.caption.length} / {limit}
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
            placeholder="Publish on channels"
            value={postDraft.channelIds}
            onChange={(value) => setPostDraft((prev) => ({ ...prev, channelIds: value }))}
            options={visibleChannels
              .filter((channel) => !postDraft.projectId || !channel.project_id || channel.project_id === postDraft.projectId)
              .map((channel) => ({
                value: channel.id,
                label: `${brandMeta(channel.platform).label} • @${channel.handle.replace(/^@/, "")}`,
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
    </>
  );
}
