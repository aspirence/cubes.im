"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  App as AntdApp,
  Avatar,
  Badge,
  Button,
  Drawer,
  Dropdown,
  Input,
  Modal,
  Popover,
  Select,
  Skeleton,
  Tooltip,
  theme,
} from "antd";
import dayjs from "dayjs";
import { useAuth } from "@/features/auth/use-auth";
import {
  useChatChannel,
  useChatMessages,
  useChatRealtime,
  useMarkChannelRead,
  useSendMessage,
  useAddChannelMembers,
  useRemoveChannelMember,
  useThreadMessages,
  usePinnedMessages,
  useTogglePin,
  useSavedMessages,
  useToggleSaved,
  useTypingChannel,
  useOnlinePresence,
  useFetchChatMessage,
  useInitialReadBoundary,
  useMarkUnread,
  useUpdateChannel,
  useSetChannelArchived,
  useDeleteChannel,
  type ChatMessage,
} from "@/features/chat/use-chat";
import { useChatDraftsStore, threadDraftKey } from "@/store/chat-drafts-store";
import {
  useTeamMembers,
  useIsTeamAdmin,
} from "@/features/team-members/use-team-members";
import {
  TeamMentionInput,
  type MentionEntity,
  type MentionMember,
} from "@/features/team-members/team-mention-input";
import { useNotifyMentions } from "@/features/notifications/use-mention-notify";
import { useTeams, useActiveTeam } from "@/features/teams/use-teams";
import { useAllTeamTasks } from "@/features/tasks/use-all-tasks";
import { useProjects } from "@/features/projects/use-projects";
import { useUploadChatFile } from "@/features/storage/use-storage";
import {
  ChatMessageText,
  MessageAttachments,
  MessageLinkPreview,
  PendingAttachmentStrip,
} from "@/features/chat/message-content";
import type { ChatAttachment } from "@/features/chat/use-chat";
import {
  useChatReactions,
  useToggleReaction,
  useEditMessage,
  useDeleteMessage,
} from "@/features/chat/use-chat";
import {
  MessageHoverActions,
  MessageReactions,
  ComposerEmojiButton,
} from "@/features/chat/message-actions";
import { errMsg } from "@/lib/err";

// The page is server-prerendered, so pick the SSR-safe variant.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const ONLINE_GREEN = "#22c55e";

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1, color }}
    >
      {name}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Group consecutive same-author messages within 5 minutes. */
function isGrouped(prev: ChatMessage | undefined, m: ChatMessage): boolean {
  return Boolean(
    prev &&
      prev.user_id === m.user_id &&
      dayjs(m.created_at).diff(dayjs(prev.created_at), "minute") < 5 &&
      dayjs(m.created_at).isSame(prev.created_at, "day"),
  );
}

/** ≥ 992px (antd lg) — thread panel docks beside the list; below, it's a Drawer. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 992px)");
    const on = () => setIsDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return isDesktop;
}

export default function ChatThreadPage() {
  // useSearchParams needs a Suspense boundary for the server prerender (same
  // pattern as apps/page.tsx).
  return (
    <Suspense fallback={null}>
      <ChatThreadPageInner />
    </Suspense>
  );
}

function ChatThreadPageInner() {
  const { token } = theme.useToken();
  const params = useParams<{ id: string }>();
  const channelId = params.id;
  const router = useRouter();
  const { message, modal } = AntdApp.useApp();
  const { user } = useAuth();

  const { data: info, isLoading: infoLoading } = useChatChannel(channelId);
  const {
    data: messages,
    isLoading: msgsLoading,
    isError: msgsIsError,
    error: msgsError,
    refetch: refetchMessages,
    hasOlder,
    isFetchingOlder,
    fetchOlder,
  } = useChatMessages(channelId);
  const send = useSendMessage(channelId);
  const markRead = useMarkChannelRead();
  useChatRealtime(channelId);
  const isDesktop = useIsDesktop();
  const online = useOnlinePresence();

  // Per-conversation persisted draft (Slack behavior): the composer reads and
  // writes the store directly, so switching channels or reloading keeps text.
  const draft = useChatDraftsStore((s) => s.drafts[channelId] ?? "");
  const setStoreDraft = useChatDraftsStore((s) => s.setDraft);
  // Same call surface as useState (value or updater), so the composer,
  // insertEmoji and submit below stay unchanged.
  const setDraft = useCallback(
    (v: string | ((d: string) => string)) => {
      const prev = useChatDraftsStore.getState().drafts[channelId] ?? "";
      setStoreDraft(channelId, typeof v === "function" ? v(prev) : v);
    },
    [channelId, setStoreDraft],
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Whether the user is parked at the bottom — gates the follow-on auto-scroll
  // so we never yank them down while they're reading older messages.
  const stickRef = useRef(true);
  // "Mark unread" suppression: while set, the auto-mark-read effect stands
  // down so the unread badge survives. Cleared on channel switch, on send,
  // or when the user scrolls back to the bottom.
  const skipAutoReadRef = useRef(false);
  useEffect(() => {
    skipAutoReadRef.current = false;
  }, [channelId]);
  // Set right before every programmatic scrollTop assignment (auto-pin,
  // anchor restore). The scroll handler swallows that one event so it never
  // reads as user intent — a re-pin must not end a "mark unread".
  const programmaticScrollRef = useRef(false);
  // scrollHeight - scrollTop captured just before an older page is fetched, so
  // the viewport can be re-anchored after the prepend.
  const scrollRestoreRef = useRef<number | null>(null);
  const onMessagesScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      return;
    }
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    // Scrolling back to the bottom ends a "mark unread" and reads the channel.
    if (stickRef.current && skipAutoReadRef.current) {
      skipAutoReadRef.current = false;
      if (channelId) markRead.mutate(channelId);
    }
    if (
      el.scrollTop < 80 &&
      hasOlder &&
      !isFetchingOlder &&
      scrollRestoreRef.current === null
    ) {
      scrollRestoreRef.current = el.scrollHeight - el.scrollTop;
      void fetchOlder().finally(() => {
        // If the prepend never landed (fetch error), drop the stale anchor so
        // it can't fire on a later unrelated update.
        window.setTimeout(() => {
          scrollRestoreRef.current = null;
        }, 400);
      });
    }
  };

  // Re-anchor the viewport right after older messages are prepended.
  useIsomorphicLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && scrollRestoreRef.current !== null) {
      programmaticScrollRef.current = true;
      el.scrollTop = el.scrollHeight - scrollRestoreRef.current;
      scrollRestoreRef.current = null;
    }
  }, [messages?.length]);

  // The viewer's read cursor AS OF OPENING the channel — frozen before the
  // mark-read below moves it. Anchors the "New messages" divider.
  const readBoundary = useInitialReadBoundary(channelId);
  // When this channel was opened — messages arriving AFTER that (live, while
  // the user is watching) must never plant the divider mid-conversation.
  // State, not a ref (the divider memo reads it during render); re-captured
  // on channel switch via the render-time reset idiom (as threadSel below).
  const [opened, setOpened] = useState(() => ({
    channelId,
    at: new Date().toISOString(),
  }));
  if (opened.channelId !== channelId) {
    setOpened({ channelId, at: new Date().toISOString() });
  }
  const firstNewId = useMemo(() => {
    // Never-opened channels (null boundary) show no divider: the first open
    // of a public channel shouldn't flag its entire history as new.
    if (!readBoundary || !messages || !user) return null;
    const cutoff = new Date(readBoundary).getTime();
    const openedAt = new Date(opened.at).getTime();
    return (
      messages.find((m) => {
        const at = new Date(m.created_at).getTime();
        return m.user_id !== user.id && at > cutoff && at <= openedAt;
      })?.id ?? null
    );
  }, [readBoundary, messages, user, opened.at]);

  // Mark read on open and whenever new messages arrive while the thread is
  // open. Waits until useInitialReadBoundary captured the pre-open cursor
  // (this upsert would move it), and stands down after "Mark unread".
  const lastCount = useRef(0);
  useEffect(() => {
    const count = messages?.length ?? 0;
    if (channelId && readBoundary !== undefined && count !== lastCount.current) {
      lastCount.current = count;
      if (!skipAutoReadRef.current) markRead.mutate(channelId);
    }
    // markRead is a stable mutation object from useMutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, messages?.length, readBoundary]);

  // Opening a thread starts pinned to the newest message.
  useEffect(() => {
    stickRef.current = true;
    const id = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        programmaticScrollRef.current = true;
        el.scrollTop = el.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [channelId]);

  // Follow new messages when already parked at the bottom.
  useEffect(() => {
    if (!stickRef.current) return;
    const id = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        programmaticScrollRef.current = true;
        el.scrollTop = el.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [messages?.length]);

  // Re-pin when the content grows AFTER layout — images finishing loading are
  // the usual reason a chat "won't scroll all the way to the bottom".
  const hasMessages = (messages?.length ?? 0) > 0;
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const el = scrollRef.current;
      if (el && stickRef.current) {
        programmaticScrollRef.current = true;
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [channelId, hasMessages]);

  const channel = info?.channel;
  const members = useMemo(() => info?.members ?? [], [info?.members]);
  const partner = useMemo(
    () => members.find((m) => m.user_id !== user?.id)?.user ?? null,
    [members, user?.id],
  );

  // Channel/group membership management (team admin or the creator). Group
  // members can also leave on their own (self-remove below), except the
  // creator; the add/remove RPCs enforce the same rules server-side.
  const isTeamAdmin = useIsTeamAdmin();
  const { data: teamMembers } = useTeamMembers();
  const addMembers = useAddChannelMembers(channelId);
  const removeMember = useRemoveChannelMember(channelId);
  const canManageMembers =
    (channel?.kind === "channel" || channel?.kind === "group") &&
    (isTeamAdmin || channel?.created_by === user?.id);
  const [addPick, setAddPick] = useState<string[]>([]);
  const memberUserIds = useMemo(
    () => new Set(members.map((m) => m.user_id)),
    [members],
  );
  const addableOptions = useMemo(
    () =>
      (teamMembers ?? [])
        .filter((m) => m.user && !memberUserIds.has(m.user.id))
        .map((m) => ({ value: m.user!.id, label: m.user!.name })),
    [teamMembers, memberUserIds],
  );
  const handleAddMembers = async () => {
    if (!addPick.length) return;
    try {
      const n = await addMembers.mutateAsync(addPick);
      setAddPick([]);
      message.success(n === 1 ? "Added 1 person." : `Added ${n} people.`);
    } catch (err) {
      message.error(errMsg(err, "Couldn't add people."));
    }
  };
  const handleRemoveMember = async (userId: string) => {
    try {
      await removeMember.mutateAsync(userId);
    } catch (err) {
      message.error(errMsg(err, "Couldn't remove."));
    }
  };
  const groupNames = useMemo(
    () =>
      members
        .filter((m) => m.user_id !== user?.id)
        .map((m) => m.user?.name ?? "Member"),
    [members, user?.id],
  );
  const title =
    channel?.kind === "dm"
      ? (partner?.name ?? "Direct message")
      : channel?.kind === "group"
        ? (groupNames.join(", ") || "Group")
        : (channel?.name ?? "Channel");

  // Channel management (rename / topic / archive / delete) — named channels
  // only, for team admins or the creator. Archived channels go read-only.
  const canManageChannel =
    channel?.kind === "channel" &&
    (isTeamAdmin || channel?.created_by === user?.id);
  const archived = Boolean(channel?.archived_at);
  const updateChannel = useUpdateChannel(channelId);
  const setChannelArchived = useSetChannelArchived();
  const deleteChannel = useDeleteChannel();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [topicOpen, setTopicOpen] = useState(false);
  const [topicVal, setTopicVal] = useState("");
  const onChannelMenu = ({ key }: { key: string }) => {
    if (key === "rename") {
      setRenameVal(channel?.name ?? "");
      setRenameOpen(true);
    } else if (key === "topic") {
      setTopicVal(channel?.topic ?? "");
      setTopicOpen(true);
    } else if (key === "archive") {
      const next = !archived;
      modal.confirm({
        title: next ? "Archive this channel?" : "Unarchive this channel?",
        content: next
          ? "It becomes read-only and disappears from the sidebar for people who haven't joined. You can unarchive it anytime."
          : "The channel reopens for new messages.",
        okText: next ? "Archive" : "Unarchive",
        onOk: () =>
          setChannelArchived
            .mutateAsync({ channelId, archived: next })
            .catch((err) =>
              message.error(errMsg(err, "Couldn't update the channel.")),
            ),
      });
    } else if (key === "delete") {
      modal.confirm({
        title: "Delete this channel?",
        content:
          "Every message in it disappears for everyone. This can't be undone.",
        okText: "Delete",
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await deleteChannel.mutateAsync(channelId);
            router.push("/chat");
          } catch (err) {
            message.error(errMsg(err, "Couldn't delete the channel."));
          }
        },
      });
    }
  };
  const commitRename = async () => {
    const name = renameVal.trim();
    if (!name) return;
    try {
      await updateChannel.mutateAsync({ name });
      setRenameOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Couldn't rename the channel."));
    }
  };
  const commitTopic = async () => {
    try {
      await updateChannel.mutateAsync({ topic: topicVal.trim() || null });
      setTopicOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Couldn't update the topic."));
    }
  };

  // "Mark unread" — rewind the read cursor to a message, then keep the page's
  // auto-mark-read from instantly undoing it (see skipAutoReadRef).
  const markUnread = useMarkUnread();
  const onMarkUnread = (m: ChatMessage) => {
    skipAutoReadRef.current = true;
    void markUnread
      .mutateAsync({ channelId, messageCreatedAt: m.created_at })
      .then(() => message.success("Marked unread"))
      .catch((err) => {
        skipAutoReadRef.current = false;
        message.error(errMsg(err, "Couldn't mark unread."));
      });
  };

  // Everything `@` can tag from the composer: people, teams, tasks, projects.
  const { data: allTeams } = useTeams();
  const { data: activeTeam } = useActiveTeam();
  const { data: teamTasks } = useAllTeamTasks();
  const { data: allProjects } = useProjects();
  const notifyMentions = useNotifyMentions();

  const mentionMembers = useMemo<MentionMember[]>(
    () =>
      (teamMembers ?? [])
        .filter((m) => m.user)
        .map((m) => ({
          id: m.user!.id,
          name: m.user!.name,
          avatarUrl: m.user!.avatar_url,
          email: m.user!.email,
        })),
    [teamMembers],
  );
  const mentionEntities = useMemo<MentionEntity[]>(
    () => [
      ...(allTeams ?? []).map((t) => ({
        id: t.id,
        label: t.name,
        kind: "team" as const,
        meta: "Team — notifies its members",
      })),
      ...(allProjects ?? []).map((pr) => ({
        id: pr.id,
        label: pr.name,
        kind: "project" as const,
      })),
      ...(teamTasks ?? [])
        .filter((t) => !t.done)
        .slice(0, 200)
        .map((t) => ({
          id: t.id,
          label: t.name,
          kind: "task" as const,
          meta: t.project?.name,
        })),
    ],
    [allTeams, allProjects, teamTasks],
  );
  const memberNames = useMemo(
    () => mentionMembers.map((m) => m.name),
    [mentionMembers],
  );

  const myName = useMemo(
    () => (teamMembers ?? []).find((m) => m.user?.id === user?.id)?.user?.name ?? "Someone",
    [teamMembers, user?.id],
  );

  const { notifyTyping, typers } = useTypingChannel(channelId, myName);
  const typingLabel = useMemo(() => {
    if (typers.length === 0) return null;
    const names = typers.map((t) => t.name);
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return `${names[0]}, ${names[1]} and others are typing…`;
  }, [typers]);

  // Threads: which root message's thread is open in the side panel / drawer.
  // Stored per conversation (a selection from another channel derives to
  // closed) and re-resolved against the loaded list so reply counts and edits
  // stay fresh without effect-driven state syncs. `external` marks roots that
  // were deep-linked in from an unloaded older page — they legitimately live
  // outside the loaded list.
  const [threadSel, setThreadSel] = useState<{
    channelId: string;
    root: ChatMessage;
    external?: boolean;
  } | null>(null);
  const openThreadRoot = useMemo(() => {
    if (!threadSel || threadSel.channelId !== channelId) return null;
    return messages?.find((m) => m.id === threadSel.root.id) ?? threadSel.root;
  }, [threadSel, channelId, messages]);
  const openThread = (m: ChatMessage) => setThreadSel({ channelId, root: m });
  const closeThread = () => setThreadSel(null);

  // A root deleted out from under its open panel closes it (render-time reset
  // idiom, as in apps/page.tsx). External roots are exempt — see above.
  if (
    threadSel &&
    threadSel.channelId === channelId &&
    !threadSel.external &&
    messages &&
    !messages.some((m) => m.id === threadSel.root.id)
  ) {
    setThreadSel(null);
  }

  // Deep links (?thread= / ?m=) from search results and saved items.
  const searchParams = useSearchParams();
  const deepThread = searchParams.get("thread");
  const deepMsg = searchParams.get("m");
  const fetchMessageById = useFetchChatMessage();

  // ?thread= — open that thread's panel once messages are up. The root may sit
  // in an unloaded older page; then it's fetched directly by id ("external").
  const threadLinkDone = useRef<string | null>(null);
  useEffect(() => {
    if (!deepThread || !channelId || !messages) return;
    const key = `${channelId}:${deepThread}`;
    if (threadLinkDone.current === key) return;
    threadLinkDone.current = key;
    let cancelled = false;
    const inList = messages.find((m) => m.id === deepThread);
    void (inList
      ? Promise.resolve({ root: inList, external: false })
      : fetchMessageById(deepThread).then((root) =>
          root && root.channel_id === channelId
            ? { root, external: true }
            : null,
        )
    ).then((hit) => {
      if (!cancelled && hit) {
        setThreadSel({ channelId, root: hit.root, external: hit.external });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [deepThread, channelId, messages, fetchMessageById]);

  // ?m= — scroll the message into view with a short highlight. Thread replies
  // live in the panel (opened above), so only top-level targets are hunted;
  // best effort: pull up to 5 older pages, then give up silently.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const msgHuntRef = useRef({ key: "", tries: 0, done: false });
  useEffect(() => {
    if (!deepMsg || deepThread || !channelId || !messages) return;
    const key = `${channelId}:${deepMsg}`;
    if (msgHuntRef.current.key !== key)
      msgHuntRef.current = { key, tries: 0, done: false };
    if (msgHuntRef.current.done) return;
    if (messages.some((m) => m.id === deepMsg)) {
      msgHuntRef.current.done = true;
      stickRef.current = false;
      requestAnimationFrame(() => {
        setHighlightId(deepMsg);
        document
          .getElementById(`chat-msg-${deepMsg}`)
          ?.scrollIntoView({ block: "center" });
      });
      window.setTimeout(() => setHighlightId(null), 2000);
      return;
    }
    if (hasOlder && !isFetchingOlder && msgHuntRef.current.tries < 5) {
      msgHuntRef.current.tries += 1;
      void fetchOlder();
    } else if (!hasOlder || msgHuntRef.current.tries >= 5) {
      msgHuntRef.current.done = true;
    }
  }, [deepMsg, deepThread, channelId, messages, hasOlder, isFetchingOlder, fetchOlder]);

  // Pins + saved items.
  const { data: pinned } = usePinnedMessages(channelId);
  const togglePin = useTogglePin();
  const { data: savedItems } = useSavedMessages();
  const savedIds = useMemo(
    () => new Set((savedItems ?? []).map((s) => s.message_id)),
    [savedItems],
  );
  const toggleSaved = useToggleSaved();

  const onTogglePin = (m: Pick<ChatMessage, "id" | "pinned_at">) =>
    togglePin
      .mutateAsync({ messageId: m.id, pinned: !m.pinned_at })
      .catch((err) => message.error(errMsg(err, "Couldn't update the pin.")));

  const onToggleSave = (id: string) =>
    toggleSaved
      .mutateAsync({ messageId: id, save: !savedIds.has(id) })
      .catch((err) => message.error(errMsg(err, "Couldn't update saved items.")));

  // Pending uploads live here until the message is sent.
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerBoxRef = useRef<HTMLDivElement | null>(null);
  const uploadFile = useUploadChatFile();
  const editMessage = useEditMessage(channelId);
  const deleteMessage = useDeleteMessage(channelId);
  const toggleReaction = useToggleReaction(channelId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const addFiles = async (files: File[]) => {
    const room = 10 - attachments.length;
    const batch = files.filter((f) => f.size > 0).slice(0, Math.max(0, room));
    if (batch.length === 0) return;
    if (files.length > batch.length)
      message.warning("Up to 10 files per message.");
    setUploading((n) => n + batch.length);
    await Promise.all(
      batch.map(async (file) => {
        try {
          const url = await uploadFile.mutateAsync(file);
          setAttachments((prev) => [
            ...prev,
            { url, name: file.name, type: file.type, size: file.size },
          ]);
        } catch (err) {
          message.error(errMsg(err, `Couldn't upload ${file.name}.`));
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      }),
    );
  };

  // Emoji land at the caret (the composer's underlying textarea), not the end.
  const insertEmoji = (emoji: string) => {
    const ta = composerBoxRef.current?.querySelector<HTMLTextAreaElement>("textarea");
    if (ta && typeof ta.selectionStart === "number") {
      const start = ta.selectionStart;
      const end = ta.selectionEnd ?? start;
      setDraft((d) => d.slice(0, start) + emoji + d.slice(end));
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + emoji.length;
        ta.setSelectionRange(pos, pos);
      });
    } else {
      setDraft((d) => (d ? `${d} ${emoji}` : emoji));
    }
  };

  const submit = () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || send.isPending || uploading > 0) return;
    // Sending clears the "is typing…" on the other side right away.
    notifyTyping({ stop: true });
    // Sending always jumps to the newest message, even if you'd scrolled up.
    stickRef.current = true;
    // Sending also ends a "mark unread" — the mark-read effect below resumes.
    skipAutoReadRef.current = false;
    const sentAttachments = attachments;
    setDraft("");
    setAttachments([]);
    send.mutate({ body: text, attachments: sentAttachments }, {
      onError: (err) => {
        setDraft(text);
        setAttachments(sentAttachments);
        message.error(errMsg(err, "Couldn't send the message."));
      },
      onSuccess: () => {
        // Fire-and-forget: mentioned people/teams get an inbox notification;
        // failures must never read as a failed send.
        void notifyMentions({
          text,
          members: mentionMembers,
          entities: mentionEntities,
          message: `${myName} mentioned you in ${
            channel?.kind === "dm"
              ? "a direct message"
              : channel?.kind === "group"
                ? "a group message"
                : `#${title}`
          }`,
          url: `/chat/${channelId}`,
          teamId: activeTeam?.id,
        });
      },
    });
  };

  const rows = messages ?? [];
  const { data: reactionsByMessage } = useChatReactions(channelId);

  const onToggleReaction = (messageId: string, emoji: string, existingId?: string) =>
    toggleReaction
      .mutateAsync({ messageId, emoji, existingId })
      .catch(() => message.error("Couldn't update the reaction."));

  const onDeleteMessage = (id: string) =>
    modal.confirm({
      title: "Delete this message?",
      content: "It disappears for everyone in the conversation.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: () =>
        deleteMessage
          .mutateAsync(id)
          .catch(() => message.error("Couldn't delete the message.")),
    });

  const commitEdit = async (id: string) => {
    const next = editDraft.trim();
    setEditingId(null);
    if (!next) return;
    try {
      await editMessage.mutateAsync({ id, body: next });
    } catch {
      message.error("Couldn't save the edit.");
    }
  };

  const pinnedList = pinned ?? [];
  const threadOpen = Boolean(openThreadRoot);

  return (
    <div
      className="wl-chat-thread"
      style={{
        display: "flex",
        flexDirection: "column",
        // Full-bleed Slack-style pane: fill the content area edge to edge.
        height: "calc(100vh - 58px)",
        background: token.colorBgContainer,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderBottom: `1px solid ${token.colorSplit}`,
          flex: "none",
        }}
      >
        {/* Mobile only: on desktop /chat bounces straight back into the latest
            conversation (the rail is the list), so a back arrow does nothing. */}
        <Tooltip title="All conversations">
          <Button
            className="wl-chat-back"
            type="text"
            size="small"
            aria-label="Back to conversations"
            icon={<MIcon name="arrow_back" size={17} color={token.colorTextSecondary} />}
            onClick={() => router.push("/chat")}
          />
        </Tooltip>
        {channel?.kind === "dm" ? (
          <span style={{ position: "relative", flex: "none", display: "inline-flex" }}>
            <Avatar size={30} src={partner?.avatar_url ?? undefined} style={{ fontSize: 12 }}>
              {initials(title)}
            </Avatar>
            {/* Presence: green = online right now, gray = away/offline. */}
            <span
              style={{
                position: "absolute",
                right: -1,
                bottom: -1,
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: `2px solid ${token.colorBgContainer}`,
                background:
                  partner && online.has(partner.id)
                    ? ONLINE_GREEN
                    : token.colorTextQuaternary,
              }}
            />
          </span>
        ) : (
          <span
            style={{
              width: 30,
              height: 30,
              flex: "none",
              borderRadius: 9,
              background: token.colorPrimaryBg,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MIcon
              name={
                channel?.kind === "group"
                  ? "group"
                  : channel?.is_private
                    ? "lock"
                    : "tag"
              }
              size={16}
              color="#4a4ad0"
            />
          </span>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 650,
              color: token.colorText,
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {infoLoading ? (
              <Skeleton.Input active size="small" style={{ width: 140, height: 16 }} />
            ) : (
              title
            )}
          </div>
          {channel?.topic ? (
            <div
              style={{
                fontSize: 12,
                color: token.colorTextTertiary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {channel.topic}
            </div>
          ) : null}
        </div>

        {/* Pinned messages */}
        <Popover
          trigger="click"
          placement="bottomRight"
          content={
            <div style={{ width: 300, maxHeight: 380, overflowY: "auto" }}>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: ".5px",
                  textTransform: "uppercase",
                  color: token.colorTextTertiary,
                  marginBottom: 6,
                }}
              >
                Pinned · {pinnedList.length}
              </div>
              {pinnedList.length === 0 ? (
                <div style={{ fontSize: 12.5, color: token.colorTextTertiary, padding: "4px 0" }}>
                  Nothing pinned yet — hover a message and hit the pin.
                </div>
              ) : (
                pinnedList.map((p) => (
                  <div
                    key={p.id}
                    style={{ display: "flex", gap: 8, padding: "6px 0", alignItems: "flex-start" }}
                  >
                    <Avatar size={22} src={p.author?.avatar_url ?? undefined} style={{ fontSize: 10, flex: "none" }}>
                      {initials(p.author?.name ?? "?")}
                    </Avatar>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 650, color: token.colorText }}>
                          {p.author?.name ?? "Member"}
                        </span>
                        <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>
                          {dayjs(p.created_at).format("MMM D")}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12.5,
                          color: token.colorTextSecondary,
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}
                      >
                        {p.body || "📎 Attachment"}
                      </div>
                    </div>
                    <Tooltip title="Unpin">
                      <Button
                        type="text"
                        size="small"
                        aria-label="Unpin message"
                        onClick={() => void onTogglePin(p)}
                        icon={<MIcon name="keep_off" size={15} color={token.colorTextTertiary} />}
                      />
                    </Tooltip>
                  </div>
                ))
              )}
            </div>
          }
        >
          <Badge
            count={pinnedList.length}
            size="small"
            offset={[-4, 4]}
            style={{ backgroundColor: "#4a4ad0", boxShadow: "none" }}
          >
            <Button
              type="text"
              size="small"
              aria-label="Pinned messages"
              icon={<MIcon name="keep" size={17} color={token.colorTextSecondary} />}
            />
          </Badge>
        </Popover>

        {channel && channel.kind !== "dm" ? (
          <Popover
            trigger="click"
            placement="bottomRight"
            content={
              <div style={{ width: 280, maxHeight: 380, overflowY: "auto" }}>
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    letterSpacing: ".5px",
                    textTransform: "uppercase",
                    color: token.colorTextTertiary,
                    marginBottom: 8,
                  }}
                >
                  Members · {members.length}
                </div>
                {members.map((m) => {
                  const isCreator = m.user_id === channel?.created_by;
                  const canRemove =
                    canManageMembers && !isCreator ? true : m.user_id === user?.id && !isCreator;
                  return (
                    <div
                      key={m.id}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}
                    >
                      <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
                        <Avatar size={22} src={m.user?.avatar_url ?? undefined} style={{ fontSize: 10 }}>
                          {initials(m.user?.name ?? "?")}
                        </Avatar>
                        <span
                          style={{
                            position: "absolute",
                            right: -1,
                            bottom: -1,
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            border: `2px solid ${token.colorBgElevated}`,
                            background: online.has(m.user_id)
                              ? ONLINE_GREEN
                              : token.colorTextQuaternary,
                          }}
                        />
                      </span>
                      <span style={{ fontSize: 13, color: token.colorText, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.user?.name ?? "Member"}
                        {isCreator ? (
                          <span style={{ fontSize: 11, color: token.colorTextTertiary }}> · owner</span>
                        ) : null}
                      </span>
                      {canRemove ? (
                        <Tooltip title={m.user_id === user?.id ? "Leave" : "Remove"}>
                          <Button
                            type="text"
                            size="small"
                            aria-label="Remove member"
                            loading={removeMember.isPending}
                            onClick={() => void handleRemoveMember(m.user_id)}
                            icon={<MIcon name="close" size={14} color={token.colorTextTertiary} />}
                          />
                        </Tooltip>
                      ) : null}
                    </div>
                  );
                })}

                {canManageMembers ? (
                  <div style={{ marginTop: 10, borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 10 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase", color: token.colorTextTertiary, marginBottom: 6 }}>
                      Add people
                    </div>
                    <Select
                      mode="multiple"
                      size="small"
                      style={{ width: "100%" }}
                      placeholder="Search teammates…"
                      optionFilterProp="label"
                      value={addPick}
                      onChange={setAddPick}
                      options={addableOptions}
                      maxTagCount="responsive"
                      notFoundContent="Everyone's already in"
                    />
                    <Button
                      type="primary"
                      size="small"
                      block
                      style={{ marginTop: 8 }}
                      disabled={!addPick.length}
                      loading={addMembers.isPending}
                      onClick={() => void handleAddMembers()}
                    >
                      Add {addPick.length ? `(${addPick.length})` : ""}
                    </Button>
                  </div>
                ) : channel?.kind === "group" ? (
                  <div style={{ fontSize: 11.5, color: token.colorTextQuaternary, marginTop: 8 }}>
                    Group message — only these people can see it.
                  </div>
                ) : channel?.is_private ? (
                  <div style={{ fontSize: 11.5, color: token.colorTextQuaternary, marginTop: 8 }}>
                    Private channel — only members can see it.
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: token.colorTextQuaternary, marginTop: 8 }}>
                    Anyone on the team can join by opening the channel.
                  </div>
                )}
              </div>
            }
          >
            <Button
              type="text"
              size="small"
              aria-label="Members"
              icon={<MIcon name="group" size={17} color={token.colorTextSecondary} />}
            />
          </Popover>
        ) : null}

        {/* Channel management — rename / topic / archive / delete. */}
        {canManageChannel ? (
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            menu={{
              items: [
                {
                  key: "rename",
                  label: "Rename channel",
                  icon: <MIcon name="edit" size={15} />,
                },
                {
                  key: "topic",
                  label: "Edit topic",
                  icon: <MIcon name="notes" size={15} />,
                },
                {
                  key: "archive",
                  label: archived ? "Unarchive channel" : "Archive channel",
                  icon: <MIcon name={archived ? "unarchive" : "archive"} size={15} />,
                },
                { type: "divider" },
                {
                  key: "delete",
                  danger: true,
                  label: "Delete channel",
                  icon: <MIcon name="delete" size={15} />,
                },
              ],
              onClick: onChannelMenu,
            }}
          >
            <Button
              type="text"
              size="small"
              aria-label="Channel settings"
              icon={<MIcon name="more_vert" size={17} color={token.colorTextSecondary} />}
            />
          </Dropdown>
        ) : null}
      </div>

      {/* Middle: message column + (desktop) docked thread panel */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* Messages */}
          <div
            ref={scrollRef}
            onScroll={onMessagesScroll}
            style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}
          >
            {isFetchingOlder ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "2px 0 8px" }}>
                <span className="material-symbols-rounded wl-spin" style={{ fontSize: 16, color: token.colorTextTertiary }}>
                  progress_activity
                </span>
              </div>
            ) : null}
            {msgsLoading ? (
              <Skeleton active paragraph={{ rows: 6 }} />
            ) : msgsIsError ? (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <MIcon name="error" size={28} color={token.colorTextQuaternary} />
                <div style={{ fontSize: 13.5, fontWeight: 650, color: token.colorText }}>
                  Couldn&apos;t load this conversation.
                </div>
                <div style={{ fontSize: 12.5, color: token.colorTextTertiary, textAlign: "center" }}>
                  {errMsg(msgsError, "Something went wrong.")}
                </div>
                <Button size="small" onClick={() => void refetchMessages()}>
                  Retry
                </Button>
              </div>
            ) : rows.length === 0 ? (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: token.colorTextTertiary,
                  gap: 8,
                }}
              >
                <MIcon name="waving_hand" size={28} color={token.colorTextQuaternary} />
                <div style={{ fontSize: 13.5, fontWeight: 650, color: token.colorText }}>
                  {channel?.kind === "dm"
                    ? `This is the start of your conversation with ${title}.`
                    : channel?.kind === "group"
                      ? `This is the start of your group with ${title}.`
                      : `Welcome to #${title}`}
                </div>
                <div style={{ fontSize: 12.5, color: token.colorTextTertiary, textAlign: "center" }}>
                  Say hello — you can drop in images and files, paste a screenshot,
                  or @mention someone.
                </div>
              </div>
            ) : (
              <div ref={contentRef}>
              {rows.map((m, i) => {
                const prev = rows[i - 1];
                const grouped = isGrouped(prev, m);
                const newDay = !prev || !dayjs(m.created_at).isSame(prev.created_at, "day");
                const mine = m.user_id === user?.id;
                return (
                  <div key={m.id}>
                    {newDay ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          margin: "16px 0 10px",
                        }}
                      >
                        <div style={{ flex: 1, height: 1, background: token.colorSplit }} />
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: token.colorTextTertiary }}>
                          {dayjs(m.created_at).isSame(dayjs(), "day")
                            ? "Today"
                            : dayjs(m.created_at).format("ddd, MMM D")}
                        </span>
                        <div style={{ flex: 1, height: 1, background: token.colorSplit }} />
                      </div>
                    ) : null}
                    {/* Slack's red "New messages" line — frozen at channel
                        open above the oldest unread message from others. */}
                    {m.id === firstNewId ? (
                      <div
                        aria-label="New messages"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          margin: "10px 0 6px",
                        }}
                      >
                        <div style={{ flex: 1, height: 1, background: token.colorError }} />
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            letterSpacing: ".6px",
                            textTransform: "uppercase",
                            lineHeight: "16px",
                            color: token.colorError,
                            border: `1px solid ${token.colorError}`,
                            borderRadius: 999,
                            padding: "1px 8px",
                          }}
                        >
                          New
                        </span>
                        <div style={{ flex: 1, height: 1, background: token.colorError }} />
                      </div>
                    ) : null}
                    <div
                      id={`chat-msg-${m.id}`}
                      className="wl-chat-msg"
                      style={{
                        position: "relative",
                        display: "flex",
                        gap: 10,
                        padding: grouped ? "1px 0" : "6px 0 1px",
                        // Deep-link (?m=) target flashes for ~2s.
                        background:
                          highlightId === m.id ? token.colorPrimaryBg : undefined,
                        transition: "background-color .4s ease",
                      }}
                    >
                      <MessageHoverActions
                        mine={mine}
                        canDelete={mine || isTeamAdmin}
                        pinned={Boolean(m.pinned_at)}
                        saved={savedIds.has(m.id)}
                        onReply={() => openThread(m)}
                        onTogglePin={() => void onTogglePin(m)}
                        onToggleSave={() => void onToggleSave(m.id)}
                        onReact={(e) => void onToggleReaction(m.id, e,
                          (reactionsByMessage?.get(m.id) ?? []).find(
                            (r) => r.user_id === user?.id && r.emoji === e,
                          )?.id,
                        )}
                        onEdit={() => {
                          setEditDraft(m.body);
                          setEditingId(m.id);
                        }}
                        onDelete={() => onDeleteMessage(m.id)}
                        onCopy={() => {
                          void navigator.clipboard?.writeText(m.body);
                          message.success("Copied");
                        }}
                        onMarkUnread={() => onMarkUnread(m)}
                      />
                      <div style={{ width: 30, flex: "none" }}>
                        {!grouped ? (
                          <Avatar size={30} src={m.author?.avatar_url ?? undefined} style={{ fontSize: 12 }}>
                            {initials(m.author?.name ?? "?")}
                          </Avatar>
                        ) : null}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        {!grouped ? (
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: token.colorText }}>
                              {mine ? "You" : (m.author?.name ?? "Member")}
                            </span>
                            <span style={{ fontSize: 11.5, color: token.colorTextQuaternary }}>
                              {dayjs(m.created_at).format("h:mm A")}
                            </span>
                            {m.pinned_at ? (
                              <Tooltip title="Pinned">
                                <span style={{ display: "inline-flex" }}>
                                  <MIcon name="keep" size={13} color="#4a4ad0" />
                                </span>
                              </Tooltip>
                            ) : null}
                          </div>
                        ) : null}
                        {editingId === m.id ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <Input.TextArea
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              autoSize={{ minRows: 1, maxRows: 8 }}
                              maxLength={4000}
                              autoFocus
                              onPressEnter={(e) => {
                                if (!e.shiftKey) {
                                  e.preventDefault();
                                  void commitEdit(m.id);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setEditingId(null);
                              }}
                            />
                            <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
                              Enter to save · Esc to cancel
                            </span>
                          </div>
                        ) : (
                          <>
                            {m.body ? (
                              <div
                                style={{
                                  fontSize: 13.5,
                                  lineHeight: 1.55,
                                  color: token.colorText,
                                  whiteSpace: "pre-wrap",
                                  overflowWrap: "break-word",
                                }}
                              >
                                <ChatMessageText text={m.body} memberNames={memberNames} />
                                {m.edited_at ? (
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: token.colorTextQuaternary,
                                      marginLeft: 6,
                                    }}
                                  >
                                    (edited)
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                            <MessageAttachments items={m.attachments ?? []} />
                            {m.body ? <MessageLinkPreview text={m.body} /> : null}
                            <MessageReactions
                              reactions={reactionsByMessage?.get(m.id) ?? []}
                              myUserId={user?.id}
                              onToggle={(emoji, existingId) =>
                                void onToggleReaction(m.id, emoji, existingId)
                              }
                            />
                            {m.reply_count > 0 ? (
                              <button
                                type="button"
                                onClick={() => openThread(m)}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  marginTop: 5,
                                  height: 22,
                                  padding: "0 9px",
                                  borderRadius: 999,
                                  border: `1px solid ${token.colorBorderSecondary}`,
                                  background: "transparent",
                                  cursor: "pointer",
                                  fontSize: 12,
                                  fontWeight: 650,
                                  color: "#4a4ad0",
                                }}
                              >
                                <MIcon name="forum" size={13} color="#4a4ad0" />
                                {m.reply_count === 1 ? "1 reply" : `${m.reply_count} replies`} →
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
            )}
          </div>

          {/* Composer — Slack-style bordered box with the send action inside.
              Archived channels are read-only: a banner replaces it. */}
          {archived ? (
            <div style={{ padding: "0 16px 14px", flex: "none" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorFillQuaternary,
                  fontSize: 12.5,
                  color: token.colorTextSecondary,
                }}
              >
                <MIcon name="archive" size={16} color={token.colorTextTertiary} />
                <span style={{ flex: 1 }}>
                  This channel is archived — it&apos;s read-only.
                </span>
                {canManageChannel ? (
                  <Button
                    size="small"
                    loading={setChannelArchived.isPending}
                    onClick={() =>
                      void setChannelArchived
                        .mutateAsync({ channelId, archived: false })
                        .catch((err) =>
                          message.error(errMsg(err, "Couldn't unarchive the channel.")),
                        )
                    }
                  >
                    Unarchive
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
          <div style={{ padding: "0 16px 14px", flex: "none" }}>
            {/* Typing indicator — constant height so the list doesn't jump. */}
            <div
              style={{
                height: 16,
                padding: "0 4px",
                fontSize: 11.5,
                color: token.colorTextTertiary,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {typingLabel}
            </div>
            <div
              ref={composerBoxRef}
              className="wl-chat-composer"
              onPaste={(e) => {
                // Screenshots pasted into the composer upload inline.
                const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
                  f.type.startsWith("image/"),
                );
                if (files.length) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const files = Array.from(e.dataTransfer.files ?? []);
                if (files.length) void addFiles(files);
              }}
              style={{
                border: `1px solid ${dragOver ? "#4a4ad0" : token.colorBorder}`,
                borderRadius: 10,
                background: dragOver ? token.colorPrimaryBg : token.colorBgContainer,
                transition: "background .15s ease, border-color .15s ease",
              }}
            >
              <PendingAttachmentStrip
                items={attachments}
                uploading={uploading}
                onRemove={(url) =>
                  setAttachments((prev) => prev.filter((a) => a.url !== url))
                }
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 6,
                  padding: "4px 6px 4px 4px",
                }}
              >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) void addFiles(files);
                  e.target.value = "";
                }}
              />
              <ComposerEmojiButton onPick={insertEmoji} />
              <Tooltip title="Attach files or images">
                <Button
                  type="text"
                  size="small"
                  aria-label="Attach images"
                  onClick={() => fileInputRef.current?.click()}
                  style={{ height: 30, width: 32, marginBottom: 3, flex: "none" }}
                  icon={<MIcon name="attach_file" size={17} />}
                />
              </Tooltip>
              <TeamMentionInput
                value={draft}
                onChange={(v) => {
                  setDraft(v);
                  if (v.trim()) notifyTyping();
                }}
                members={mentionMembers}
                entities={mentionEntities}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={`Message ${channel?.kind === "channel" ? `#${title}` : title}  (@ to tag)`}
                autoSize={{ minRows: 1, maxRows: 8 }}
                maxLength={4000}
                variant="borderless"
                style={{ flex: 1, fontSize: 13.5, padding: "7px 10px" }}
              />
              <Tooltip title="Send (Enter) · Shift+Enter for a new line">
                <Button
                  type="primary"
                  size="small"
                  aria-label="Send message"
                  disabled={(!draft.trim() && attachments.length === 0) || uploading > 0}
                  loading={send.isPending}
                  onClick={submit}
                  style={{ borderRadius: 8, height: 30, width: 34, marginBottom: 3 }}
                  icon={<MIcon name="send" size={15} />}
                />
              </Tooltip>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                padding: "6px 4px 0",
                fontSize: 11.5,
                color: token.colorTextQuaternary,
              }}
            >
              <span>Enter to send · Shift+Enter for a new line</span>
              <span style={{ marginLeft: "auto" }}>
                Paste or drop images and files to share them
              </span>
            </div>
          </div>
          )}
        </div>

        {/* Thread panel — docked column on desktop. */}
        {threadOpen && isDesktop && openThreadRoot ? (
          <div
            style={{
              width: 360,
              flex: "none",
              minWidth: 0,
              borderLeft: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <ThreadPanel
              key={openThreadRoot.id}
              channelId={channelId}
              root={openThreadRoot}
              memberNames={memberNames}
              archived={archived}
              onClose={closeThread}
              onTypingStop={() => notifyTyping({ stop: true })}
            />
          </div>
        ) : null}
      </div>

      {/* Thread panel — full-width drawer on mobile. */}
      <Drawer
        open={threadOpen && !isDesktop}
        onClose={closeThread}
        placement="right"
        width="100%"
        closable={false}
        styles={{ body: { padding: 0, display: "flex", flexDirection: "column" } }}
      >
        {openThreadRoot ? (
          <ThreadPanel
            key={openThreadRoot.id}
            channelId={channelId}
            root={openThreadRoot}
            memberNames={memberNames}
            archived={archived}
            onClose={closeThread}
            onTypingStop={() => notifyTyping({ stop: true })}
          />
        ) : null}
      </Drawer>

      {/* Rename channel */}
      <Modal
        title="Rename channel"
        open={renameOpen}
        onCancel={() => setRenameOpen(false)}
        onOk={() => void commitRename()}
        okText="Rename"
        okButtonProps={{ disabled: !renameVal.trim() }}
        confirmLoading={updateChannel.isPending}
        destroyOnHidden
      >
        <Input
          prefix={<MIcon name="tag" size={15} />}
          value={renameVal}
          onChange={(e) => setRenameVal(e.target.value)}
          maxLength={60}
          autoFocus
          onPressEnter={() => void commitRename()}
        />
      </Modal>

      {/* Edit topic */}
      <Modal
        title="Edit topic"
        open={topicOpen}
        onCancel={() => setTopicOpen(false)}
        onOk={() => void commitTopic()}
        okText="Save"
        confirmLoading={updateChannel.isPending}
        destroyOnHidden
      >
        <Input
          value={topicVal}
          onChange={(e) => setTopicVal(e.target.value)}
          placeholder="What is this channel about?"
          maxLength={240}
          autoFocus
          onPressEnter={() => void commitTopic()}
        />
      </Modal>

      <style>{`
        .wl-chat-back{display:none;}
        @media (max-width: 899px){ .wl-chat-back{display:inline-flex;} }
        .wl-chat-thread{margin:-22px -24px -48px;}
        @media (max-width: 899px){ .wl-chat-thread{margin:-16px -14px -40px;} }
        .wl-chat-composer:focus-within{border-color:#4a4ad0;box-shadow:0 0 0 2px rgba(74,74,208,.12);}
        .wl-chat-msg{border-radius:8px;margin:0 -8px;padding-left:8px;padding-right:8px;}
        .wl-chat-msg:hover{background:${token.colorFillQuaternary};}
        .wl-msg-actions{opacity:0;transition:opacity .12s ease;pointer-events:none;}
        .wl-chat-msg:hover .wl-msg-actions,
        .wl-msg-actions:focus-within{opacity:1;pointer-events:auto;}
        @keyframes wl-spin{to{transform:rotate(360deg);}}
        .wl-spin{animation:wl-spin 1s linear infinite;}
      `}</style>
    </div>
  );
}

/**
 * The thread side panel: root message on top, replies below, its own composer.
 * Rendered docked (desktop) or inside a Drawer (mobile); `key`ed by root id.
 * The reply draft persists per (channel, root) in the chat-drafts store.
 */
function ThreadPanel({
  channelId,
  root,
  memberNames,
  archived,
  onClose,
  onTypingStop,
}: {
  channelId: string;
  root: ChatMessage;
  memberNames: string[];
  /** Archived channels are read-only — the reply composer is hidden. */
  archived?: boolean;
  onClose: () => void;
  /** Broadcasts a typing_stop so receivers drop the "is typing…" right away. */
  onTypingStop?: () => void;
}) {
  const { token } = theme.useToken();
  const { message } = AntdApp.useApp();
  const { user } = useAuth();
  const { data: replies, isLoading } = useThreadMessages(root.id);
  const send = useSendMessage(channelId);
  // Persisted per-thread draft (survives closing the panel / reloads).
  const draft = useChatDraftsStore(
    (s) => s.threadDrafts[threadDraftKey(channelId, root.id)] ?? "",
  );
  const setThreadDraft = useChatDraftsStore((s) => s.setThreadDraft);
  const setDraft = useCallback(
    (v: string) => setThreadDraft(channelId, root.id, v),
    [setThreadDraft, channelId, root.id],
  );
  const listRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => replies ?? [], [replies]);

  // New replies (and the initial load) keep the panel pinned to the bottom.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [rows.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    onTypingStop?.();
    setDraft("");
    send.mutate(
      { body: text, parentId: root.id },
      {
        onError: (err) => {
          setDraft(text);
          message.error(errMsg(err, "Couldn't send the reply."));
        },
      },
    );
  };

  const renderBody = (m: ChatMessage) => (
    <>
      {m.body ? (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: token.colorText,
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
          }}
        >
          <ChatMessageText text={m.body} memberNames={memberNames} />
          {m.edited_at ? (
            <span style={{ fontSize: 11, color: token.colorTextQuaternary, marginLeft: 6 }}>
              (edited)
            </span>
          ) : null}
        </div>
      ) : null}
      <MessageAttachments items={m.attachments ?? []} />
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: `1px solid ${token.colorSplit}`,
          flex: "none",
        }}
      >
        <span style={{ fontSize: 13.5, fontWeight: 700, color: token.colorText, flex: 1 }}>
          Thread
        </span>
        <Button
          type="text"
          size="small"
          aria-label="Close thread"
          onClick={onClose}
          icon={<MIcon name="close" size={16} color={token.colorTextSecondary} />}
        />
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        {/* Root message */}
        <div style={{ display: "flex", gap: 10 }}>
          <Avatar size={28} src={root.author?.avatar_url ?? undefined} style={{ fontSize: 11, flex: "none" }}>
            {initials(root.author?.name ?? "?")}
          </Avatar>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: token.colorText }}>
                {root.user_id === user?.id ? "You" : (root.author?.name ?? "Member")}
              </span>
              <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>
                {dayjs(root.created_at).format("MMM D, h:mm A")}
              </span>
            </div>
            {renderBody(root)}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 8px" }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: token.colorTextTertiary, whiteSpace: "nowrap" }}>
            {rows.length === 0
              ? "No replies yet"
              : rows.length === 1
                ? "1 reply"
                : `${rows.length} replies`}
          </span>
          <div style={{ flex: 1, height: 1, background: token.colorSplit }} />
        </div>

        {isLoading ? (
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        ) : (
          rows.map((m, i) => {
            const grouped = isGrouped(rows[i - 1], m);
            return (
              <div
                key={m.id}
                style={{ display: "flex", gap: 10, padding: grouped ? "1px 0" : "6px 0 1px" }}
              >
                <div style={{ width: 26, flex: "none" }}>
                  {!grouped ? (
                    <Avatar size={26} src={m.author?.avatar_url ?? undefined} style={{ fontSize: 10 }}>
                      {initials(m.author?.name ?? "?")}
                    </Avatar>
                  ) : null}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {!grouped ? (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: token.colorText }}>
                        {m.user_id === user?.id ? "You" : (m.author?.name ?? "Member")}
                      </span>
                      <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>
                        {dayjs(m.created_at).format("h:mm A")}
                      </span>
                    </div>
                  ) : null}
                  {renderBody(m)}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Thread composer — hidden in archived (read-only) channels. */}
      {archived ? null : (
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
          padding: "8px 12px 12px",
          borderTop: `1px solid ${token.colorSplit}`,
          flex: "none",
        }}
      >
        <Input.TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoSize={{ minRows: 1, maxRows: 6 }}
          maxLength={4000}
          placeholder="Reply in thread…"
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button
          type="primary"
          size="small"
          aria-label="Send reply"
          disabled={!draft.trim()}
          loading={send.isPending}
          onClick={submit}
          style={{ borderRadius: 8, height: 30, width: 34 }}
          icon={<MIcon name="send" size={15} />}
        />
      </div>
      )}
    </div>
  );
}
