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
import type { Database, Json } from "@/types/database";

export type DocRow = Database["public"]["Tables"]["app_docs_docs"]["Row"];
export type PageRow = Database["public"]["Tables"]["app_docs_pages"]["Row"];

/** A content block in a doc page — the unit the block/slash editor edits. */
export type BlockType =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "bulleted"
  | "numbered"
  | "todo"
  | "quote"
  | "code"
  | "divider";

export interface Block {
  id: string;
  type: BlockType;
  text: string;
  checked?: boolean;
}

/** A page row with its jsonb content read back as a typed Block[]. */
export type Page = Omit<PageRow, "content"> & { content: Block[] };

function toBlocks(content: Json): Block[] {
  if (!Array.isArray(content)) return [];
  const out: Block[] = [];
  for (const b of content) {
    if (b && typeof b === "object" && !Array.isArray(b) && "id" in b && "type" in b) {
      out.push(b as unknown as Block);
    }
  }
  return out;
}

const docsKey = (projectId: string | undefined) =>
  ["docs", "list", projectId] as const;
const pagesKey = (docId: string | undefined) =>
  ["docs", "pages", docId] as const;

/* ----------------------------------------------------------------- docs */

/** Lists a project's docs (newest sort first). */
export function useDocs(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: docsKey(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<DocRow[]> => {
      const { data, error } = await supabase
        .from("app_docs_docs")
        .select("*")
        .eq("project_id", projectId as string)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a doc in a project. */
export function useCreateDoc() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      title?: string;
    }): Promise<DocRow> => {
      if (!activeTeam?.id) throw new Error("No active team");
      const { data, error } = await supabase
        .from("app_docs_docs")
        .insert({
          project_id: input.projectId,
          team_id: activeTeam.id,
          title: input.title?.trim() || "Doc",
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: docsKey(input.projectId) });
    },
  });
}

/** Renames a doc. */
export function useRenameDoc() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      projectId: string;
      title: string;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_docs_docs")
        .update({ title: input.title, updated_at: new Date().toISOString() })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: docsKey(input.projectId) });
    },
  });
}

/** Deletes a doc (its pages cascade). */
export function useDeleteDoc() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      projectId: string;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_docs_docs")
        .delete()
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: docsKey(input.projectId) });
    },
  });
}

/* ---------------------------------------------------------------- pages */

/** All pages in a doc (RLS hides private pages you can't see). Tree is built
 *  client-side from parent_id. */
export function usePages(docId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: pagesKey(docId),
    enabled: Boolean(docId),
    queryFn: async (): Promise<Page[]> => {
      const { data, error } = await supabase
        .from("app_docs_pages")
        .select("*")
        .eq("doc_id", docId as string)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((p) => ({ ...p, content: toBlocks(p.content) }));
    },
  });
}

/** Creates a page (or subpage when parentId is set) in a doc. */
export function useCreatePage() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      docId: string;
      projectId: string;
      parentId?: string | null;
      title?: string;
      sortOrder?: number;
    }): Promise<PageRow> => {
      const { data, error } = await supabase
        .from("app_docs_pages")
        .insert({
          doc_id: input.docId,
          project_id: input.projectId,
          parent_id: input.parentId ?? null,
          title: input.title?.trim() || "Untitled",
          sort_order: input.sortOrder ?? 0,
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: pagesKey(input.docId) });
    },
  });
}

export interface UpdatePageInput {
  id: string;
  docId: string;
  title?: string;
  content?: Block[];
  icon?: string | null;
  is_private?: boolean;
  parent_id?: string | null;
  sort_order?: number;
}

/** Patches a page (title / content / icon / privacy / position). */
export function useUpdatePage() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePageInput): Promise<void> => {
      const { id, docId, content, ...rest } = input;
      const patch: Database["public"]["Tables"]["app_docs_pages"]["Update"] = {
        ...rest,
        updated_at: new Date().toISOString(),
      };
      if (content !== undefined) patch.content = content as unknown as Json;
      const { data, error } = await supabase
        .from("app_docs_pages")
        .update(patch)
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
      void docId;
    },
    // Content saves fire on every debounced keystroke batch, so patch the cached
    // page in place instead of invalidating (which would refetch every page's
    // full jsonb each time). The editor seeds local state only on page-id change,
    // so patching content here never clobbers in-progress typing.
    onSuccess: (_d, input) => {
      const { id, docId, ...patch } = input;
      queryClient.setQueryData<Page[]>(pagesKey(docId), (old) =>
        old ? old.map((p) => (p.id === id ? { ...p, ...patch } : p)) : old,
      );
    },
  });
}

/* ---------------------------------------------------------- page sharing */

const pageSharesKey = (pageId: string | undefined) =>
  ["docs", "page-shares", pageId] as const;

/** The user_ids a PRIVATE page is explicitly shared with (author + admins have
 *  access implicitly and are not listed). Only a page manager can read this. */
export function usePageShares(pageId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: pageSharesKey(pageId),
    enabled: Boolean(pageId),
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("app_docs_page_shares")
        .select("user_id")
        .eq("page_id", pageId as string);
      if (error) throw error;
      return (data ?? []).map((r) => r.user_id);
    },
  });
}

/** Reconciles a page's share list to `userIds` (idempotent add/remove diff). */
export function useSetPageShares() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      pageId: string;
      userIds: string[];
      existing: string[];
    }): Promise<void> => {
      const desired = new Set(input.userIds);
      const current = new Set(input.existing);
      const toAdd = input.userIds.filter((u) => !current.has(u));
      const toRemove = input.existing.filter((u) => !desired.has(u));
      if (toAdd.length > 0) {
        const { error } = await supabase
          .from("app_docs_page_shares")
          .insert(toAdd.map((user_id) => ({ page_id: input.pageId, user_id })));
        if (error && error.code !== "23505") throw error;
      }
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from("app_docs_page_shares")
          .delete()
          .eq("page_id", input.pageId)
          .in("user_id", toRemove);
        if (error) throw error;
      }
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: pageSharesKey(input.pageId) });
    },
  });
}

/** Deletes a page (its subpages cascade via parent_id). */
export function useDeletePage() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; docId: string }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_docs_pages")
        .delete()
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: pagesKey(input.docId) });
    },
  });
}
