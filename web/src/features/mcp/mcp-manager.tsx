"use client";

import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { CopyOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useActiveTeam } from "@/features/teams/use-teams";
import {
  useMcpTokens,
  useCreateMcpToken,
  useRevokeMcpToken,
  useDeleteMcpToken,
  type McpTokenRow,
} from "@/features/mcp/use-mcp-tokens";

const { Title, Text, Paragraph } = Typography;

function CodeBlock({ children }: { children: string }) {
  const { message } = App.useApp();
  return (
    <div
      style={{
        position: "relative",
        background: "#14171f",
        color: "#d8dce6",
        borderRadius: 10,
        padding: "12px 42px 12px 14px",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 12.5,
        lineHeight: 1.6,
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {children}
      <Button
        type="text"
        size="small"
        icon={<CopyOutlined />}
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(children);
          message.success("Copied.");
        }}
        style={{ position: "absolute", top: 8, right: 8, color: "#9aa4b6" }}
      />
    </div>
  );
}

/**
 * The MCP token management + connect-instructions UI. Shared by the App Center
 * page (with an install gate) and reusable anywhere else. Tokens bind to the
 * active workspace.
 */
export function McpManager() {
  const { message } = App.useApp();
  const { data: activeTeam } = useActiveTeam();
  const { data: tokens, isLoading } = useMcpTokens();
  const createToken = useCreateMcpToken();
  const revokeToken = useRevokeMcpToken();
  const deleteToken = useDeleteMcpToken();

  const [name, setName] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://cubes.im";
  const endpoint = `${origin}/api/mcp`;

  const handleCreate = () => {
    createToken.mutate(name, {
      onSuccess: (token) => {
        setFreshToken(token);
        setName("");
      },
      onError: (err) =>
        message.error(err instanceof Error ? err.message : "Failed to create token."),
    });
  };

  const columns: ColumnsType<McpTokenRow> = [
    {
      title: "Name",
      dataIndex: "name",
      render: (v: string, row) => (
        <Space size={8}>
          <span style={{ fontWeight: 600 }}>{v}</span>
          {row.revoked ? <Tag color="red">Revoked</Tag> : <Tag color="green">Active</Tag>}
        </Space>
      ),
    },
    { title: "Workspace", dataIndex: "team_name" },
    {
      title: "Created",
      dataIndex: "created_at",
      width: 130,
      render: (v: string) => dayjs(v).format("MMM D, YYYY"),
    },
    {
      title: "Last used",
      dataIndex: "last_used_at",
      width: 130,
      render: (v: string | null) => (v ? dayjs(v).fromNow() : "Never"),
    },
    {
      title: "",
      key: "actions",
      width: 170,
      render: (_, row) => (
        <Space size={4}>
          {!row.revoked ? (
            <Popconfirm
              title="Revoke this token?"
              description="Clients using it lose access immediately."
              okText="Revoke"
              okButtonProps={{ danger: true }}
              onConfirm={() => revokeToken.mutate(row.id)}
            >
              <Button size="small">Revoke</Button>
            </Popconfirm>
          ) : null}
          <Popconfirm
            title="Delete this token?"
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteToken.mutate(row.id)}
          >
            <Button size="small" danger type="text">
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Title level={4} style={{ marginTop: 0 }}>
          Connect Claude to Cubes
        </Title>
        <Paragraph type="secondary" style={{ maxWidth: 640 }}>
          Cubes runs an <b>MCP server</b> at <Text code>{endpoint}</Text>. Connect
          Claude (Claude Code, Claude Desktop) with a personal access token and it
          can list projects, create and update tasks, mark work done, and
          comment — scoped to <b>one workspace per token</b>.
        </Paragraph>

        <Space.Compact style={{ width: "100%", maxWidth: 440 }}>
          <Input
            placeholder={`Token name — e.g. "Claude Code" `}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={handleCreate}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={createToken.isPending}
            onClick={handleCreate}
            disabled={!activeTeam}
          >
            Create token
          </Button>
        </Space.Compact>
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            The token will be bound to your active workspace:{" "}
            <b>{activeTeam?.name ?? "…"}</b>
          </Text>
        </div>

        <Table<McpTokenRow>
          rowKey="id"
          style={{ marginTop: 20 }}
          size="small"
          loading={isLoading}
          columns={columns}
          dataSource={tokens ?? []}
          pagination={false}
          locale={{ emptyText: "No tokens yet — create one above." }}
          scroll={{ x: "max-content" }}
        />
      </Card>

      <Card>
        <Title level={5} style={{ marginTop: 0 }}>
          Connect from Claude Code
        </Title>
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          One command — replace <Text code>YOUR_TOKEN</Text> with the token you
          created:
        </Paragraph>
        <CodeBlock>{`claude mcp add --transport http cubes ${endpoint} --header "Authorization: Bearer YOUR_TOKEN"`}</CodeBlock>

        <Title level={5} style={{ marginTop: 22 }}>
          Connect from Claude Desktop
        </Title>
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          Add this to <Text code>claude_desktop_config.json</Text> →{" "}
          <Text code>mcpServers</Text>:
        </Paragraph>
        <CodeBlock>{`"cubes": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "${endpoint}", "--header", "Authorization: Bearer YOUR_TOKEN"]
}`}</CodeBlock>

        <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 18 }}>
          claude.ai custom connectors require OAuth, which this server
          doesn&apos;t speak yet — use Claude Code or Claude Desktop for now.
          Available tools: list_projects, list_tasks, my_tasks, get_task,
          create_task, update_task, complete_task, add_comment, search,
          create_project.
        </Paragraph>
      </Card>

      <Modal
        title="Copy your token now"
        open={freshToken !== null}
        onCancel={() => setFreshToken(null)}
        footer={
          <Button type="primary" onClick={() => setFreshToken(null)}>
            I&apos;ve saved it
          </Button>
        }
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          message="This token is shown only once."
          description="Cubes stores only a hash — if you lose it, revoke it and create a new one."
          style={{ marginBottom: 14 }}
        />
        {freshToken ? <CodeBlock>{freshToken}</CodeBlock> : null}
      </Modal>
    </Space>
  );
}
