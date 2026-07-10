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

const BUCKET = "team-files" as const;
const SIGNED_TTL = 60 * 60; // 1h preview/download links

export type FileRow = Database["public"]["Tables"]["app_files_files"]["Row"];
export type FileFolder =
  Database["public"]["Tables"]["app_files_folders"]["Row"];

export type FileWithMeta = FileRow & {
  project: { id: string; name: string; color_code: string | null } | null;
  author: { id: string; name: string; avatar_url: string | null } | null;
};

const filesKey = (teamId: string | undefined) => ["app-files", teamId] as const;
const fileFoldersKey = (teamId: string | undefined, projectId: string | null) =>
  ["app-files-folders", teamId, projectId] as const;

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

export function humanSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** All files the caller can see in the active team, newest first. */
export function useTeamFiles() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: filesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<FileWithMeta[]> => {
      const { data, error } = await supabase
        .from("app_files_files")
        .select(
          `*,
           project:projects!app_files_files_project_fk ( id, name, color_code ),
           author:users!app_files_files_created_by_fk ( id, name, avatar_url )`,
        )
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FileWithMeta[];
    },
  });
}

/** Folders for a project scope (null = team-wide folders). */
export function useFileFolders(projectId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: fileFoldersKey(teamId, projectId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<FileFolder[]> => {
      let q = supabase
        .from("app_files_folders")
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

export function useCreateFileFolder() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      name: string;
      projectId: string | null;
    }): Promise<FileFolder> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await supabase
        .from("app_files_folders")
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
        queryKey: fileFoldersKey(teamId, input.projectId),
      });
    },
  });
}

export function useRenameFileFolder() {
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
        .from("app_files_folders")
        .update({ name: input.name })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({
        queryKey: fileFoldersKey(teamId, input.projectId),
      });
    },
  });
}

export function useDeleteFileFolder() {
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
        .from("app_files_folders")
        .delete()
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({
        queryKey: fileFoldersKey(teamId, input.projectId),
      });
      queryClient.invalidateQueries({ queryKey: ["app-files"] });
    },
  });
}

export interface UploadFileInput {
  file: File;
  projectId: string | null;
  folderId: string | null;
  allowDownload: boolean;
  watermark: boolean;
  sourceRelativePath?: string | null;
  sourceImportLabel?: string | null;
}

/** Uploads to the private team bucket + records metadata with permissions. */
export function useUploadTeamFile() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: UploadFileInput): Promise<FileRow> => {
      if (!teamId) throw new Error("No active team");
      const path = `${teamId}/${crypto.randomUUID()}/${safeName(input.file.name)}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, input.file, {
          upsert: false,
          contentType: input.file.type || "application/octet-stream",
        });
      if (upErr) throw upErr;
      const { data, error } = await supabase
        .from("app_files_files")
        .insert({
          team_id: teamId,
          project_id: input.projectId,
          folder_id: input.folderId,
          name: input.file.name,
          storage_path: path,
          mime: input.file.type || null,
          size_bytes: input.file.size,
          allow_download: input.allowDownload,
          watermark: input.watermark,
          created_by: user?.id ?? null,
          source_relative_path: input.sourceRelativePath ?? null,
          source_import_label: input.sourceImportLabel ?? null,
        } as never)
        .select("*")
        .single();
      if (error) {
        // Roll the object back so we never leave orphaned bytes.
        await supabase.storage.from(BUCKET).remove([path]);
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-files"] });
    },
  });
}

/** Signed URL for preview/download of a file. */
export function useFileUrl(file: FileRow | null) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: ["app-files-url", file?.id],
    enabled: Boolean(file),
    queryFn: async (): Promise<string | null> => {
      if (!file) return null;
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(file.storage_path, SIGNED_TTL);
      if (error) throw error;
      return data.signedUrl;
    },
    staleTime: SIGNED_TTL * 1000 * 0.8,
  });
}

/** Updates a file's permission flags / publish state / folder / project. */
export function useUpdateFile() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<
        Pick<
          FileRow,
          "allow_download" | "watermark" | "published" | "folder_id" | "project_id" | "name"
        >
      >;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_files_files")
        .update(input.patch)
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-files"] });
    },
  });
}

/** Deletes a file (metadata + bytes). */
export function useDeleteTeamFile() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: FileRow): Promise<void> => {
      const { data, error } = await supabase
        .from("app_files_files")
        .delete()
        .eq("id", file.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
      await supabase.storage.from(BUCKET).remove([file.storage_path]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-files"] });
    },
  });
}

/**
 * Sends a video file straight into Video Review (no re-upload): creates the
 * review video + v1 revision referencing the SAME storage object via a
 * cross-bucket path (`team-files::<path>`, resolved by useRevisionUrl).
 */
export function useSendFileToReview() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      file: FileRow;
      taskId?: string | null;
      folderId?: string | null;
      title?: string | null;
    }): Promise<string> => {
      if (!teamId) throw new Error("No active team");
      const file = input.file;
      const { data: video, error: vErr } = await supabase
        .from("app_video_review_videos")
        .insert({
          team_id: teamId,
          project_id: file.project_id,
          task_id: input.taskId ?? null,
          folder_id: input.folderId ?? null,
          title: input.title?.trim() || file.name.replace(/\.[a-z0-9]+$/i, ""),
          status: "draft",
          created_by: user?.id ?? null,
        } as never)
        .select("id")
        .single();
      if (vErr) throw vErr;
      const { error: rErr } = await supabase
        .from("app_video_review_revisions")
        .insert({
          video_id: video.id,
          revision: 1,
          storage_path: `team-files::${file.storage_path}`,
          uploaded_by: user?.id ?? null,
        });
      if (rErr) {
        await supabase.from("app_video_review_videos").delete().eq("id", video.id);
        throw rErr;
      }
      return video.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["video-review"] });
    },
  });
}

export interface ImportFolderInput {
  files: File[];
  projectId: string | null;
  fileFolderId: string | null;
  reviewFolderId: string | null;
  allowDownload: boolean;
  watermark: boolean;
  importLabel: string;
  taskId?: string | null;
}

export interface ImportFolderResult {
  total: number;
  uploaded: number;
  reviewsCreated: number;
  skipped: number;
  failures: { name: string; reason: string }[];
}

/** Imports a browser-selected local folder into Files and mirrors videos into Video Review. */
export function useImportLocalFolder() {
  const upload = useUploadTeamFile();
  const sendToReview = useSendFileToReview();

  return useMutation({
    mutationFn: async (input: ImportFolderInput): Promise<ImportFolderResult> => {
      const failures: { name: string; reason: string }[] = [];
      let uploaded = 0;
      let reviewsCreated = 0;
      let skipped = 0;

      for (const file of input.files) {
        try {
          const relativePath =
            (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
            file.name;
          const uploadedRow = await upload.mutateAsync({
            file,
            projectId: input.projectId,
            folderId: input.fileFolderId,
            allowDownload: input.allowDownload,
            watermark: input.watermark,
            sourceRelativePath: relativePath,
            sourceImportLabel: input.importLabel,
          });
          uploaded += 1;

          if ((file.type || "").startsWith("video/")) {
            await sendToReview.mutateAsync({
              file: uploadedRow,
              taskId: input.taskId ?? null,
              folderId: input.reviewFolderId,
              title: file.name.replace(/\.[a-z0-9]+$/i, ""),
            });
            reviewsCreated += 1;
          } else {
            skipped += 1;
          }
        } catch (error) {
          failures.push({
            name: file.name,
            reason: error instanceof Error ? error.message : "Import failed",
          });
        }
      }

      return {
        total: input.files.length,
        uploaded,
        reviewsCreated,
        skipped,
        failures,
      };
    },
  });
}
