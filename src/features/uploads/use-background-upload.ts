"use client";

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";
import { useUploadStore, type UploadJob } from "@/store/upload-store";
import type { UploadFileInput, FileRow } from "@/features/app-files/use-files";

const BUCKET = "team-files";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

/**
 * Uploads a file to the team-files bucket IN THE BACKGROUND with real progress.
 * The bytes go via a raw XHR to the storage REST endpoint (supabase-js's
 * `upload` gives no progress), so the app-shell header can show a live
 * percentage and offer a cancel (xhr.abort). Returns the created FileRow — the
 * caller can close its modal first and still chain on the result (e.g. create a
 * Video Review from it) without blocking the UI.
 */
export function useBackgroundUpload() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const teamId = activeTeam?.id;
  const userId = user?.id;

  return useCallback(
    async (input: UploadFileInput): Promise<FileRow> => {
      if (!teamId) throw new Error("No active team");
      const jobId = crypto.randomUUID();
      const path = `${teamId}/${crypto.randomUUID()}/${safeName(input.file.name)}`;
      const xhr = new XMLHttpRequest();

      useUploadStore.getState().add({
        id: jobId,
        name: input.file.name,
        progress: 0,
        status: "uploading",
        cancel: () => xhr.abort(),
      });
      const finish = (patch: Partial<UploadJob>) => {
        useUploadStore.getState().update(jobId, patch);
        if (patch.status && patch.status !== "uploading") {
          // Let the header show the terminal state briefly, then drop it.
          window.setTimeout(() => useUploadStore.getState().remove(jobId), 2500);
        }
      };

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token ?? ANON;

      // Match supabase-js's browser upload EXACTLY: a File/Blob goes up as
      // multipart/form-data (fields `cacheControl` + an empty-named file part),
      // NOT as a raw binary body. XHR still reports upload progress for a
      // FormData body, so we keep the live percentage + abort.
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", input.file, input.file.name);

      try {
        await new Promise<void>((resolve, reject) => {
          xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`);
          xhr.setRequestHeader("authorization", `Bearer ${token}`);
          xhr.setRequestHeader("apikey", ANON);
          xhr.setRequestHeader("x-upsert", "false");
          // No content-type header — the browser sets the multipart boundary.
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              useUploadStore.getState().update(jobId, {
                progress: e.loaded / e.total,
              });
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) return resolve();
            let msg = `Upload failed (${xhr.status})`;
            try {
              const j = JSON.parse(xhr.responseText);
              msg = j?.message || j?.error || msg;
            } catch {
              /* non-JSON error body */
            }
            reject(new Error(msg));
          };
          xhr.onerror = () => reject(new Error("Network error during upload"));
          xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
          xhr.send(form);
        });
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        finish({
          status: aborted ? "canceled" : "error",
          error: aborted ? undefined : (err as Error)?.message,
        });
        void supabase.storage.from(BUCKET).remove([path]); // best-effort cleanup
        throw err;
      }

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
          created_by: userId ?? null,
          source_relative_path: input.sourceRelativePath ?? null,
          source_import_label: input.sourceImportLabel ?? null,
        } as never)
        .select("*")
        .single();
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]);
        finish({ status: "error", error: error.message });
        throw error;
      }
      finish({ status: "done", progress: 1 });
      queryClient.invalidateQueries({ queryKey: ["app-files"] });
      return data as FileRow;
    },
    [supabase, teamId, userId, queryClient],
  );
}
