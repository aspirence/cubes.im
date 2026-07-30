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
  Database["public"]["Tables"]["app_social_studio_channels"]["Row"];
export type SocialCampaignRow =
  Database["public"]["Tables"]["app_social_studio_campaigns"]["Row"];
export type SocialPostRow =
  Database["public"]["Tables"]["app_social_studio_posts"]["Row"];
export type SocialPostChannelRow =
  Database["public"]["Tables"]["app_social_studio_post_channels"]["Row"];
export type SocialPostAssetRow =
  Database["public"]["Tables"]["app_social_studio_post_assets"]["Row"];

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
    variant_caption: string | null;
    channel: {
      id: string;
      name: string;
      platform: string;
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
  ["social-studio", "channels", teamId, projectId ?? "__all__", includeShared] as const;
const campaignsKey = (teamId: string | undefined, projectId: string | undefined, includeShared: boolean) =>
  ["social-studio", "campaigns", teamId, projectId ?? "__all__", includeShared] as const;
const postsKey = (teamId: string | undefined, projectId: string | undefined, includeShared: boolean) =>
  ["social-studio", "posts", teamId, projectId ?? "__all__", includeShared] as const;

const POST_SELECT = `
  *,
  project:projects!app_social_studio_posts_project_fk ( id, name, color_code ),
  task:tasks!app_social_studio_posts_task_fk ( id, name, task_no ),
  campaign:app_social_studio_campaigns!app_social_studio_posts_campaign_fk ( id, name, theme_color ),
  channels:app_social_studio_post_channels (
    id,
    sort_order,
    variant_caption,
    channel:app_social_studio_channels!app_social_studio_post_channels_channel_fk (
      id, name, platform, handle, theme_color
    )
  ),
  assets:app_social_studio_post_assets (
    id,
    sort_order,
    file:app_files_files!app_social_studio_post_assets_file_fk (
      id, name, mime, size_bytes, project_id
    )
  )
`;

export function useSocialStudioChannels(
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
        .from("app_social_studio_channels")
        .select(
          "*, project:projects!app_social_studio_channels_project_fk ( id, name, color_code )",
        )
        .eq("team_id", teamId as string)
        .order("followers_count", { ascending: false })
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

export function useSocialStudioCampaigns(
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
        .from("app_social_studio_campaigns")
        .select(
          "*, project:projects!app_social_studio_campaigns_project_fk ( id, name, color_code )",
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

export function useSocialStudioPosts(
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
        .from("app_social_studio_posts")
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
  platform: SocialPlatform;
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
        .from("app_social_studio_channels")
        .insert({
          team_id: teamId,
          project_id: input.projectId ?? null,
          name: input.name,
          platform: input.platform,
          handle: input.handle,
          avatar_url: input.avatarUrl ?? null,
          theme_color: input.themeColor ?? "#ff7a45",
          followers_count: input.followersCount ?? 0,
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social-studio", "channels"] });
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
        .from("app_social_studio_campaigns")
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
      queryClient.invalidateQueries({ queryKey: ["social-studio", "campaigns"] });
    },
  });
}

export interface CreateSocialPostInput {
  projectId?: string | null;
  taskId?: string | null;
  campaignId?: string | null;
  title: string;
  caption: string;
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
        caption: input.caption,
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
        .from("app_social_studio_posts")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;

      if (input.channelIds.length) {
        const { error: channelError } = await supabase
          .from("app_social_studio_post_channels")
          .insert(
            input.channelIds.map((channelId, index) => ({
              post_id: post.id,
              channel_id: channelId,
              sort_order: index,
            })),
          );
        if (channelError) throw channelError;
      }

      if (input.fileIds.length) {
        const { error: assetError } = await supabase
          .from("app_social_studio_post_assets")
          .insert(
            input.fileIds.map((fileId, index) => ({
              post_id: post.id,
              file_id: fileId,
              sort_order: index,
            })),
          );
        if (assetError) throw assetError;
      }

      return post;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social-studio", "posts"] });
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
          | "caption"
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
        .from("app_social_studio_posts")
        .update(input.patch)
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social-studio", "posts"] });
    },
  });
}
