"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";
import type { Database } from "@/types/database";

export type SocialChannelRow =
  Database["public"]["Tables"]["app_content_studio_destinations"]["Row"];
export type SocialCampaignRow =
  Database["public"]["Tables"]["app_content_studio_campaigns"]["Row"];
export type SocialPostRow =
  Database["public"]["Tables"]["app_content_studio_items"]["Row"];
export type SocialPostChannelRow =
  Database["public"]["Tables"]["app_content_studio_item_destinations"]["Row"];
export type SocialPostAssetRow =
  Database["public"]["Tables"]["app_content_studio_item_assets"]["Row"];

export type SocialPlatform =
  | "instagram"
  | "linkedin"
  | "x"
  | "facebook"
  | "threads"
  | "youtube"
  | "tiktok"
  | "reddit"
  | "bluesky"
  | "pinterest"
  | "telegram"
  | "discord"
  | "mastodon"
  | "whatsapp";

/** Ordered platform list for pickers (matches PLATFORM_BRANDS in the UI). */
export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  "x",
  "instagram",
  "linkedin",
  "facebook",
  "youtube",
  "tiktok",
  "threads",
  "bluesky",
  "pinterest",
  "telegram",
  "discord",
  "mastodon",
  "whatsapp",
  "reddit",
];

/**
 * What a piece of content actually is. Mirrors the CHECK on
 * app_content_studio_items.content_type — the database rejects anything else.
 */
export type ContentType =
  | "social_post"
  | "blog_post"
  | "newsletter"
  | "video"
  | "podcast"
  | "other";

/** Ordered content-type list for pickers and filters. */
export const CONTENT_TYPES: ContentType[] = [
  "social_post",
  "blog_post",
  "newsletter",
  "video",
  "podcast",
  "other",
];

export const CONTENT_TYPE_META: Record<
  ContentType,
  { label: string; icon: string; tone: string }
> = {
  social_post: { label: "Social post", icon: "tag", tone: "#4a4ad0" },
  blog_post: { label: "Blog post", icon: "article", tone: "#2f9c9c" },
  newsletter: { label: "Newsletter", icon: "mail", tone: "#b8842a" },
  video: { label: "Video", icon: "videocam", tone: "#c0453c" },
  podcast: { label: "Podcast", icon: "podcasts", tone: "#7a5af5" },
  other: { label: "Other", icon: "category", tone: "#6a6d78" },
};

/**
 * Where content lands. Mirrors the CHECK on
 * app_content_studio_destinations.kind — again, an exact list.
 *
 * A destination's `platform` column is free text: a social account holds a
 * SocialPlatform there, every other kind holds its own slug.
 */
export type DestinationKind =
  | "social_account"
  | "blog"
  | "newsletter"
  | "video_channel"
  | "podcast"
  | "other";

/** Ordered destination-kind list for pickers. */
export const DESTINATION_KINDS: DestinationKind[] = [
  "social_account",
  "blog",
  "newsletter",
  "video_channel",
  "podcast",
  "other",
];

/**
 * Whether the social mechanics apply — platform character caps, follower
 * counts, brand chrome. A blog post has none of those. Both helpers treat a
 * missing value as the social default, matching the columns' DB defaults.
 */
export function isSocialContentType(type: string | null | undefined): boolean {
  return (type ?? "social_post") === "social_post";
}

export function isSocialDestinationKind(kind: string | null | undefined): boolean {
  return (kind ?? "social_account") === "social_account";
}

export type SocialPostStatus =
  | "draft"
  | "pending_approval"
  | "scheduled"
  | "published"
  | "failed";

export const SOCIAL_POST_STATUS_META: Record<
  SocialPostStatus,
  { label: string; tone: string; soft: string }
> = {
  draft: {
    label: "Draft",
    tone: "#6a6d78",
    soft: "rgba(106,109,120,0.12)",
  },
  pending_approval: {
    label: "Needs approval",
    tone: "#d08422",
    soft: "rgba(208,132,34,0.14)",
  },
  scheduled: {
    label: "Scheduled",
    tone: "#4a4ad0",
    soft: "rgba(74,74,208,0.14)",
  },
  published: {
    label: "Published",
    tone: "#1f9d68",
    soft: "rgba(31,157,104,0.14)",
  },
  failed: {
    label: "Failed",
    tone: "#d94b4b",
    soft: "rgba(217,75,75,0.14)",
  },
};

export type SocialChannelWithProject = SocialChannelRow & {
  project: { id: string; name: string; color_code: string | null } | null;
};

export type SocialCampaignWithProject = SocialCampaignRow & {
  project: { id: string; name: string; color_code: string | null } | null;
};

export type SocialPostWithRelations = SocialPostRow & {
  project: { id: string; name: string; color_code: string | null } | null;
  task: { id: string; name: string; task_no: number | null } | null;
  campaign: { id: string; name: string; theme_color: string } | null;
  channels: {
    id: string;
    sort_order: number;
    variant_body: string | null;
    channel: {
      id: string;
      name: string;
      platform: string;
      kind: string;
      handle: string;
      theme_color: string;
    } | null;
  }[];
  assets: {
    id: string;
    sort_order: number;
    file: {
      id: string;
      name: string;
      mime: string | null;
      size_bytes: number | null;
      project_id: string | null;
    } | null;
  }[];
};

const channelsKey = (teamId: string | undefined, projectId: string | undefined, includeShared: boolean) =>
  ["content-studio", "channels", teamId, projectId ?? "__all__", includeShared] as const;
const campaignsKey = (teamId: string | undefined, projectId: string | undefined, includeShared: boolean) =>
  ["content-studio", "campaigns", teamId, projectId ?? "__all__", includeShared] as const;
const postsKey = (teamId: string | undefined, projectId: string | undefined, includeShared: boolean) =>
  ["content-studio", "posts", teamId, projectId ?? "__all__", includeShared] as const;

// The leading `*` carries content_type back with the rest of the item's columns;
// the destination's `kind` has to be named explicitly because that nested select
// is a column list, and the card chrome branches on it.
const POST_SELECT = `
  *,
  project:projects!app_content_studio_items_project_fk ( id, name, color_code ),
  task:tasks!app_content_studio_items_task_fk ( id, name, task_no ),
  campaign:app_content_studio_campaigns!app_content_studio_items_campaign_fk ( id, name, theme_color ),
  channels:app_content_studio_item_destinations (
    id,
    sort_order,
    variant_body,
    channel:app_content_studio_destinations!app_content_studio_item_destinations_destination_fk (
      id, name, platform, kind, handle, theme_color
    )
  ),
  assets:app_content_studio_item_assets (
    id,
    sort_order,
    file:app_files_files!app_content_studio_item_assets_file_fk (
      id, name, mime, size_bytes, project_id
    )
  )
`;

export function useContentStudioChannels(
  projectId?: string,
  includeShared = true,
) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: channelsKey(teamId, projectId, includeShared),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<SocialChannelWithProject[]> => {
      let query = supabase
        .from("app_content_studio_destinations")
        .select(
          "*, project:projects!app_content_studio_destinations_project_fk ( id, name, color_code )",
        )
        .eq("team_id", teamId as string)
        .order("audience_size", { ascending: false })
        .order("name", { ascending: true });
      if (projectId) {
        query = includeShared
          ? query.or(`project_id.is.null,project_id.eq.${projectId}`)
          : query.eq("project_id", projectId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as SocialChannelWithProject[];
    },
  });
}

export function useContentStudioCampaigns(
  projectId?: string,
  includeShared = true,
) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: campaignsKey(teamId, projectId, includeShared),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<SocialCampaignWithProject[]> => {
      let query = supabase
        .from("app_content_studio_campaigns")
        .select(
          "*, project:projects!app_content_studio_campaigns_project_fk ( id, name, color_code )",
        )
        .eq("team_id", teamId as string)
        .order("start_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (projectId) {
        query = includeShared
          ? query.or(`project_id.is.null,project_id.eq.${projectId}`)
          : query.eq("project_id", projectId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as SocialCampaignWithProject[];
    },
  });
}

export function useContentStudioPosts(
  projectId?: string,
  includeShared = false,
) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: postsKey(teamId, projectId, includeShared),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<SocialPostWithRelations[]> => {
      let query = supabase
        .from("app_content_studio_items")
        .select(POST_SELECT)
        .eq("team_id", teamId as string)
        .order("scheduled_for", { ascending: true, nullsFirst: false })
        .order("updated_at", { ascending: false });
      if (projectId) {
        query = includeShared
          ? query.or(`project_id.is.null,project_id.eq.${projectId}`)
          : query.eq("project_id", projectId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as SocialPostWithRelations[];
    },
  });
}

export interface CreateSocialChannelInput {
  projectId?: string | null;
  name: string;
  /** A SocialPlatform for a social account; the kind's own slug otherwise. */
  platform: SocialPlatform | DestinationKind;
  /** Defaults to a social account so existing call sites keep working. */
  kind?: DestinationKind;
  handle: string;
  avatarUrl?: string | null;
  themeColor?: string | null;
  followersCount?: number | null;
}

export function useCreateSocialChannel() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: CreateSocialChannelInput): Promise<SocialChannelRow> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await supabase
        .from("app_content_studio_destinations")
        .insert({
          team_id: teamId,
          project_id: input.projectId ?? null,
          name: input.name,
          platform: input.platform,
          kind: input.kind ?? "social_account",
          handle: input.handle,
          avatar_url: input.avatarUrl ?? null,
          theme_color: input.themeColor ?? "#ff7a45",
          audience_size: input.followersCount ?? 0,
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-studio", "channels"] });
    },
  });
}

export function useUpdateSocialChannel() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<
        Pick<
          SocialChannelRow,
          | "name"
          | "handle"
          | "platform"
          | "kind"
          | "avatar_url"
          | "theme_color"
          | "audience_size"
          | "connected"
        >
      >;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_content_studio_destinations")
        .update(input.patch)
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-studio", "channels"] });
    },
  });
}

export interface CreateSocialCampaignInput {
  projectId?: string | null;
  name: string;
  brief?: string | null;
  goal?: string | null;
  themeColor?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export function useCreateSocialCampaign() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: CreateSocialCampaignInput): Promise<SocialCampaignRow> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await supabase
        .from("app_content_studio_campaigns")
        .insert({
          team_id: teamId,
          project_id: input.projectId ?? null,
          name: input.name,
          brief: input.brief ?? null,
          goal: input.goal ?? null,
          theme_color: input.themeColor ?? "#7c6cf0",
          start_date: input.startDate ?? null,
          end_date: input.endDate ?? null,
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-studio", "campaigns"] });
    },
  });
}

export interface CreateSocialPostInput {
  projectId?: string | null;
  taskId?: string | null;
  campaignId?: string | null;
  title: string;
  body: string;
  /** Defaults to a social post so existing call sites keep working. */
  contentType?: ContentType;
  status: SocialPostStatus;
  scheduledFor?: string | null;
  targetUrl?: string | null;
  approvalRequired?: boolean;
  impressions?: number;
  engagements?: number;
  clicks?: number;
  channelIds: string[];
  fileIds: string[];
}

export function useCreateSocialPost() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: CreateSocialPostInput): Promise<SocialPostRow> => {
      if (!teamId) throw new Error("No active team");
      const payload = {
        team_id: teamId,
        project_id: input.projectId ?? null,
        task_id: input.taskId ?? null,
        campaign_id: input.campaignId ?? null,
        title: input.title,
        body: input.body,
        content_type: input.contentType ?? "social_post",
        status: input.status,
        scheduled_for: input.scheduledFor ?? null,
        published_at:
          input.status === "published"
            ? input.scheduledFor ?? new Date().toISOString()
            : null,
        target_url: input.targetUrl ?? null,
        approval_required: Boolean(input.approvalRequired),
        impressions: input.impressions ?? 0,
        engagements: input.engagements ?? 0,
        clicks: input.clicks ?? 0,
        created_by: user?.id ?? null,
      };
      const { data: post, error } = await supabase
        .from("app_content_studio_items")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;

      if (input.channelIds.length) {
        const { error: channelError } = await supabase
          .from("app_content_studio_item_destinations")
          .insert(
            input.channelIds.map((channelId, index) => ({
              item_id: post.id,
              destination_id: channelId,
              sort_order: index,
            })),
          );
        if (channelError) throw channelError;
      }

      if (input.fileIds.length) {
        const { error: assetError } = await supabase
          .from("app_content_studio_item_assets")
          .insert(
            input.fileIds.map((fileId, index) => ({
              item_id: post.id,
              file_id: fileId,
              sort_order: index,
            })),
          );
        if (assetError) throw assetError;
      }

      return post;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-studio", "posts"] });
    },
  });
}

export function useUpdateSocialPost() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<
        Pick<
          SocialPostRow,
          | "title"
          | "body"
          | "content_type"
          | "status"
          | "scheduled_for"
          | "published_at"
          | "campaign_id"
          | "task_id"
          | "target_url"
          | "approval_required"
          | "impressions"
          | "engagements"
          | "clicks"
        >
      >;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_content_studio_items")
        .update(input.patch)
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-studio", "posts"] });
    },
  });
}
