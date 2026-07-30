"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

/** A task attachment metadata row. */
export type TaskAttachment =
  Database["public"]["Tables"]["task_attachments"]["Row"];

const AVATARS_BUCKET = "avatars" as const;
const ATTACHMENTS_BUCKET = "attachments" as const;
/** Signed URL lifetime for private attachment downloads (~1 hour). */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const STORAGE_ROOT = "storage" as const;
const profileKey = ["profile"] as const;
const attachmentsKey = (taskId: string | undefined) =>
  [STORAGE_ROOT, "attachments", taskId] as const;

/** Derives a lowercase file extension from a filename, defaulting to "png". */
function fileExtension(fileName: string, fallback = "png"): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return fallback;
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * Uploads an avatar image to the PUBLIC `avatars` bucket at
 * `<uid>/avatar-<timestamp>.<ext>` (upsert), then persists the resulting public
 * URL onto the current user's `public.users.avatar_url`.
 */
export function useUploadAvatar() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const ext = fileExtension(file.name);
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(AVATARS_BUCKET)
        .upload(path, file, {
          upsert: true,
          contentType: file.type || undefined,
        });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);

      const { error: updateError } = await supabase
        .from("users")
        .update({ avatar_url: publicUrl })
        .eq("id", user.id);
      if (updateError) throw updateError;

      return publicUrl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKey });
    },
  });
}

/**
 * Uploads an inline image (pasted/dropped into a rich text field) to the
 * PUBLIC avatars bucket under the caller's own folder — which the bucket RLS
 * already permits — and returns a stable public URL suitable for embedding in
 * markdown. Kept separate from `useUploadAvatar` so it never touches the
 * user's profile.
 */
export function useUploadInlineImage() {
  const supabase = useMemo(() => createClient(), []);

  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");
      if (!file.type.startsWith("image/")) throw new Error("Only images can be embedded.");

      const ext = fileExtension(file.name) || "png";
      const path = `${user.id}/inline-${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(AVATARS_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
      return publicUrl;
    },
  });
}

/**
 * Lists the metadata rows for a task's attachments (newest first). RLS scopes
 * the rows to attachments the user can access.
 */
export function useTaskAttachments(taskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: attachmentsKey(taskId),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<TaskAttachment[]> => {
      const { data, error } = await supabase
        .from("task_attachments")
        .select("*")
        .eq("task_id", taskId as string)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface UploadAttachmentInput {
  taskId: string;
  projectId: string;
  teamId: string;
  file: File;
}

/**
 * Uploads a file to the PRIVATE `attachments` bucket at
 * `<teamId>/<projectId>/<taskId>/<name>-<timestamp>.<ext>` and records a
 * `task_attachments` metadata row pointing at it.
 */
export function useUploadAttachment() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: UploadAttachmentInput,
    ): Promise<TaskAttachment> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { file, taskId, projectId, teamId } = input;

      // Unique storage path: keep the original name but suffix a timestamp so
      // repeated uploads of the same file never collide.
      const ext = fileExtension(file.name, "");
      const dot = file.name.lastIndexOf(".");
      const base = dot > 0 ? file.name.slice(0, dot) : file.name;
      const safeBase = base.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const fileName = ext
        ? `${safeBase}-${Date.now()}.${ext}`
        : `${safeBase}-${Date.now()}`;
      const storagePath = `${teamId}/${projectId}/${taskId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(storagePath, file, {
          upsert: false,
          contentType: file.type || undefined,
        });
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from("task_attachments")
        .insert({
          task_id: taskId,
          project_id: projectId,
          team_id: teamId,
          name: file.name,
          size: file.size,
          type: file.type || null,
          storage_path: storagePath,
          uploaded_by: user.id,
        })
        .select("*")
        .single();

      if (error) {
        // Roll back the uploaded object if the metadata insert failed.
        await supabase.storage.from(ATTACHMENTS_BUCKET).remove([storagePath]);
        throw error;
      }

      return data;
    },
    onSuccess: (attachment) => {
      queryClient.invalidateQueries({
        queryKey: attachmentsKey(attachment.task_id),
      });
    },
  });
}

/**
 * Deletes a task attachment: removes the storage object and the metadata row.
 */
export function useDeleteAttachment() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (attachment: TaskAttachment): Promise<void> => {
      const { error: storageError } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .remove([attachment.storage_path]);
      if (storageError) throw storageError;

      const { error } = await supabase
        .from("task_attachments")
        .delete()
        .eq("id", attachment.id);
      if (error) throw error;
    },
    onSuccess: (_data, attachment) => {
      queryClient.invalidateQueries({
        queryKey: attachmentsKey(attachment.task_id),
      });
    },
  });
}

/**
 * Returns a ~1h signed download URL for a private attachment storage path.
 * Standalone helper (not a hook) so it can be called on demand (e.g. on click).
 */
export async function getAttachmentSignedUrl(
  storagePath: string,
): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Failed to create signed URL");
  return data.signedUrl;
}

/** 25 MB — comfortably above a phone screenshot, below anything that would
 *  stall a chat thread. */
export const CHAT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Uploads a chat attachment (image OR document) to the PUBLIC avatars bucket
 * under the caller's own folder and returns its public URL.
 *
 * Separate from `useUploadInlineImage`, which is images-only because it embeds
 * into rich text; a chat message renders non-images as download chips, so this
 * one accepts them.
 */
export function useUploadChatFile() {
  const supabase = useMemo(() => createClient(), []);

  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");
      if (file.size > CHAT_UPLOAD_MAX_BYTES)
        throw new Error(`${file.name} is larger than 25 MB.`);

      const ext = fileExtension(file.name) || "bin";
      const path = `${user.id}/chat-${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(AVATARS_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
      return publicUrl;
    },
  });
}
