"use client";

import { useMemo } from "react";
import { Mentions, Space, Tag, Typography } from "antd";
import {
  AGENT_CONTEXTS,
  extractAgentMentions,
  getAgentContext,
} from "@/features/workflows/agent-config";

interface AgentMentionsInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

export function AgentMentionsInput({
  value = "",
  onChange,
  placeholder,
  rows = 4,
  disabled = false,
}: AgentMentionsInputProps) {
  const mentions = useMemo(() => extractAgentMentions(value), [value]);

  return (
    <div>
      <Mentions
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        prefix={["@"]}
        rows={rows}
        disabled={disabled}
        style={{ width: "100%" }}
        options={AGENT_CONTEXTS.map((context) => ({
          value: context.key,
          label: (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 600 }}>{context.title}</span>
              <span style={{ fontSize: 12, color: "#8b90a0" }}>
                {context.description}
              </span>
            </div>
          ),
        }))}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 8,
          flexWrap: "wrap",
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Type <code>@</code> to attach Cubes context.
        </Typography.Text>
        <Space size={[6, 6]} wrap>
          {mentions.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              No context tagged yet
            </Typography.Text>
          ) : (
            mentions.map((mention) => {
              const context = getAgentContext(mention);
              return (
                <Tag
                  key={mention}
                  style={{
                    margin: 0,
                    borderRadius: 999,
                    color: context.accent,
                    borderColor: `${context.accent}33`,
                    background: `${context.accent}12`,
                  }}
                >
                  @{mention}
                </Tag>
              );
            })
          )}
        </Space>
      </div>
    </div>
  );
}
