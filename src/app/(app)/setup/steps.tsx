"use client";

import {
  Form,
  Input,
  Typography,
  Button,
  Space,
  Tag,
  Alert,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useState } from "react";
import type { TeamDetailsInput } from "@/features/teams/use-team-details";
import { WorkspaceDetailsFields } from "@/features/teams/workspace-details-form";

const { Title, Paragraph, Text } = Typography;

/** Values collected on the "Workspace" step. */
export interface OrganizationValues {
  organizationName: string;
  teamName: string;
}

/** A single teammate the owner wants to invite. */
export interface InviteEntry {
  email: string;
  name: string;
}

/** How the owner wants the new workspace to begin. */
export type StartChoice = "sample" | "blank";

/* -------------------------------------------------------------------------- */
/* Step 1: Workspace                                                          */
/* -------------------------------------------------------------------------- */

export function OrganizationStep({
  form,
  initialValues,
}: {
  form: import("antd").FormInstance<OrganizationValues>;
  initialValues: OrganizationValues;
}) {
  return (
    <>
      <Title level={4} style={{ marginTop: 0 }}>
        Name your workspace
      </Title>
      <Paragraph type="secondary">
        Your organization can hold multiple workspaces — one per company, brand,
        or department. You can rename these later in settings.
      </Paragraph>

      <Form<OrganizationValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={initialValues}
      >
        <Form.Item
          label="Organization name"
          name="organizationName"
          rules={[
            { required: true, message: "Please enter an organization name." },
            { max: 255, message: "Organization name is too long." },
          ]}
        >
          <Input placeholder="Acme Inc." autoComplete="organization" />
        </Form.Item>

        <Form.Item
          label="Workspace name"
          name="teamName"
          rules={[
            { required: true, message: "Please enter a workspace name." },
            { max: 55, message: "Workspace name must be 55 characters or fewer." },
          ]}
        >
          <Input placeholder="Acme HQ" />
        </Form.Item>
      </Form>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 2: Company details                                                    */
/* -------------------------------------------------------------------------- */

export type DetailsValues = TeamDetailsInput;

export function DetailsStep({
  form,
}: {
  form: import("antd").FormInstance<DetailsValues>;
}) {
  return (
    <>
      <Title level={4} style={{ marginTop: 0 }}>
        Tell us about the company
      </Title>
      <Paragraph type="secondary">
        These details describe this workspace — they appear on invoices, client
        portals, and HR documents. Everything is optional and editable later in
        Settings.
      </Paragraph>

      <Form<DetailsValues> form={form} layout="vertical" requiredMark={false}>
        <WorkspaceDetailsFields />
      </Form>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 3: Starting point (blank vs sample template)                          */
/* -------------------------------------------------------------------------- */

const START_OPTIONS: {
  key: StartChoice;
  icon: string;
  title: string;
  desc: string;
  recommended?: boolean;
}[] = [
  {
    key: "sample",
    icon: "auto_awesome",
    title: "Start with sample data",
    desc: "Three example projects with tasks, statuses, priorities and due dates — explore a living workspace right away. Delete them anytime.",
    recommended: true,
  },
  {
    key: "blank",
    icon: "check_box_outline_blank",
    title: "Start blank",
    desc: "An empty workspace. Create your own spaces, projects and tasks from scratch.",
  },
];

export function StartStep({
  value,
  onChange,
}: {
  value: StartChoice;
  onChange: (next: StartChoice) => void;
}) {
  return (
    <>
      <Title level={4} style={{ marginTop: 0 }}>
        How do you want to start?
      </Title>
      <Paragraph type="secondary">
        We can pre-fill the workspace with realistic sample projects so you see
        Cubes in action, or leave it completely empty.
      </Paragraph>

      <div style={{ display: "grid", gap: 12 }}>
        {START_OPTIONS.map((opt) => {
          const active = value === opt.key;
          return (
            <div
              key={opt.key}
              role="radio"
              aria-checked={active}
              tabIndex={0}
              onClick={() => onChange(opt.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChange(opt.key);
                }
              }}
              style={{
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
                padding: "16px 16px",
                borderRadius: 12,
                cursor: "pointer",
                border: `2px solid ${active ? "#4a4ad0" : "#e8e9f0"}`,
                background: active ? "#f6f7ff" : "#fff",
                transition: "border-color .16s ease, background .16s ease",
              }}
            >
              <span
                className="material-symbols-rounded"
                aria-hidden
                style={{
                  fontSize: 24,
                  color: active ? "#4a4ad0" : "#9a9da8",
                  flex: "none",
                  marginTop: 2,
                }}
              >
                {opt.icon}
              </span>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 600,
                    fontSize: 14.5,
                    color: "#17171c",
                  }}
                >
                  {opt.title}
                  {opt.recommended ? <Tag color="geekblue">Recommended</Tag> : null}
                </div>
                <div style={{ fontSize: 13, color: "#6a6d78", marginTop: 4, lineHeight: 1.6 }}>
                  {opt.desc}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 4: Invite members                                                     */
/* -------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteStep({
  invites,
  onChange,
}: {
  invites: InviteEntry[];
  onChange: (next: InviteEntry[]) => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addInvite = () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    if (!EMAIL_RE.test(trimmed)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (invites.some((i) => i.email === trimmed)) {
      setError("That email has already been added.");
      return;
    }
    // Derive a friendly default name from the local part of the email.
    const name = trimmed.split("@")[0] ?? trimmed;
    onChange([...invites, { email: trimmed, name }]);
    setEmail("");
    setError(null);
  };

  const removeInvite = (target: string) => {
    onChange(invites.filter((i) => i.email !== target));
  };

  return (
    <>
      <Title level={4} style={{ marginTop: 0 }}>
        Invite your team
      </Title>
      <Paragraph type="secondary">
        Add teammates by email. This step is optional — you can always invite
        people later. Invitations are sent when you finish setup.
      </Paragraph>

      <Space.Compact style={{ width: "100%" }}>
        <Input
          placeholder="teammate@example.com"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          onPressEnter={(e) => {
            e.preventDefault();
            addInvite();
          }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={addInvite}>
          Add
        </Button>
      </Space.Compact>

      {error ? (
        <Alert
          type="error"
          message={error}
          showIcon
          style={{ marginTop: 8 }}
        />
      ) : null}

      <div style={{ marginTop: 16 }}>
        {invites.length === 0 ? (
          <Text type="secondary">No teammates added yet.</Text>
        ) : (
          <Space size={[8, 8]} wrap>
            {invites.map((invite) => (
              <Tag
                key={invite.email}
                closable
                onClose={(e) => {
                  e.preventDefault();
                  removeInvite(invite.email);
                }}
                style={{ paddingBlock: 4, paddingInline: 8 }}
              >
                {invite.email}
              </Tag>
            ))}
          </Space>
        )}
      </div>
    </>
  );
}
