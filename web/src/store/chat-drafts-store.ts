import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/** Key for a thread composer draft — one per (conversation, thread root). */
export const threadDraftKey = (channelId: string, rootId: string) =>
  `${channelId}:${rootId}`;

/**
 * Per-conversation composer drafts, persisted across reloads (Slack behavior).
 * `drafts` is keyed by channelId; `threadDrafts` by `<channelId>:<rootId>`.
 * Text is stored RAW — trailing newlines/spaces mid-typing must survive a
 * channel switch — and an entry is deleted only when it's exactly "".
 * Readers that care about "something actually typed" (the sidebar's pencil
 * marker) trim on their side.
 */
interface ChatDraftsState {
  drafts: Record<string, string>;
  threadDrafts: Record<string, string>;
  setDraft: (channelId: string, text: string) => void;
  clearDraft: (channelId: string) => void;
  setThreadDraft: (channelId: string, rootId: string, text: string) => void;
  clearThreadDraft: (channelId: string, rootId: string) => void;
}

function without(
  map: Record<string, string>,
  key: string,
): Record<string, string> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

export const useChatDraftsStore = create<ChatDraftsState>()(
  persist(
    (set) => ({
      drafts: {},
      threadDrafts: {},
      setDraft: (channelId, text) =>
        set((s) => ({
          drafts: text
            ? { ...s.drafts, [channelId]: text }
            : without(s.drafts, channelId),
        })),
      clearDraft: (channelId) =>
        set((s) => ({ drafts: without(s.drafts, channelId) })),
      setThreadDraft: (channelId, rootId, text) =>
        set((s) => ({
          threadDrafts: text
            ? { ...s.threadDrafts, [threadDraftKey(channelId, rootId)]: text }
            : without(s.threadDrafts, threadDraftKey(channelId, rootId)),
        })),
      clearThreadDraft: (channelId, rootId) =>
        set((s) => ({
          threadDrafts: without(
            s.threadDrafts,
            threadDraftKey(channelId, rootId),
          ),
        })),
    }),
    {
      name: "chat-drafts",
      // SSR-safe storage — same pattern as ui-store: no-op off the browser.
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? window.localStorage
          : {
              getItem: () => null,
              setItem: () => undefined,
              removeItem: () => undefined,
            },
      ),
      partialize: (state) => ({
        drafts: state.drafts,
        threadDrafts: state.threadDrafts,
      }),
      version: 1,
    },
  ),
);
