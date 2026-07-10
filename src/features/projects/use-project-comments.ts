"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export type ProjectCommentRow =
  Database["public"]["Tables"]["project_comments"]["Row"];

/** A project comment joined to its author (created_by -> users). */
export type ProjectComment = ProjectCommentRow & {
  author: {
    id: string;
    name: string;
    avatar_url: string | null;
  } | null;
};

const COMMENTS_ROOT = "project-comments" as const;

const commentsKey = (projectId: string | undefined) =>
  [COMMENTS_ROOT, projectId] as const;

/**
 * The FK-embed select string. PostgREST resolves the author via the named
 * foreign key; the relational types are awkward against the generated
 * `Database` type, so rows are cast through `unknown` into `ProjectComment`.
 */
const COMMENT_SELECT = `
  *,
  author:users!project_comments_created_by_fk ( id, name, avatar_url )
`;

/**
 * Lists a project's comments newest-first, each joined to its author. RLS scopes
 * the result to members of the project's team.
 */
export function useProjectComments(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: commentsKey(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProjectComment[]> => {
      const { data, error } = await supabase
        .from("project_comments")
        .select(COMMENT_SELECT)
        .eq("project_id", projectId as string)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as ProjectComment[];
    },
  });
}

export interface AddProjectCommentInput {
  projectId: string;
  content: string;
  /** uuids of mentioned users; a DB trigger notifies them. */
  mentions?: string[];
}

/**
 * Adds a comment to a project. `created_by` is set to the current auth user;
 * `mentions` is persisted so the DB trigger can notify mentioned users. RLS
 * scopes writes to project team members.
 */
export function useAddProjectComment() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: AddProjectCommentInput,
    ): Promise<ProjectCommentRow> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("project_comments")
        .insert({
          project_id: input.projectId,
          content: input.content,
          created_by: user.id,
          mentions: input.mentions ?? [],
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: commentsKey(input.projectId),
      });
    },
  });
}
