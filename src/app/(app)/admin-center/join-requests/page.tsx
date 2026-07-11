"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Select,
  Skeleton,
  Table,
  Tag,
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/use-auth";
import { useUserOrg } from "@/features/admin/use-admin";
import {
  useOrgJoinRequests,
  useDecideJoinRequest,
  type JoinRequest,
} from "@/features/join-requests/use-join-requests";
import { useOrgDomains, useClaimOrgDomain } from "@/features/join-requests/use-org-domains";

const { Title, Text, Paragraph } = Typography;

function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

type TeamOpt = { id: string; name: string };
type RoleOpt = { id: string; name: string; default_role: boolean };

const CLAIM_ERRORS: Record<string, string> = {
  blocked_domain: "That's a public email provider — it can't be claimed.",
  email_domain_mismatch: "Your account email isn't on that domain, so it can't be verified.",
  domain_already_claimed: "That domain is already verified by another organization.",
  invalid_domain: "That doesn't look like a valid domain.",
  forbidden: "Only organization admins can claim a domain.",
};

export default function JoinRequestsAdminPage() {
  const { message } = App.useApp();
  const supabase = useMemo(() => createClient(), []);
  const { profile } = useAuth();
  const { data: userOrg, isLoading: orgLoading } = useUserOrg();
  const org = userOrg?.org;
  const orgId = org?.id;

  const { data: isAdmin, isLoading: adminLoading } = useQuery({
    queryKey: ["is-org-admin", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await loose(supabase).rpc("is_org_admin", { _org_id: orgId });
      if (error) throw error;
      return Boolean(data);
    },
  });

  const { data: domains } = useOrgDomains(orgId);
  const claimDomain = useClaimOrgDomain();
  const { data: requests, isLoading: reqLoading } = useOrgJoinRequests(orgId);
  const decide = useDecideJoinRequest();

  const { data: teams } = useQuery({
    queryKey: ["org-teams-picker", orgId],
    enabled: Boolean(orgId && isAdmin),
    queryFn: async (): Promise<TeamOpt[]> => {
      const { data, error } = await supabase
        .from("teams")
        .select("id,name")
        .eq("organization_id", orgId as string);
      if (error) throw error;
      return (data ?? []) as TeamOpt[];
    },
  });

  // Approve modal state
  const [approving, setApproving] = useState<JoinRequest | null>(null);
  const [teamId, setTeamId] = useState<string>();
  const [roleId, setRoleId] = useState<string>();
  const [note, setNote] = useState("");

  const { data: roles } = useQuery({
    queryKey: ["team-roles-picker", teamId],
    enabled: Boolean(teamId),
    queryFn: async (): Promise<RoleOpt[]> => {
      const { data, error } = await supabase
        .from("roles")
        .select("id,name,default_role")
        .eq("team_id", teamId as string);
      if (error) throw error;
      return (data ?? []) as RoleOpt[];
    },
  });

  const verifiedDomains = (domains ?? []).filter((d) => d.verified);
  const suggestedDomain = profile?.email?.split("@")[1] ?? "";

  function openApprove(req: JoinRequest) {
    setApproving(req);
    const firstTeam = teams?.[0]?.id;
    setTeamId(firstTeam);
    setRoleId(undefined);
    setNote("");
  }

  async function onClaim() {
    if (!orgId || !suggestedDomain) return;
    try {
      await claimDomain.mutateAsync({ orgId, domain: suggestedDomain });
      message.success(`Verified @${suggestedDomain} — teammates can now request to join.`);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "";
      const key = Object.keys(CLAIM_ERRORS).find((k) => raw.includes(k));
      message.error(key ? CLAIM_ERRORS[key] : "Couldn't claim that domain.");
    }
  }

  async function confirmApprove() {
    if (!approving || !teamId) {
      message.warning("Pick a workspace to assign.");
      return;
    }
    try {
      await decide.mutateAsync({
        requestId: approving.id,
        approve: true,
        teamId,
        roleId: roleId ?? (roles?.find((r) => r.default_role)?.id),
        note: note.trim() || undefined,
      });
      message.success("Approved — the person has been added.");
      setApproving(null);
    } catch {
      message.error("Couldn't approve this request.");
    }
  }

  async function onReject(req: JoinRequest) {
    try {
      await decide.mutateAsync({ requestId: req.id, approve: false });
      message.success("Request rejected.");
    } catch {
      message.error("Couldn't reject this request.");
    }
  }

  if (orgLoading || adminLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (!isAdmin) {
    return (
      <Card>
        <Empty description="Only organization admins can manage join requests." />
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>Join requests</Title>
        <Text type="secondary">
          People who requested access to {org?.organization_name ?? "your organization"} using their company email.
        </Text>
      </div>

      {/* Domain card */}
      <Card>
        <Title level={5} style={{ marginTop: 0 }}>Company domain</Title>
        {verifiedDomains.length > 0 ? (
          <>
            <Paragraph type="secondary" style={{ marginBottom: 8 }}>
              Anyone signing up with these domains can request to join your organization.
            </Paragraph>
            {verifiedDomains.map((d) => (
              <Tag key={d.id} color="green" style={{ marginBottom: 4 }}>@{d.domain} · verified</Tag>
            ))}
          </>
        ) : (
          <>
            <Paragraph type="secondary" style={{ marginBottom: 12 }}>
              Claim your company&apos;s email domain so teammates can find and request to join
              this organization. You can only verify a domain your own account email is on.
            </Paragraph>
            {suggestedDomain ? (
              <Button type="primary" loading={claimDomain.isPending} onClick={onClaim}>
                Claim &amp; verify @{suggestedDomain}
              </Button>
            ) : (
              <Text type="secondary">No company domain detected on your account email.</Text>
            )}
          </>
        )}
      </Card>

      {/* Pending requests */}
      <Card styles={{ body: { padding: 0 } }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--ant-color-split, #f0f0f0)" }}>
          <Text strong>Pending requests</Text>
        </div>
        <Table<JoinRequest>
          rowKey="id"
          loading={reqLoading}
          dataSource={requests ?? []}
          size="middle"
          pagination={{ pageSize: 15, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description="No pending requests." /> }}
          columns={[
            {
              title: "Requested",
              dataIndex: "created_at",
              render: (v: string) => new Date(v).toLocaleString(),
            },
            { title: "Name", render: (_: unknown, r: JoinRequest) => r.requester?.name ?? "—" },
            { title: "Email", dataIndex: "requester_email" },
            {
              title: "",
              key: "actions",
              align: "right" as const,
              render: (_: unknown, r: JoinRequest) => (
                <>
                  <Button type="primary" size="small" onClick={() => openApprove(r)} style={{ marginRight: 8 }}>
                    Approve
                  </Button>
                  <Button size="small" danger onClick={() => onReject(r)}>
                    Reject
                  </Button>
                </>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={Boolean(approving)}
        title="Approve join request"
        onCancel={() => setApproving(null)}
        onOk={confirmApprove}
        okText="Approve & add"
        confirmLoading={decide.isPending}
      >
        <Paragraph type="secondary">
          Add <b>{approving?.requester?.name ?? approving?.requester_email}</b> to a workspace and role.
        </Paragraph>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Workspace</div>
            <Select
              style={{ width: "100%" }}
              placeholder="Choose a workspace"
              value={teamId}
              onChange={(v) => { setTeamId(v); setRoleId(undefined); }}
              options={(teams ?? []).map((t) => ({ value: t.id, label: t.name }))}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Role</div>
            <Select
              style={{ width: "100%" }}
              placeholder="Default: Member"
              value={roleId}
              onChange={setRoleId}
              options={(roles ?? []).map((r) => ({
                value: r.id,
                label: r.default_role ? `${r.name} (default)` : r.name,
              }))}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Note (optional)</div>
            <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything to record…" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
