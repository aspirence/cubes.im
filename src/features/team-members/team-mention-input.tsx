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

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

/**
 * Derives the mentioned users' ids from the composed text — a user is mentioned
 * when the text contains `@<their name>`. Used on submit to populate the
 * `mentions[]` uuid array the notification trigger reads.
 */
export function extractMentionUserIds(text: string, members: MentionMember[]): string[] {
  const ids: string[] = [];
  for (const m of members) {
    if (m.name && text.includes(`@${m.name}`)) ids.push(m.id);
  }
  return [...new Set(ids)];
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
  placeholder,
  rows = 2,
  autoSize,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  members: MentionMember[];
  placeholder?: string;
  rows?: number;
  autoSize?: boolean | { minRows?: number; maxRows?: number };
  disabled?: boolean;
}) {
  const { token } = theme.useToken();

  const options = useMemo(
    () =>
      members.map((m) => ({
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
    [members, token],
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
      style={{ width: "100%" }}
      options={options}
      filterOption={(input, option) =>
        String(option?.value ?? "").toLowerCase().includes(input.toLowerCase())
      }
    />
  );
}
