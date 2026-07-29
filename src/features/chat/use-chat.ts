"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";

/** chat_* tables/RPCs are newer than the generated database types. */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

/** One row of the sidebar feed (list_chat_channels RPC). */
export interface ChatChannelSummary {
  id: string;
  kind: "channel" | "dm" | "group";
  name: string | null;
  topic: string | null;
  is_private: boolean;
  other_user_id: string | null;
  other_user_name: string | null;
  other_avatar: string | null;
  last_body: string | null;
  last_at: string | null;
  last_author: string | null;
  unread_count: number;
  joined: boolean;
  member_count: number;
  /** The OTHER members' names, comma-joined — the label for group DMs. */
  member_names: string | null;
  /** The caller muted this conversation (no notifications, quiet row). */
  muted: boolean;
  /** Channel is archived — read-only; only returned to joined members. */
  archived: boolean;
}

/** A file shared in chat — already uploaded; the message carries its URL. */
export interface ChatAttachment {
  url: string;
  name: string;
  /** MIME type, e.g. "image/png" — drives image vs. file rendering. */
  type: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  channel_id: string;
  user_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  /** Thread root this message replies to; null for top-level messages. */
  parent_id: string | null;
  pinned_at: string | null;
  pinned_by: string | null;
  /** Number of thread replies under this (top-level) message. */
  reply_count: number;
  attachments: ChatAttachment[];
  author: { id: string; name: string; avatar_url: string | null } | null;
}

export interface ChatChannelInfo {
  id: string;
  team_id: string;
  kind: "channel" | "dm" | "group";
  name: string | null;
  topic: string | null;
  is_private: boolean;
  created_by: string;
  created_at: string;
  /** Set when the channel is archived (read-only). */
  archived_at: string | null;
}

export interface ChatMemberInfo {
  id: string;
  user_id: string;
  user: { id: string; name: string; avatar_url: string | null; email: string } | null;
}

const channelsKey = (teamId: string | undefined) =>
  ["chat-channels", teamId] as const;
const messagesKey = (channelId: string | undefined) =>
  ["chat-messages", channelId] as const;
const threadKey = (rootId: string | undefined) =>
  ["chat-thread", rootId] as const;
const pinnedKey = (channelId: string | undefined) =>
  ["chat-pinned", channelId] as const;
const savedKey = (userId: string | undefined) =>
  ["chat-saved", userId] as const;

/** Every conversation the caller can see, newest activity first. */
export function useChatChannels() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: channelsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<ChatChannelSummary[]> => {
      const { data, error } = await loose(supabase).rpc("list_chat_channels", {
        p_team_id: teamId,
      });
      if (error) throw error;
      return (data ?? []) as ChatChannelSummary[];
    },
  });
}

/** Creates a named channel — team admins/owners only (RPC enforces). */
export function useCreateChannel() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      name: string;
      topic?: string;
      isPrivate?: boolean;
      /** users.id of the people to seed the channel with (besides the creator). */
      memberIds?: string[];
    }): Promise<string> => {
      const { data, error } = await loose(supabase).rpc("create_chat_channel", {
        p_team_id: teamId,
        p_name: input.name,
        p_topic: input.topic ?? null,
        p_private: input.isPrivate ?? false,
        p_member_ids: input.memberIds ?? [],
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelsKey(teamId) });
    },
  });
}

/** Add people (users.id[]) to an existing channel — admin or creator only. */
export function useAddChannelMembers(channelId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  return useMutation({
    mutationFn: async (userIds: string[]): Promise<number> => {
      if (!channelId) throw new Error("No channel");
      const { data, error } = await loose(supabase).rpc("add_channel_members", {
        p_channel_id: channelId,
        p_user_ids: userIds,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-channel", channelId] });
      queryClient.invalidateQueries({ queryKey: channelsKey(activeTeam?.id) });
    },
  });
}

/** Remove one person from a channel (or leave, if it's yourself). */
export function useRemoveChannelMember(channelId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  return useMutation({
    mutationFn: async (userId: string): Promise<void> => {
      if (!channelId) throw new Error("No channel");
      const { error } = await loose(supabase).rpc("remove_channel_member", {
        p_channel_id: channelId,
        p_user_id: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-channel", channelId] });
      queryClient.invalidateQueries({ queryKey: channelsKey(activeTeam?.id) });
    },
  });
}

/** Opens (or creates) the 1:1 DM with another member; returns the channel id. */
export function useOpenDm() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (otherUserId: string): Promise<string> => {
      const { data, error } = await loose(supabase).rpc("get_or_create_dm", {
        p_team_id: teamId,
        p_other_user: otherUserId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelsKey(teamId) });
    },
  });
}

/** Creates a group DM (caller + 2..8 others); returns the new channel id. */
export function useCreateGroupDm() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (memberIds: string[]): Promise<string> => {
      const { data, error } = await loose(supabase).rpc("create_group_dm", {
        p_team_id: teamId,
        p_member_ids: memberIds,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelsKey(teamId) });
    },
  });
}

/** A single conversation's row + its member list (for the thread header). */
export function useChatChannel(channelId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: ["chat-channel", channelId],
    enabled: Boolean(channelId),
    queryFn: async (): Promise<{
      channel: ChatChannelInfo;
      members: ChatMemberInfo[];
    }> => {
      const [ch, mem] = await Promise.all([
        loose(supabase)
          .from("chat_channels")
          .select("*")
          .eq("id", channelId as string)
          .single(),
        loose(supabase)
          .from("chat_channel_members")
          .select(
            "id,user_id,user:users!chat_channel_members_user_fk(id,name,avatar_url,email)",
          )
          .eq("channel_id", channelId as string),
      ]);
      if (ch.error) throw ch.error;
      if (mem.error) throw mem.error;
      return {
        channel: ch.data as ChatChannelInfo,
        members: (mem.data ?? []) as unknown as ChatMemberInfo[],
      };
    },
  });
}

const MESSAGE_PAGE = 60;

const MESSAGE_SELECT =
  "*, author:users!chat_messages_user_fk(id,name,avatar_url)";

/** Raw top-level row with PostgREST's embedded reply-count aggregate. */
type TopLevelRow = Omit<ChatMessage, "reply_count"> & {
  replies?: { count: number }[];
};

/**
 * A conversation's TOP-LEVEL messages (thread replies live in the thread view),
 * flattened oldest → newest. Paged newest-first, 60 at a time; `fetchOlder`
 * loads the next-older page by created_at cursor.
 */
export function useChatMessages(channelId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  const query = useInfiniteQuery({
    queryKey: messagesKey(channelId),
    enabled: Boolean(channelId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<ChatMessage[]> => {
      let q = loose(supabase)
        .from("chat_messages")
        // Self-referencing embed: hint by COLUMN name (PostgREST rejects the
        // constraint-name form for this relationship).
        .select(`${MESSAGE_SELECT}, replies:chat_messages!parent_id(count)`)
        .eq("channel_id", channelId as string)
        .is("parent_id", null)
        .order("created_at", { ascending: false })
        // Secondary order keeps ties deterministic before the reversal.
        .order("id", { ascending: false })
        .limit(MESSAGE_PAGE);
      // lte, not lt: messages sharing the cursor's timestamp must not fall
      // through the gap. The refetched boundary row is deduped on flatten.
      if (pageParam) q = q.lte("created_at", pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as unknown as TopLevelRow[]).map(
        ({ replies, ...m }) => ({ ...m, reply_count: replies?.[0]?.count ?? 0 }),
      );
    },
    // Pages run newest → older; the cursor is the oldest loaded created_at.
    getNextPageParam: (lastPage) =>
      lastPage.length < MESSAGE_PAGE
        ? undefined
        : lastPage[lastPage.length - 1]?.created_at,
  });

  const data = useMemo(() => {
    if (!query.data) return undefined;
    // Oldest → newest; the .lte() cursor refetches the boundary row, so dedupe
    // by id while preserving ascending order.
    const byId = new Map<string, ChatMessage>();
    for (const m of [...query.data.pages.flat()].reverse()) {
      if (!byId.has(m.id)) byId.set(m.id, m);
    }
    return [...byId.values()];
  }, [query.data]);

  return {
    data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    hasOlder: Boolean(query.hasNextPage),
    isFetchingOlder: query.isFetchingNextPage,
    fetchOlder: query.fetchNextPage,
  };
}

/** All replies of a thread, oldest → newest, with the same author join. */
export function useThreadMessages(rootId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: threadKey(rootId),
    enabled: Boolean(rootId),
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await loose(supabase)
        .from("chat_messages")
        .select(MESSAGE_SELECT)
        .eq("parent_id", rootId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (
        (data ?? []) as unknown as Omit<ChatMessage, "reply_count">[]
      ).map((m) => ({ ...m, reply_count: 0 }));
    },
  });
}

/**
 * One message by id — deep links (`?thread=`) whose root sits in a page that
 * isn't loaded yet. Returns null when it doesn't exist or isn't visible.
 */
export function useFetchChatMessage() {
  const supabase = useMemo(() => createClient(), []);
  return useCallback(
    async (id: string): Promise<ChatMessage | null> => {
      const { data, error } = await loose(supabase)
        .from("chat_messages")
        .select(MESSAGE_SELECT)
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      const m = data as unknown as Omit<ChatMessage, "reply_count">;
      return { ...m, reply_count: 0 };
    },
    [supabase],
  );
}

/** Sends a message into a conversation (optionally into a thread). */
export function useSendMessage(channelId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (
      input:
        | string
        | { body: string; attachments?: ChatAttachment[]; parentId?: string },
    ): Promise<void> => {
      const { body, attachments, parentId } =
        typeof input === "string"
          ? { body: input, attachments: [], parentId: undefined }
          : input;
      const text = body.trim();
      const files = (attachments ?? []).slice(0, 10);
      // An image-only message is valid; an empty one is not.
      if (!text && files.length === 0) return;
      if (!user) throw new Error("Not authenticated");
      const { error } = await loose(supabase).from("chat_messages").insert({
        channel_id: channelId,
        user_id: user.id,
        body: text.slice(0, 4000),
        attachments: files,
        parent_id: parentId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey(channelId) });
      queryClient.invalidateQueries({ queryKey: ["chat-thread"] });
      queryClient.invalidateQueries({ queryKey: channelsKey(activeTeam?.id) });
    },
  });
}

/**
 * Marks a conversation read (upserts the caller's member row — which also
 * "joins" a public channel on first open, pinning it into the sidebar state).
 */
export function useMarkChannelRead() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (channelId: string): Promise<void> => {
      if (!user) return;
      const { error } = await loose(supabase)
        .from("chat_channel_members")
        .upsert(
          {
            channel_id: channelId,
            user_id: user.id,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: "channel_id,user_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelsKey(activeTeam?.id) });
    },
  });
}

/**
 * The viewer's last_read_at for a conversation AS OF OPENING it — captured
 * once per channelId and frozen, so the page's own mark-read upserts don't
 * move the "New messages" divider while the conversation is open.
 * `undefined` while loading; `null` when there's no membership row (never
 * opened → no divider).
 */
export function useInitialReadBoundary(
  channelId: string | undefined,
): string | null | undefined {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [state, setState] = useState<{
    channelId: string;
    boundary: string | null;
  } | null>(null);
  const capturedFor = state?.channelId;

  useEffect(() => {
    if (!channelId || !user || capturedFor === channelId) return;
    let cancelled = false;
    const run = async () => {
      const { data, error } = await loose(supabase)
        .from("chat_channel_members")
        .select("last_read_at")
        .eq("channel_id", channelId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { last_read_at: string | null } | null;
      // On error, record "no boundary" (no divider) instead of blocking the
      // page's mark-read forever.
      setState({
        channelId,
        boundary: error ? null : (row?.last_read_at ?? null),
      });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase, channelId, user, capturedFor]);

  return state && state.channelId === channelId ? state.boundary : undefined;
}

/**
 * "Mark unread": rewinds the caller's read cursor to just before a message,
 * so it (and everything after) counts as unread again. Same upsert shape as
 * useMarkChannelRead — the sidebar badge follows via the own-row realtime
 * event.
 */
export function useMarkUnread() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      channelId: string;
      /** created_at of the message that should become the first unread one. */
      messageCreatedAt: string;
    }): Promise<void> => {
      if (!user) return;
      const boundary = new Date(
        new Date(input.messageCreatedAt).getTime() - 1,
      ).toISOString();
      const { error } = await loose(supabase)
        .from("chat_channel_members")
        .upsert(
          {
            channel_id: input.channelId,
            user_id: user.id,
            last_read_at: boundary,
          },
          { onConflict: "channel_id,user_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelsKey(activeTeam?.id) });
    },
  });
}

/**
 * Mute / unmute one conversation for the caller. Muted members keep reading;
 * the server-side notify trigger just skips them. Upsert (not update): muting
 * a public channel you never opened also "joins" it, like mark-read does.
 */
export function useToggleMute() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      channelId: string;
      mute: boolean;
    }): Promise<void> => {
      if (!user) return;
      const { error } = await loose(supabase)
        .from("chat_channel_members")
        .upsert(
          {
            channel_id: input.channelId,
            user_id: user.id,
            muted_at: input.mute ? new Date().toISOString() : null,
          },
          { onConflict: "channel_id,user_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelsKey(activeTeam?.id) });
    },
  });
}

/**
 * Renames a channel / edits its topic — direct UPDATE; RLS restricts it to
 * the creator or a team admin.
 */
export function useUpdateChannel(channelId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();

  return useMutation({
    mutationFn: async (patch: {
      name?: string;
      topic?: string | null;
    }): Promise<void> => {
      if (!channelId) throw new Error("No channel");
      const { error } = await loose(supabase)
        .from("chat_channels")
        .update(patch)
        .eq("id", channelId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-channel", channelId] });
      queryClient.invalidateQueries({ queryKey: channelsKey(activeTeam?.id) });
    },
  });
}

/** Archive / unarchive a named channel (team admin or creator; RPC enforces). */
export function useSetChannelArchived() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();

  return useMutation({
    mutationFn: async (input: {
      channelId: string;
      archived: boolean;
    }): Promise<void> => {
      const { error } = await loose(supabase).rpc("set_channel_archived", {
        p_channel_id: input.channelId,
        p_archived: input.archived,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["chat-channel", variables.channelId],
      });
      queryClient.invalidateQueries({ queryKey: channelsKey(activeTeam?.id) });
    },
  });
}

/** Deletes a channel and all its messages — creator or team admin (RLS). */
export function useDeleteChannel() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();

  return useMutation({
    mutationFn: async (channelId: string): Promise<void> => {
      const { error } = await loose(supabase)
        .from("chat_channels")
        .delete()
        .eq("id", channelId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: channelsKey(activeTeam?.id) });
    },
  });
}

/**
 * Live updates over ONE subscription: message inserts/edits/deletes refresh the
 * open conversation, its threads and the sidebar; reaction changes refresh the
 * reaction pills; channel/membership changes refresh the sidebar. Unique topic
 * per hook instance — same rationale as useNotificationsRealtime.
 */
export function useChatRealtime(channelId?: string) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  const { user } = useAuth();
  const userId = user?.id;
  const topicRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    if (!teamId) return;

    let channel = supabase
      .channel(`chat:${teamId}:${channelId ?? "all"}:${topicRef.current}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          ...(channelId ? { filter: `channel_id=eq.${channelId}` } : {}),
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as {
            channel_id?: string;
          } | null;
          if (row?.channel_id) {
            queryClient.invalidateQueries({
              queryKey: messagesKey(row.channel_id),
            });
          } else {
            // DELETE payloads only carry the PK — refresh every loaded list.
            queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
          }
          queryClient.invalidateQueries({ queryKey: ["chat-thread"] });
          queryClient.invalidateQueries({ queryKey: ["chat-pinned"] });
          queryClient.invalidateQueries({ queryKey: channelsKey(teamId) });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_message_reactions" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["chat-reactions"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_channels" },
        () => {
          queryClient.invalidateQueries({ queryKey: channelsKey(teamId) });
          queryClient.invalidateQueries({ queryKey: ["chat-channel"] });
        },
      );
    // Read-state rows churn on every member's mark-read; only the viewer's own
    // row matters here, so filter server-side (and wait until the id is known).
    if (userId) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_channel_members",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: channelsKey(teamId) });
          queryClient.invalidateQueries({ queryKey: ["chat-channel"] });
        },
      );
    }
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, queryClient, teamId, channelId, userId]);
}

/* -------------------------------------------------------------------------- */
/* Reactions + message editing                                                */
/* -------------------------------------------------------------------------- */

export interface ChatReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  user: { id: string; name: string } | null;
}

const reactionsKey = (channelId: string | undefined) =>
  ["chat-reactions", channelId] as const;

/**
 * Every reaction in the channel, grouped by message id. One per-channel query
 * (inner-join filter on the parent message) instead of an ids-based `.in()`:
 * no unbounded URL, no cache re-keying as pages load, and pills on older
 * pages don't vanish while a new key refetches.
 */
export function useChatReactions(channelId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: reactionsKey(channelId),
    enabled: Boolean(channelId),
    queryFn: async (): Promise<Map<string, ChatReaction[]>> => {
      const { data, error } = await loose(supabase)
        .from("chat_message_reactions")
        .select(
          "id, message_id, user_id, emoji, user:users!chat_message_reactions_user_fk(id,name), message:chat_messages!inner(channel_id)",
        )
        .eq("message.channel_id", channelId as string);
      if (error) throw error;
      const byMessage = new Map<string, ChatReaction[]>();
      for (const r of (data ?? []) as unknown as ChatReaction[]) {
        const arr = byMessage.get(r.message_id) ?? [];
        arr.push(r);
        byMessage.set(r.message_id, arr);
      }
      return byMessage;
    },
  });
}

/** Adds or removes the caller's reaction — the same emoji twice toggles off. */
export function useToggleReaction(channelId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      messageId: string;
      emoji: string;
      /** The caller's existing reaction row for this emoji, when there is one. */
      existingId?: string;
    }): Promise<void> => {
      if (!user) throw new Error("Not authenticated");
      if (input.existingId) {
        const { error } = await loose(supabase)
          .from("chat_message_reactions")
          .delete()
          .eq("id", input.existingId);
        if (error) throw error;
        return;
      }
      const { error } = await loose(supabase)
        .from("chat_message_reactions")
        .insert({
          message_id: input.messageId,
          user_id: user.id,
          emoji: input.emoji,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reactionsKey(channelId) });
    },
  });
}

/** Edits the caller's own message (RLS enforces authorship). */
export function useEditMessage(channelId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; body: string }): Promise<void> => {
      const body = input.body.trim();
      if (!body) throw new Error("A message can't be empty.");
      // edited_at is stamped by a server trigger when the body changes.
      const { error } = await loose(supabase)
        .from("chat_messages")
        .update({ body: body.slice(0, 4000) })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey(channelId) });
      queryClient.invalidateQueries({ queryKey: ["chat-thread"] });
    },
  });
}

/** Deletes a message (own message, or any as a workspace admin — per RLS). */
export function useDeleteMessage(channelId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await loose(supabase)
        .from("chat_messages")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey(channelId) });
      queryClient.invalidateQueries({ queryKey: ["chat-thread"] });
      queryClient.invalidateQueries({ queryKey: channelsKey(activeTeam?.id) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Pins, saved items, search                                                  */
/* -------------------------------------------------------------------------- */

/** The conversation's pinned messages, most recently pinned first. */
export function usePinnedMessages(channelId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: pinnedKey(channelId),
    enabled: Boolean(channelId),
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await loose(supabase)
        .from("chat_messages")
        .select(MESSAGE_SELECT)
        .eq("channel_id", channelId as string)
        .not("pinned_at", "is", null)
        .order("pinned_at", { ascending: false });
      if (error) throw error;
      return (
        (data ?? []) as unknown as Omit<ChatMessage, "reply_count">[]
      ).map((m) => ({ ...m, reply_count: 0 }));
    },
  });
}

/** Pin/unpin any message in a conversation you can access (RPC enforces). */
export function useTogglePin() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      messageId: string;
      pinned: boolean;
    }): Promise<void> => {
      const { error } = await loose(supabase).rpc("set_message_pinned", {
        p_message_id: input.messageId,
        p_pinned: input.pinned,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
      queryClient.invalidateQueries({ queryKey: ["chat-pinned"] });
    },
  });
}

export interface SavedChatMessage {
  id: string;
  message_id: string;
  /** When the caller saved it (the list's sort key). */
  created_at: string;
  message: ChatMessage | null;
}

/** The caller's saved (bookmarked) messages, newest saved first. */
export function useSavedMessages() {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();

  return useQuery({
    queryKey: savedKey(user?.id),
    enabled: Boolean(user),
    queryFn: async (): Promise<SavedChatMessage[]> => {
      const { data, error } = await loose(supabase)
        .from("chat_saved_messages")
        .select(
          `id, message_id, created_at, message:chat_messages!chat_saved_messages_message_fk(${MESSAGE_SELECT})`,
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      type Row = Omit<SavedChatMessage, "message"> & {
        message: Omit<ChatMessage, "reply_count"> | null;
      };
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        ...r,
        message: r.message ? { ...r.message, reply_count: 0 } : null,
      }));
    },
  });
}

/** Bookmark / unbookmark a message for the caller ("Saved items"). */
export function useToggleSaved() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      messageId: string;
      save: boolean;
    }): Promise<void> => {
      if (!user) throw new Error("Not authenticated");
      if (input.save) {
        // ignoreDuplicates keeps this INSERT-only (no UPDATE grant needed).
        const { error } = await loose(supabase)
          .from("chat_saved_messages")
          .upsert(
            { user_id: user.id, message_id: input.messageId },
            { onConflict: "user_id,message_id", ignoreDuplicates: true },
          );
        if (error) throw error;
        return;
      }
      const { error } = await loose(supabase)
        .from("chat_saved_messages")
        .delete()
        .eq("user_id", user.id)
        .eq("message_id", input.messageId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: savedKey(user?.id) });
    },
  });
}

/** One row of the search_chat_messages RPC result. */
export interface ChatSearchResult {
  message_id: string;
  channel_id: string;
  channel_kind: "channel" | "dm" | "group";
  channel_name: string | null;
  parent_id: string | null;
  body: string;
  created_at: string;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
}

/** Full-text-ish search over every conversation the caller can access. */
export function useSearchChatMessages(query: string) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  const q = query.trim();

  return useQuery({
    queryKey: ["chat-search", teamId, q] as const,
    enabled: Boolean(teamId) && q.length >= 2,
    // Keep the previous results on screen while the next query runs.
    placeholderData: (prev: ChatSearchResult[] | undefined) => prev,
    queryFn: async (): Promise<ChatSearchResult[]> => {
      const { data, error } = await loose(supabase).rpc(
        "search_chat_messages",
        { p_team_id: teamId, p_query: q, p_limit: 30 },
      );
      if (error) throw error;
      return (data ?? []) as ChatSearchResult[];
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Typing indicator + online presence (Realtime broadcast / presence)         */
/* -------------------------------------------------------------------------- */

const TYPING_THROTTLE_MS = 3000;
const TYPING_EXPIRE_MS = 5000;

/**
 * Who's typing in a conversation, over a Realtime BROADCAST channel.
 * `notifyTyping()` is throttled to one event per 3s; received entries expire
 * 5s after their last event.
 */
export function useTypingChannel(channelId: string | undefined, myName: string) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const uid = user?.id;

  const [typers, setTypers] = useState<{ id: string; name: string }[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef(0);
  const expiryTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const nameRef = useRef(myName);
  useEffect(() => {
    nameRef.current = myName;
  }, [myName]);

  useEffect(() => {
    if (!channelId || !uid) return;
    const timers = expiryTimersRef.current;
    // Broadcast topics must MATCH across clients — keep it shared, no suffix.
    const topic = `typing:${channelId}`;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    const attach = async () => {
      // realtime-js reuses channels by topic, so a quick unmount/remount can
      // grab the previous instance mid-teardown and never receive anything.
      // Wait out any dying instance before creating ours.
      const existing = supabase
        .getChannels()
        .find(
          (c) =>
            (c.topic === topic || c.topic === `realtime:${topic}`) &&
            (c.state as string) !== "closed",
        );
      if (existing) await supabase.removeChannel(existing);
      if (cancelled) return;

      channel = supabase
        .channel(topic, { config: { broadcast: { self: false } } })
        .on("broadcast", { event: "typing" }, (msg) => {
          const p = (
            msg as {
              payload?: { user_id?: string; name?: string; stop?: boolean };
            }
          ).payload;
          if (!p?.user_id || p.user_id === uid) return;
          const id = p.user_id;
          if (p.stop) {
            const pending = timers.get(id);
            if (pending) clearTimeout(pending);
            timers.delete(id);
            setTypers((prev) => prev.filter((t) => t.id !== id));
            return;
          }
          const name = p.name ?? "Someone";
          setTypers((prev) => [...prev.filter((t) => t.id !== id), { id, name }]);
          const existingTimer = timers.get(id);
          if (existingTimer) clearTimeout(existingTimer);
          timers.set(
            id,
            setTimeout(() => {
              timers.delete(id);
              setTypers((prev) => prev.filter((t) => t.id !== id));
            }, TYPING_EXPIRE_MS),
          );
        })
        .subscribe();
      channelRef.current = channel;
    };
    void attach();

    return () => {
      cancelled = true;
      channelRef.current = null;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      setTypers([]);
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase, channelId, uid]);

  const notifyTyping = useCallback(
    (opts?: { stop?: boolean }) => {
      const channel = channelRef.current;
      if (!channel || !uid) return;
      if (opts?.stop) {
        // Sent on submit: clears the receivers' "is typing…" immediately and
        // resets the throttle so the next keystroke broadcasts right away.
        lastSentRef.current = 0;
        void channel.send({
          type: "broadcast",
          event: "typing",
          payload: { user_id: uid, name: nameRef.current, stop: true },
        });
        return;
      }
      const now = Date.now();
      if (now - lastSentRef.current < TYPING_THROTTLE_MS) return;
      lastSentRef.current = now;
      void channel.send({
        type: "broadcast",
        event: "typing",
        payload: { user_id: uid, name: nameRef.current },
      });
    },
    [uid],
  );

  return { notifyTyping, typers };
}

type PresenceListener = (online: Set<string>) => void;
interface PresenceEntry {
  channel: RealtimeChannel;
  listeners: Set<PresenceListener>;
  refs: number;
}

/**
 * One shared presence channel per team, SESSION-PERSISTENT across hook
 * instances. realtime-js reuses channels by topic (and presence rooms must
 * share one topic across ALL users), so removing the channel when the last
 * hook unmounts lets a quick remount grab the mid-teardown instance and go
 * permanently dead. "Online = app open" is the desired semantic anyway, so
 * the channel simply lives for the tab's lifetime.
 */
const presenceEntries = new Map<string, PresenceEntry>();

/** Ids of teammates currently online, from team-wide Realtime presence. */
export function useOnlinePresence(): Set<string> {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  const { user } = useAuth();
  const uid = user?.id;

  const [online, setOnline] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    // No-op (empty set) until we know who and where we are.
    if (!teamId || !uid) return;
    const key = `${teamId}:${uid}`;
    let entry = presenceEntries.get(key);
    if (!entry) {
      const channel = supabase.channel(`presence:online:${teamId}`, {
        config: { presence: { key: uid } },
      });
      const created: PresenceEntry = { channel, listeners: new Set(), refs: 0 };
      const emit = () => {
        const ids = new Set(Object.keys(channel.presenceState()));
        created.listeners.forEach((l) => l(ids));
      };
      channel
        .on("presence", { event: "sync" }, emit)
        .on("presence", { event: "join" }, emit)
        .on("presence", { event: "leave" }, emit)
        .subscribe((status) => {
          if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
            void channel.track({});
          }
        });
      presenceEntries.set(key, created);
      entry = created;
    }
    const e = entry;
    e.refs += 1;
    const listener: PresenceListener = (ids) => setOnline(ids);
    e.listeners.add(listener);
    // Deferred seed: attaching to an already-synced channel gets no upcoming
    // presence event, so deliver the current state on the next tick.
    const seed = window.setTimeout(() => {
      listener(new Set(Object.keys(e.channel.presenceState())));
    }, 0);
    return () => {
      window.clearTimeout(seed);
      e.listeners.delete(listener);
      e.refs -= 1;
      // Never removeChannel / delete the entry: the channel is
      // session-persistent (see the note on presenceEntries above).
    };
  }, [supabase, teamId, uid]);

  return online;
}
