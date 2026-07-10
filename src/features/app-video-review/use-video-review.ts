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

const BUCKET = "video-review" as const;
const SIGNED_TTL = 60 * 60 * 4; // 4h — long enough to watch a review session.

export type VideoRow = Database["public"]["Tables"]["app_video_review_videos"]["Row"];
export type RevisionRow =
  Database["public"]["Tables"]["app_video_review_revisions"]["Row"];
export type CommentRow =
  Database["public"]["Tables"]["app_video_review_comments"]["Row"];

export type VideoStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "changes_requested";

export const VIDEO_STATUS_META: Record<
  string,
  { label: string; color: string }
> = {
  draft: { label: "Draft", color: "default" },
  in_review: { label: "In review", color: "processing" },
  approved: { label: "Approved", color: "success" },
  changes_requested: { label: "Changes requested", color: "warning" },
};

export type VideoWithProject = VideoRow & {
  project: { id: string; name: string; color_code: string | null } | null;
};

export type CommentWithAuthor = CommentRow & {
  author: { id: string; name: string; avatar_url: string | null } | null;
};

/** A freehand annotation over the paused frame; coordinates normalized 0..1. */
export interface Drawing {
  strokes: { color: string; width: number; points: [number, number][] }[];
}

const videosKey = (teamId: string | undefined) => ["video-review", teamId] as const;
const videoKey = (id: string | undefined) => ["video-review-video", id] as const;
const revisionsKey = (id: string | undefined) =>
  ["video-review-revisions", id] as const;
const commentsKey = (id: string | undefined, rev: number) =>
  ["video-review-comments", id, rev] as const;

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

/** Lists the active team's review videos, newest activity first. */
export function useVideoReviewVideos() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: videosKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<VideoWithProject[]> => {
      const { data, error } = await supabase
        .from("app_video_review_videos")
        .select(
          "*, project:projects!app_video_review_videos_project_fk ( id, name, color_code )",
        )
        .eq("team_id", teamId as string)
        .eq("deleted", false)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as VideoWithProject[];
    },
  });
}

export function useTaskVideoReviews(taskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: ["video-review-task", taskId],
    enabled: Boolean(taskId),
    queryFn: async (): Promise<VideoWithProject[]> => {
      const { data, error } = await supabase
        .from("app_video_review_videos")
        .select(
          "*, project:projects!app_video_review_videos_project_fk ( id, name, color_code )",
        )
        .eq("task_id", taskId as string)
        .eq("deleted", false)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as VideoWithProject[];
    },
  });
}

/** A single review video (with its project). */
export function useVideoReviewVideo(id: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: videoKey(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<VideoWithProject | null> => {
      const { data, error } = await supabase
        .from("app_video_review_videos")
        .select(
          "*, project:projects!app_video_review_videos_project_fk ( id, name, color_code )",
        )
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw error;
      return (data as VideoWithProject | null) ?? null;
    },
  });
}

/** All revisions of a video, newest first. */
export function useVideoRevisions(id: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: revisionsKey(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<RevisionRow[]> => {
      const { data, error } = await supabase
        .from("app_video_review_revisions")
        .select("*")
        .eq("video_id", id as string)
        .order("revision", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Timestamped comments on a specific revision, in play order. */
export function useVideoComments(id: string | undefined, revision: number) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: commentsKey(id, revision),
    enabled: Boolean(id),
    queryFn: async (): Promise<CommentWithAuthor[]> => {
      const { data, error } = await supabase
        .from("app_video_review_comments")
        .select(
          "*, author:users!app_video_review_comments_author_fk ( id, name, avatar_url )",
        )
        .eq("video_id", id as string)
        .eq("revision", revision)
        .order("time_ms", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CommentWithAuthor[];
    },
  });
}

/** Resolves a revision to a playable URL (signed for uploads, raw for links). */
export function useRevisionUrl(revision: RevisionRow | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: ["video-review-url", revision?.id],
    enabled: Boolean(revision),
    queryFn: async (): Promise<string | null> => {
      if (!revision) return null;
      if (revision.storage_path) {
        // A `<bucket>::<path>` prefix references an object in another bucket
        // (e.g. a video sent from the Files app without re-uploading).
        let bucket: string = BUCKET;
        let path = revision.storage_path;
        const sep = path.indexOf("::");
        if (sep > 0) {
          bucket = path.slice(0, sep);
          path = path.slice(sep + 2);
        }
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, SIGNED_TTL);
        if (error) throw error;
        return data.signedUrl;
      }
      return revision.url ?? null;
    },
    staleTime: SIGNED_TTL * 1000 * 0.8,
  });
}

async function uploadToBucket(
  supabase: ReturnType<typeof createClient>,
  teamId: string,
  videoId: string,
  file: File,
): Promise<string> {
  const path = `${teamId}/${videoId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || "video/mp4",
  });
  if (error) throw error;
  return path;
}

export interface CreateVideoInput {
  title: string;
  projectId?: string | null;
  taskId?: string | null;
  folderId?: string | null;
  file?: File | null;
  url?: string | null;
}

/** Creates a video + its first revision (uploaded file or external URL). */
export function useCreateVideoReview() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: CreateVideoInput): Promise<string> => {
      if (!teamId) throw new Error("No active team");
      const { data: video, error: vErr } = await supabase
        .from("app_video_review_videos")
        .insert({
          team_id: teamId,
          project_id: input.projectId ?? null,
          task_id: input.taskId ?? null,
          folder_id: input.folderId ?? null,
          title: input.title,
          // Fresh videos start as a draft in the editing stage; "In review"
          // only happens via send_for_review.
          status: "draft",
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (vErr) throw vErr;

      try {
        let storagePath: string | null = null;
        if (input.file) {
          storagePath = await uploadToBucket(supabase, teamId, video.id, input.file);
        }
        const { error: rErr } = await supabase
          .from("app_video_review_revisions")
          .insert({
            video_id: video.id,
            revision: 1,
            storage_path: storagePath,
            url: storagePath ? null : (input.url ?? null),
            uploaded_by: user?.id ?? null,
          });
        if (rErr) throw rErr;
      } catch (err) {
        // Roll back the video row so we never leave a source-less video.
        await supabase.from("app_video_review_videos").delete().eq("id", video.id);
        throw err;
      }
      return video.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: videosKey(teamId) });
    },
  });
}

export interface AddRevisionInput {
  videoId: string;
  teamId: string;
  nextRevision: number;
  summary?: string | null;
  file?: File | null;
  url?: string | null;
}

/** Uploads a new revision and bumps the video's latest_revision. */
export function useAddRevision() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: AddRevisionInput): Promise<void> => {
      let storagePath: string | null = null;
      if (input.file) {
        storagePath = await uploadToBucket(
          supabase,
          input.teamId,
          input.videoId,
          input.file,
        );
      }
      const { error: rErr } = await supabase
        .from("app_video_review_revisions")
        .insert({
          video_id: input.videoId,
          revision: input.nextRevision,
          storage_path: storagePath,
          url: storagePath ? null : (input.url ?? null),
          summary: input.summary ?? null,
          uploaded_by: user?.id ?? null,
        });
      if (rErr) throw rErr;
      // A new cut re-opens the loop: back to the editing stage as a draft so
      // the editor can send it for review again (fixes the post-approval
      // dead-end where stage stayed 'approved').
      const { error: uErr } = await supabase
        .from("app_video_review_videos")
        .update({
          latest_revision: input.nextRevision,
          updated_at: new Date().toISOString(),
          stage: "editing",
          status: "draft",
        })
        .eq("id", input.videoId);
      if (uErr) throw uErr;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: revisionsKey(input.videoId) });
      queryClient.invalidateQueries({ queryKey: videoKey(input.videoId) });
      queryClient.invalidateQueries({ queryKey: ["video-review"] });
    },
  });
}

/** Adds a timestamped review comment on a revision. */
export function useAddComment() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      videoId: string;
      revision: number;
      body: string;
      timeMs: number;
      drawing?: Drawing | null;
    }): Promise<void> => {
      const { error } = await supabase
        .from("app_video_review_comments")
        .insert({
          video_id: input.videoId,
          revision: input.revision,
          body: input.body,
          time_ms: Math.max(0, Math.round(input.timeMs)),
          author_id: user?.id ?? null,
          drawing: (input.drawing ?? null) as never,
        });
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: commentsKey(input.videoId, input.revision),
      });
    },
  });
}

/** Toggles a comment's resolved flag. */
export function useToggleCommentResolved() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      videoId: string;
      revision: number;
      resolved: boolean;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_video_review_comments")
        .update({ resolved: input.resolved })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: commentsKey(input.videoId, input.revision),
      });
    },
  });
}

/** Sets a video's review status (draft / in_review / approved / changes). */
export function useSetVideoStatus() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: VideoStatus;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_video_review_videos")
        .update({ status: input.status, updated_at: new Date().toISOString() })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: videoKey(input.id) });
      queryClient.invalidateQueries({ queryKey: ["video-review"] });
    },
  });
}

/* ---------------------------------------------------------------- folders */

export type VideoFolder =
  Database["public"]["Tables"]["app_video_review_folders"]["Row"];

const foldersKey = (teamId: string | undefined, projectId: string | null) =>
  ["video-review-folders", teamId, projectId] as const;

/** Folders for a project (or the hub's unscoped folders when projectId null). */
export function useVideoFolders(projectId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: foldersKey(teamId, projectId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<VideoFolder[]> => {
      let q = supabase
        .from("app_video_review_folders")
        .select("*")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });
      q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a folder inside a project (or the hub scope). */
export function useCreateVideoFolder() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      name: string;
      projectId: string | null;
    }): Promise<VideoFolder> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await supabase
        .from("app_video_review_folders")
        .insert({
          team_id: teamId,
          project_id: input.projectId,
          name: input.name,
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({
        queryKey: foldersKey(teamId, input.projectId),
      });
    },
  });
}

/** Renames a folder. */
export function useRenameVideoFolder() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      id: string;
      projectId: string | null;
      name: string;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_video_review_folders")
        .update({ name: input.name })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({
        queryKey: foldersKey(teamId, input.projectId),
      });
    },
  });
}

/** Deletes a folder; its videos become unfiled (FK sets folder_id null). */
export function useDeleteVideoFolder() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      id: string;
      projectId: string | null;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_video_review_folders")
        .delete()
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({
        queryKey: foldersKey(teamId, input.projectId),
      });
      queryClient.invalidateQueries({ queryKey: ["video-review"] });
    },
  });
}

/** Moves a video into a folder (or out, with null). */
export function useMoveVideoToFolder() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      videoId: string;
      folderId: string | null;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_video_review_videos")
        .update({ folder_id: input.folderId })
        .eq("id", input.videoId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["video-review"] });
    },
  });
}

/** Deletes a review video (its revisions + comments cascade). The stored bytes
 *  are left in place — a review may reference a shared Files object. */
export function useDeleteVideo() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { data, error } = await supabase
        .from("app_video_review_videos")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["video-review"] });
    },
  });
}

/* --------------------------------------------------------------- workflow */

export type ReviewerRow =
  Database["public"]["Tables"]["app_video_review_reviewers"]["Row"];
export type ReviewerWithUser = ReviewerRow & {
  user: { id: string; name: string; avatar_url: string | null } | null;
};
export type WorkflowTemplateRow =
  Database["public"]["Tables"]["app_video_review_workflow_templates"]["Row"];
export interface WorkflowTemplateConfig {
  editorId?: string | null;
  reviewerIds?: string[];
  note?: string;
}

const reviewersKey = (id: string | undefined) =>
  ["video-review-reviewers", id] as const;
const wfTemplatesKey = (teamId: string | undefined) =>
  ["video-review-wf-templates", teamId] as const;

/** The stakeholders assigned to review a video (with their user profile). */
export function useVideoReviewers(id: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: reviewersKey(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<ReviewerWithUser[]> => {
      const { data, error } = await supabase
        .from("app_video_review_reviewers")
        .select(
          "*, user:users!app_video_review_reviewers_user_fk ( id, name, avatar_url )",
        )
        .eq("video_id", id as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ReviewerWithUser[];
    },
  });
}

/** Sets (or clears) the editor responsible for a video. */
export function useSetVideoEditor() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      videoId: string;
      editorId: string | null;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_video_review_videos")
        .update({ editor_id: input.editorId })
        .eq("id", input.videoId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: videoKey(input.videoId) });
    },
  });
}

/** Replaces the reviewer set for a video (idempotent add/remove diff). */
export function useSetReviewers() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      videoId: string;
      userIds: string[];
      existing: string[];
    }): Promise<void> => {
      const desired = new Set(input.userIds);
      const current = new Set(input.existing);
      const toAdd = [...desired].filter((u) => !current.has(u));
      const toRemove = [...current].filter((u) => !desired.has(u));
      if (toAdd.length > 0) {
        const { error } = await supabase
          .from("app_video_review_reviewers")
          .insert(toAdd.map((user_id) => ({ video_id: input.videoId, user_id })));
        if (error && error.code !== "23505") throw error;
      }
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from("app_video_review_reviewers")
          .delete()
          .eq("video_id", input.videoId)
          .in("user_id", toRemove);
        if (error) throw error;
      }
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: reviewersKey(input.videoId) });
    },
  });
}

/** Editor sends the cut for review — moves to in_review and notifies reviewers. */
export function useSendForReview() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (videoId: string): Promise<void> => {
      const { error } = await supabase.rpc("video_review_send_for_review", {
        p_video_id: videoId,
      });
      if (error) throw error;
    },
    onSuccess: (_d, videoId) => {
      queryClient.invalidateQueries({ queryKey: videoKey(videoId) });
      queryClient.invalidateQueries({ queryKey: ["video-review"] });
    },
  });
}

/** A reviewer approves (done) or requests changes (back to the editor). */
export function useDecideReview() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      videoId: string;
      approved: boolean;
    }): Promise<void> => {
      const { error } = await supabase.rpc("video_review_decide", {
        p_video_id: input.videoId,
        p_approved: input.approved,
      });
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: videoKey(input.videoId) });
      queryClient.invalidateQueries({ queryKey: ["video-review"] });
    },
  });
}

/** Reusable workflow templates (default editor + reviewer set) for the team. */
export function useVideoWorkflowTemplates() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: wfTemplatesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<WorkflowTemplateRow[]> => {
      const { data, error } = await supabase
        .from("app_video_review_workflow_templates")
        .select("*")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a workflow template (admin-only via RLS). */
export function useCreateWorkflowTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      name: string;
      config: WorkflowTemplateConfig;
    }): Promise<void> => {
      if (!teamId) throw new Error("No active team");
      const { error } = await supabase
        .from("app_video_review_workflow_templates")
        .insert({
          team_id: teamId,
          name: input.name,
          config: input.config as unknown as Database["public"]["Tables"]["app_video_review_workflow_templates"]["Insert"]["config"],
          created_by: user?.id ?? null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wfTemplatesKey(teamId) });
    },
  });
}

/** Applies a template to a video: sets the editor + reviewer set from config. */
export function useApplyWorkflowTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      videoId: string;
      templateId: string;
      config: WorkflowTemplateConfig;
      existingReviewers: string[];
    }): Promise<void> => {
      const editorId = input.config.editorId ?? null;
      const reviewerIds = input.config.reviewerIds ?? [];
      // editor + template link
      const { error: uErr } = await supabase
        .from("app_video_review_videos")
        .update({ editor_id: editorId, workflow_template_id: input.templateId })
        .eq("id", input.videoId);
      if (uErr) throw uErr;
      // reviewers: add any from the template that aren't already present
      const current = new Set(input.existingReviewers);
      const toAdd = reviewerIds.filter((u) => !current.has(u));
      if (toAdd.length > 0) {
        const { error } = await supabase
          .from("app_video_review_reviewers")
          .insert(toAdd.map((user_id) => ({ video_id: input.videoId, user_id })));
        if (error && error.code !== "23505") throw error;
      }
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: videoKey(input.videoId) });
      queryClient.invalidateQueries({ queryKey: reviewersKey(input.videoId) });
    },
  });
}
