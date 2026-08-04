"use client";

import type { MentionMember } from "@/features/team-members/team-mention-input";
import { NotionEditor } from "@/features/editor/notion-editor";

const TASK_PLACEHOLDER =
  "Describe the task — type / for commands, @ to mention, paste or drop images…";

/**
 * A task description.
 *
 * The editor itself now lives in `features/editor/notion-editor.tsx` and is
 * shared with docs, briefs and notes — this is the task-shaped configuration of
 * it, kept as its own component so the three call sites (task drawer, create
 * modal, task templates) don't each have to remember the placeholder and the
 * sizing.
 */
export function RichDescription({
  value,
  onChange,
  onCommit,
  minRows = 4,
  maxRows = 16,
  mentionMembers,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  minRows?: number;
  maxRows?: number;
  /** When provided, typing `@` opens the member picker. */
  mentionMembers?: MentionMember[];
}) {
  return (
    <NotionEditor
      value={value}
      onChange={onChange}
      onCommit={onCommit}
      minRows={minRows}
      maxRows={maxRows}
      mentionMembers={mentionMembers}
      placeholder={TASK_PLACEHOLDER}
      variant="compact"
    />
  );
}
