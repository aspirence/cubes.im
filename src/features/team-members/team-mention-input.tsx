"use client";

import { useMemo } from "react";
import { Avatar, Mentions, theme } from "antd";

export interface MentionMember {
  /** The user id recorded in `mentions[]` (uuid of the user). */
  id: string;
  name: string;
  avatarUrl?: string | null;
  email?: string | null;
}

/**
 * A non-person thing `@` can tag: a team, a task, or a project. `meta` is the
 * secondary line in the picker (e.g. a task's project name).
 */
export interface MentionEntity {
  id: string;
  label: string;
  kind: "team" | "task" | "project";
  meta?: string | null;
}

const ENTITY_ICON: Record<MentionEntity["kind"], string> = {
  team: "groups",
  task: "task_alt",
  project: "folder",
};

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function MIcon({ name, size = 15, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/**
 * Boundary-aware mention matching. At each `@` in the text, the LONGEST label
 * that matches — and is followed by a word boundary — wins. Plain substring
 * inclusion is not enough: picking "@Design Ops" must not also match a team
 * named "Design", and "@Alice" must not notify "Ali".
 */
function matchMentionLabels<T extends { label: string }>(
  text: string,
  candidates: T[],
): T[] {
  const sorted = [...candidates]
    .filter((c) => c.label)
    .sort((a, b) => b.label.length - a.label.length);
  const hits = new Set<T>();
  for (let i = text.indexOf("@"); i !== -1; i = text.indexOf("@", i + 1)) {
    const rest = text.slice(i + 1);
    for (const c of sorted) {
      if (!rest.startsWith(c.label)) continue;
      const after = rest.charAt(c.label.length);
      // Boundary: end of text or a non-word character (space, punctuation).
      if (after === "" || !/[\p{L}\p{N}_]/u.test(after)) {
        hits.add(c);
        break; // longest match at this @ wins; shorter labels don't also fire
      }
    }
  }
  return [...hits];
}

/**
 * Derives the mentioned users' ids from the composed text — a user is mentioned
 * when the text contains `@<their name>` at a word boundary. Used on submit to
 * populate the `mentions[]` uuid array the notification trigger reads.
 */
export function extractMentionUserIds(text: string, members: MentionMember[]): string[] {
  const hits = matchMentionLabels(
    text,
    members.map((m) => ({ label: m.name, id: m.id })),
  );
  return [...new Set(hits.map((h) => h.id))];
}

export interface ExtractedMentions {
  userIds: string[];
  teamIds: string[];
  taskIds: string[];
  projectIds: string[];
}

/**
 * Full extraction across every taggable kind, matching the same `@<label>`
 * inclusion rule people-mentions already use. Callers decide what each kind
 * means (e.g. a tagged team fans out to its members' inboxes).
 */
export function extractMentions(
  text: string,
  members: MentionMember[],
  entities: MentionEntity[] = [],
): ExtractedMentions {
  // ONE matcher pass over people + entities together, so at any given `@` the
  // longest label wins across kinds too ("@Design Ops" the team beats a
  // member named "Design").
  const candidates = [
    ...members.map((m) => ({ label: m.name, id: m.id, kind: "user" as const })),
    ...entities.map((e) => ({ label: e.label, id: e.id, kind: e.kind })),
  ];
  const hits = matchMentionLabels(text, candidates);
  const out: ExtractedMentions = { userIds: [], teamIds: [], taskIds: [], projectIds: [] };
  for (const h of hits) {
    if (h.kind === "user") out.userIds.push(h.id);
    else if (h.kind === "team") out.teamIds.push(h.id);
    else if (h.kind === "task") out.taskIds.push(h.id);
    else out.projectIds.push(h.id);
  }
  out.userIds = [...new Set(out.userIds)];
  out.teamIds = [...new Set(out.teamIds)];
  out.taskIds = [...new Set(out.taskIds)];
  out.projectIds = [...new Set(out.projectIds)];
  return out;
}

/**
 * A text input where typing `@` opens a team-member picker inline (AntD Mentions)
 * — the ONE way to tag teammates across the platform. No separate "mention"
 * field: you just write, and `@` pops the toolbar. Read the tagged users back
 * with {@link extractMentionUserIds}.
 */
export function TeamMentionInput({
  value,
  onChange,
  members,
  entities = [],
  placeholder,
  rows = 2,
  autoSize,
  disabled,
  variant,
  maxLength,
  onPressEnter,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  members: MentionMember[];
  /** Optional non-person tags (teams, tasks, projects) offered under the same `@`. */
  entities?: MentionEntity[];
  placeholder?: string;
  rows?: number;
  autoSize?: boolean | { minRows?: number; maxRows?: number };
  disabled?: boolean;
  variant?: "outlined" | "borderless" | "filled";
  maxLength?: number;
  onPressEnter?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  style?: React.CSSProperties;
}) {
  const { token } = theme.useToken();

  const options = useMemo(
    () => [
      ...members.map((m) => ({
        key: `u:${m.id}`,
        value: m.name,
        label: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Avatar size={22} src={m.avatarUrl ?? undefined} style={{ fontSize: 10, flex: "none" }}>
              {initials(m.name)}
            </Avatar>
            <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.2 }}>
              <span style={{ fontSize: 13, color: token.colorText }}>{m.name}</span>
              {m.email ? (
                <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{m.email}</span>
              ) : null}
            </span>
          </span>
        ),
      })),
      ...entities.map((e) => ({
        key: `${e.kind}:${e.id}`,
        value: e.label,
        label: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 7,
                flex: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: token.colorPrimaryBg,
              }}
            >
              <MIcon name={ENTITY_ICON[e.kind]} size={13} color="#4a4ad0" />
            </span>
            <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.2 }}>
              <span style={{ fontSize: 13, color: token.colorText }}>{e.label}</span>
              <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                {e.meta ?? (e.kind === "team" ? "Team" : e.kind === "task" ? "Task" : "Project")}
              </span>
            </span>
          </span>
        ),
      })),
    ],
    [members, entities, token],
  );

  return (
    <Mentions
      value={value}
      onChange={onChange}
      prefix="@"
      rows={rows}
      autoSize={autoSize}
      disabled={disabled}
      placeholder={placeholder}
      variant={variant}
      maxLength={maxLength}
      onPressEnter={onPressEnter}
      style={{ width: "100%", ...style }}
      options={options}
      filterOption={(input, option) =>
        String(option?.value ?? "").toLowerCase().includes(input.toLowerCase())
      }
    />
  );
}
