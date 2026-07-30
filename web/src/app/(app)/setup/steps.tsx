"use client";

import {
  Form,
  Input,
  Typography,
  Button,
  Space,
  Tag,
  Alert,
  Skeleton,
  App as AntdApp,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TeamDetailsInput } from "@/features/teams/use-team-details";
import { WorkspaceDetailsFields } from "@/features/teams/workspace-details-form";
import {
  useJoinableOrg,
  useRequestToJoin,
} from "@/features/join-requests/use-join-requests";
import {
  useMyPendingInvitations,
  useAcceptInvitation,
} from "@/features/invitations/use-invitations";

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
          <Input placeholder="Acme Inc." autoComplete="organization" size="large" />
        </Form.Item>

        <Form.Item
          label="Workspace name"
          name="teamName"
          rules={[
            { required: true, message: "Please enter a workspace name." },
            { max: 55, message: "Workspace name must be 55 characters or fewer." },
          ]}
        >
          <Input placeholder="Acme HQ" size="large" />
        </Form.Item>
      </Form>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 0: Create vs Join                                                     */
/* -------------------------------------------------------------------------- */

export type SetupMode = "create" | "join";

export function ChooseModeStep({
  onChoose,
}: {
  onChoose: (mode: SetupMode) => void;
}) {
  const { message } = AntdApp.useApp();
  // Invitations addressed to this email are surfaced RIGHT HERE — an invited
  // person should join in one click, not wander through "request access".
  const { data: myInvites } = useMyPendingInvitations();
  const acceptInvite = useAcceptInvitation();
  const pending = myInvites ?? [];

  async function onAcceptFromChooser(id: string) {
    if (acceptInvite.isPending) return; // double-click guard
    try {
      await acceptInvite.mutateAsync(id);
      message.success("You're in!");
      // Joining flips the server-side onboarding gate (setup_completed) and
      // repoints the active workspace, so boot the app fresh rather than a
      // soft navigation that can reuse a cached pre-join route payload.
      window.location.assign("/home");
    } catch (e) {
      // "not found" almost always means an earlier click already consumed the
      // invitation (membership exists) — proceed instead of scaring the user.
      if (e instanceof Error && /not found/i.test(e.message)) {
        window.location.assign("/home");
        return;
      }
      message.error("Couldn't accept that invitation — it may have expired.");
    }
  }

  const OPTIONS: { key: SetupMode; icon: string; title: string; desc: string }[] = [
    {
      key: "create",
      icon: "add_business",
      title: "Create a new workspace",
      desc: "Set up a brand-new organization and workspace for your team.",
    },
    {
      key: "join",
      icon: "groups",
      title: "Join workspace",
      desc: pending.length
        ? "You already have an invitation waiting — join in one click."
        : "Your company already uses Cubes — request access with your work email.",
    },
  ];
  return (
    <>
      <Title level={4} style={{ marginTop: 0 }}>
        How would you like to start?
      </Title>
      <Paragraph type="secondary">
        Create your own workspace, or join one your company already has.
      </Paragraph>
      <div style={{ display: "grid", gap: 12 }}>
        {OPTIONS.map((opt) => (
          <div
            key={opt.key}
            role="button"
            tabIndex={0}
            onClick={() => onChoose(opt.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onChoose(opt.key);
              }
            }}
            style={{
              display: "flex",
              gap: 14,
              alignItems: "center",
              padding: "18px 16px",
              borderRadius: 14,
              cursor: "pointer",
              border: "2px solid #e8e9f0",
              background: "#fff",
              transition: "border-color .16s ease, background .16s ease",
            }}
          >
            <span
              className="material-symbols-rounded"
              aria-hidden
              style={{ fontSize: 24, color: "#111319", flex: "none" }}
            >
              {opt.icon}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14.5, color: "#17171c" }}>{opt.title}</span>
                {opt.key === "join" && pending.length > 0 ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#1f8a4c",
                      background: "#e6f6ec",
                      borderRadius: 999,
                      padding: "2px 8px",
                    }}
                  >
                    {pending.length} invitation{pending.length > 1 ? "s" : ""}
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: 13, color: "#6a6d78", marginTop: 4, lineHeight: 1.6 }}>{opt.desc}</div>

              {opt.key === "join" && pending.length > 0 ? (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {pending.map((inv) => {
                    const teamName = inv.team_name || "A workspace";
                    const monogram = teamName
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join("")
                      .toUpperCase();
                    return (
                      <div
                        key={inv.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          background: "#fff",
                          border: "1px solid #e8e9f0",
                          borderRadius: 12,
                          padding: "10px 12px",
                          boxShadow: "0 1px 4px rgba(17,19,25,.05)",
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            background: "linear-gradient(135deg,#4a4ad0,#7a5cf0)",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700,
                            fontSize: 13,
                            flex: "none",
                          }}
                        >
                          {monogram}
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: 13.5,
                              fontWeight: 650,
                              color: "#17171c",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {teamName}
                          </div>
                          <div style={{ fontSize: 11.5, color: "#6a6d78", marginTop: 1 }}>
                            You&apos;re invited · joining as {inv.member_type || "member"}
                          </div>
                        </div>
                        <Button
                          type="primary"
                          style={{
                            background: "#4a4ad0",
                            borderColor: "#4a4ad0",
                            fontWeight: 600,
                            borderRadius: 9,
                          }}
                          loading={acceptInvite.isPending && acceptInvite.variables === inv.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void onAcceptFromChooser(inv.id);
                          }}
                        >
                          Join {teamName.split(/\s+/)[0]}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <span
              className="material-symbols-rounded"
              aria-hidden
              style={{ fontSize: 22, color: "#c1c5d0", marginLeft: "auto", flex: "none" }}
            >
              chevron_right
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Join flow: request access by domain, or accept a pending invitation        */
/* -------------------------------------------------------------------------- */

const REQUEST_ERRORS: Record<string, string> = {
  no_matching_org: "We couldn't find a workspace for your email domain.",
  already_member: "You're already a member of this organization.",
  already_pending: "You already have a pending request.",
};

export function JoinStep({ onCreateInstead }: { onCreateInstead: () => void }) {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data: org, isLoading } = useJoinableOrg();
  const { data: invites } = useMyPendingInvitations();
  const requestToJoin = useRequestToJoin();
  const acceptInvite = useAcceptInvitation();

  async function onRequest() {
    try {
      await requestToJoin.mutateAsync();
      message.success("Request sent — we've notified the admins.");
      // request_to_join() completes onboarding server-side too, so re-enter
      // the app with a fresh document rather than a soft navigation.
      window.location.assign("/home");
    } catch (e) {
      const raw = e instanceof Error ? e.message : "";
      const key = Object.keys(REQUEST_ERRORS).find((k) => raw.includes(k));
      message.error(key ? REQUEST_ERRORS[key] : "Couldn't send your request — please try again.");
    }
  }

  async function onAccept(id: string) {
    if (acceptInvite.isPending) return; // double-click guard
    try {
      await acceptInvite.mutateAsync(id);
      message.success("You're in!");
      // Joining flips the server-side onboarding gate (setup_completed) and
      // repoints the active workspace, so boot the app fresh rather than a
      // soft navigation that can reuse a cached pre-join route payload.
      window.location.assign("/home");
    } catch (e) {
      if (e instanceof Error && /not found/i.test(e.message)) {
        window.location.assign("/home");
        return;
      }
      message.error("Couldn't accept that invitation — it may have expired.");
    }
  }

  return (
    <>
      <Title level={4} style={{ marginTop: 0 }}>
        Join your company&apos;s workspace
      </Title>
      <Paragraph type="secondary">
        We match your work email to an organization that already uses Cubes.
      </Paragraph>

      {isLoading ? (
        <Skeleton active paragraph={{ rows: 2 }} />
      ) : org ? (
        org.already_member ? (
          <Alert
            type="success"
            showIcon
            message={`You're already a member of ${org.org_name}.`}
            action={
              <Button size="small" type="primary" style={DARK_BTN} onClick={() => router.replace("/home")}>
                Go to workspace
              </Button>
            }
          />
        ) : org.pending ? (
          <Alert
            type="info"
            showIcon
            message="Request pending"
            description={`We've notified the admins at ${org.org_name}. You'll get a notification when you're approved.`}
          />
        ) : (
          <div
            style={{
              border: "1px solid #e8e9f0",
              borderRadius: 14,
              padding: 18,
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 26, color: "#111319" }}>
              domain
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: "#17171c" }}>{org.org_name}</div>
              <div style={{ fontSize: 13, color: "#6a6d78", marginTop: 2 }}>
                Matched your domain <b>@{org.domain}</b>
              </div>
            </div>
            <Button
              type="primary"
              size="large"
              loading={requestToJoin.isPending}
              onClick={onRequest}
              style={DARK_BTN}
            >
              Request to join
            </Button>
          </div>
        )
      ) : (
        <Alert
          type="warning"
          showIcon
          message="No workspace found for your email domain"
          description="Ask an admin to invite you by email, or create your own workspace instead."
        />
      )}

      {invites && invites.length > 0 ? (
        <div style={{ marginTop: 22 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: ".5px",
              textTransform: "uppercase",
              color: "#9a9da8",
              marginBottom: 10,
            }}
          >
            You&apos;ve been invited
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {invites.map((inv) => (
              <div
                key={inv.id}
                style={{
                  border: "1px solid #e8e9f0",
                  borderRadius: 12,
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 22, color: "#111319" }}>
                  mail
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{inv.team_name || "A workspace"}</div>
                  <div style={{ fontSize: 12.5, color: "#6a6d78" }}>Invitation to {inv.email}</div>
                </div>
                <Button size="small" loading={acceptInvite.isPending} onClick={() => onAccept(inv.id)}>
                  Accept
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 24 }}>
        <Button type="link" onClick={onCreateInstead} style={{ paddingLeft: 0 }}>
          ← Create my own workspace instead
        </Button>
      </div>
    </>
  );
}

const DARK_BTN = { background: "#111319", borderColor: "#111319" } as const;

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
                borderRadius: 14,
                cursor: "pointer",
                border: `2px solid ${active ? "#111319" : "#e8e9f0"}`,
                background: active ? "#f6f7f9" : "#fff",
                transition: "border-color .16s ease, background .16s ease",
              }}
            >
              <span
                className="material-symbols-rounded"
                aria-hidden
                style={{
                  fontSize: 24,
                  color: active ? "#111319" : "#9a9da8",
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
                  {opt.recommended ? (
                    <Tag style={{ background: "#111319", color: "#fff", border: "none", borderRadius: 999, fontSize: 11, fontWeight: 600, lineHeight: "18px" }}>
                      Recommended
                    </Tag>
                  ) : null}
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

/**
 * Validates a typed address against the list already staged. Exported so the
 * wizard can commit a still-in-the-box address when the user clicks Next or
 * Finish without pressing Add — otherwise the invite is silently dropped.
 */
export function stageInviteEmail(
  raw: string,
  invites: InviteEntry[],
): { ok: true; next: InviteEntry[] } | { ok: false; error: string } {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return { ok: false, error: "" };
  if (!EMAIL_RE.test(trimmed))
    return { ok: false, error: "Please enter a valid email address." };
  if (invites.some((i) => i.email === trimmed))
    return { ok: false, error: "That email has already been added." };
  // Derive a friendly default name from the local part of the email.
  const name = trimmed.split("@")[0] ?? trimmed;
  return { ok: true, next: [...invites, { email: trimmed, name }] };
}

export function InviteStep({
  invites,
  onChange,
  pending,
  onPendingChange,
}: {
  invites: InviteEntry[];
  onChange: (next: InviteEntry[]) => void;
  /** The address currently in the box — owned by the wizard so it survives
   *  this step unmounting and can still be committed on Finish. */
  pending: string;
  onPendingChange: (value: string) => void;
}) {
  const email = pending;
  const setEmail = onPendingChange;
  const [error, setError] = useState<string | null>(null);

  const addInvite = () => {
    const result = stageInviteEmail(email, invites);
    if (!result.ok) {
      if (result.error) setError(result.error);
      return;
    }
    onChange(result.next);
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
          onBlur={addInvite}
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
