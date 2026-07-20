"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  kind: "channel" | "dm";
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
  attachments: ChatAttachment[];
  author: { id: string; name: string; avatar_url: string | null } | null;
}

export interface ChatChannelInfo {
  id: string;
  team_id: string;
  kind: "channel" | "dm";
  name: string | null;
  topic: string | null;
  is_private: boolean;
  created_by: string;
  created_at: string;
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

const MESSAGE_PAGE = 200;

/** The most recent messages of a conversation, oldest → newest. */
export function useChatMessages(channelId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: messagesKey(channelId),
    enabled: Boolean(channelId),
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await loose(supabase)
        .from("chat_messages")
        .select(
          "*, author:users!chat_messages_user_fk(id,name,avatar_url)",
        )
        .eq("channel_id", channelId as string)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_PAGE);
      if (error) throw error;
      return ((data ?? []) as unknown as ChatMessage[]).reverse();
    },
  });
}

/** Sends a message into a conversation. */
export function useSendMessage(channelId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (
      input: string | { body: string; attachments?: ChatAttachment[] },
    ): Promise<void> => {
      const { body, attachments } =
        typeof input === "string" ? { body: input, attachments: [] } : input;
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
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey(channelId) });
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
 * Live updates: Realtime INSERTs on chat_messages (RLS-scoped to what the
 * caller can see) refresh the open thread and the sidebar feed. Unique topic
 * per hook instance — same rationale as useNotificationsRealtime.
 */
export function useChatRealtime(channelId?: string) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  const topicRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    if (!teamId) return;

    const channel = supabase
      .channel(`chat:${teamId}:${channelId ?? "all"}:${topicRef.current}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          ...(channelId ? { filter: `channel_id=eq.${channelId}` } : {}),
        },
        (payload) => {
          const row = payload.new as { channel_id?: string };
          if (row.channel_id) {
            queryClient.invalidateQueries({
              queryKey: messagesKey(row.channel_id),
            });
          }
          queryClient.invalidateQueries({ queryKey: channelsKey(teamId) });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, queryClient, teamId, channelId]);
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

/** Every reaction on the channel's loaded messages, grouped by message id. */
export function useChatReactions(
  channelId: string | undefined,
  messageIds: string[],
) {
  const supabase = useMemo(() => createClient(), []);
  // Key on the channel, not the id list: the list changes as messages stream
  // in, and re-keying on it would throw the cache away on every new message.
  const ids = messageIds.join(",");

  return useQuery({
    queryKey: [...reactionsKey(channelId), ids.length] as const,
    enabled: Boolean(channelId) && messageIds.length > 0,
    queryFn: async (): Promise<Map<string, ChatReaction[]>> => {
      const { data, error } = await loose(supabase)
        .from("chat_message_reactions")
        .select("id, message_id, user_id, emoji, user:users!chat_message_reactions_user_fk(id,name)")
        .in("message_id", messageIds);
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
      const { error } = await loose(supabase)
        .from("chat_messages")
        .update({ body: body.slice(0, 4000), edited_at: new Date().toISOString() })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messagesKey(channelId) });
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
      queryClient.invalidateQueries({ queryKey: channelsKey(activeTeam?.id) });
    },
  });
}
