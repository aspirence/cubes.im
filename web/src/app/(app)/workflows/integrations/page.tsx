"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useIsTeamAdmin } from "@/features/team-members/use-team-members";
import {
  metaConnectUrl,
  useMetaIntegration,
  useMetaMutations,
  useMetaStatus,
  type MetaAdAccountRow,
} from "@/features/workflows/use-meta-ads";

/**
 * Workflows → Integrations: the outside services workflow steps can read from.
 * For now that is Meta Ads (Facebook Ads Manager), used by the
 * "Meta Ads: get insights" step. An admin connects with Facebook, then chooses
 * which of the shared ad accounts workflows may read.
 */

/** Facebook's account_status codes worth naming (1 = active is the quiet case). */
const ACCOUNT_STATUS: Record<number, { label: string; color: string }> = {
  2: { label: "Disabled", color: "red" },
  3: { label: "Unsettled", color: "orange" },
  7: { label: "Pending review", color: "gold" },
  9: { label: "In grace period", color: "gold" },
  100: { label: "Pending closure", color: "orange" },
  101: { label: "Closed", color: "default" },
};

/** What a ?meta=error&reason=… from the callback means, in words. */
const CONNECT_ERRORS: Record<string, string> = {
  access_denied: "You cancelled in the Facebook dialog — nothing was connected.",
  not_configured: "The Facebook app isn't configured on this server yet (see the setup steps below).",
  forbidden: "Only workspace admins can connect Facebook.",
  no_ad_accounts:
    "That Facebook login can't see any ad accounts. Connect again and share at least one ad account in the dialog.",
  invalid_token: "Facebook didn't accept the login. Try connecting again.",
  state_mismatch: "The login took too long or was opened in another browser. Try again.",
  bad_state: "The login took too long or was opened in another browser. Try again.",
  session_changed: "You were signed out or switched accounts during the login. Try again.",
  save_failed: "Facebook connected, but saving the connection failed. Try again.",
};

function MetaSetupSteps({ redirectUri }: { redirectUri: string | null }) {
  return (
    <ol style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.8 }}>
      <li>
        At <Typography.Link href="https://developers.facebook.com/apps" target="_blank">developers.facebook.com/apps</Typography.Link>{" "}
        create an app of type <b>Business</b>, owned by your Business Manager.
      </li>
      <li>
        Add the products <b>Facebook Login for Business</b> and <b>Marketing API</b>.
      </li>
      <li>
        In Facebook Login for Business → Configurations, create one with token type <b>System user</b>,
        permission <b>ads_read</b> and assets <b>Ad accounts</b>.
      </li>
      <li>
        Add this valid OAuth redirect URI:{" "}
        <Typography.Text code copyable>
          {redirectUri ?? "https://<your-domain>/api/integrations/meta/callback"}
        </Typography.Text>
      </li>
      <li>
        Set <Typography.Text code>META_APP_ID</Typography.Text>, <Typography.Text code>META_APP_SECRET</Typography.Text>{" "}
        and <Typography.Text code>META_LOGIN_CONFIG_ID</Typography.Text> on the server and redeploy.
      </li>
    </ol>
  );
}

function IntegrationsPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const router = useRouter();
  const params = useSearchParams();
  const { data: team } = useActiveTeam();
  const isAdmin = useIsTeamAdmin();
  const { data: status } = useMetaStatus();
  const { data, isLoading, error } = useMetaIntegration();
  const { refreshAccounts, setAccountEnabled, disconnect } = useMetaMutations();

  // The callback lands here with ?meta=connected|error — say what happened once,
  // then tidy the URL so a reload doesn't repeat it.
  useEffect(() => {
    const outcome = params.get("meta");
    if (!outcome) return;
    if (outcome === "connected") {
      const n = Number(params.get("accounts") ?? 0);
      message.success(`Facebook connected — ${n} ad account${n === 1 ? "" : "s"} found.`);
    } else {
      const reason = params.get("reason") ?? "";
      message.error(CONNECT_ERRORS[reason] ?? "Facebook didn't complete the connection. Try again.");
    }
    router.replace("/workflows/integrations", { scroll: false });
  }, [params, message, router]);

  const configured = status?.configured ?? false;
  const notReady = data?.notReady ?? false;
  const connections = data?.connections ?? [];
  const canConnect = isAdmin && configured && !notReady && Boolean(team?.id);

  const accountColumns: ColumnsType<MetaAdAccountRow> = [
    {
      title: "Ad account",
      key: "name",
      render: (_, a) => (
        <div>
          <div style={{ fontWeight: 600 }}>{a.name}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {a.external_id.replace(/^act_/, "")}
            {a.business_name ? ` · ${a.business_name}` : ""}
          </Typography.Text>
        </div>
      ),
    },
    { title: "Currency", dataIndex: "currency", key: "currency", width: 100, render: (v) => v ?? "—" },
    { title: "Timezone", dataIndex: "timezone_name", key: "tz", width: 170, render: (v) => v ?? "—" },
    {
      title: "Status",
      key: "status",
      width: 140,
      render: (_, a) => {
        const s = a.account_status != null ? ACCOUNT_STATUS[a.account_status] : undefined;
        return s ? <Tag color={s.color}>{s.label}</Tag> : <Tag color="green">Active</Tag>;
      },
    },
    {
      title: (
        <Tooltip title="Workflows only read the ad accounts switched on here.">
          <span>Use in workflows</span>
        </Tooltip>
      ),
      key: "enabled",
      width: 150,
      render: (_, a) => (
        <Switch
          size="small"
          checked={a.enabled}
          disabled={!isAdmin}
          loading={setAccountEnabled.isPending && setAccountEnabled.variables?.accountId === a.id}
          onChange={(enabled) =>
            setAccountEnabled.mutate(
              { accountId: a.id, enabled },
              { onError: (e) => message.error(e instanceof Error ? e.message : "Could not update the account.") },
            )
          }
        />
      ),
    },
  ];

  return (
    <Card>
      <div style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Integrations
        </Typography.Title>
        <Typography.Text type="secondary">
          Outside services your workflow steps can read from.
          {isAdmin ? "" : " Only workspace admins can connect or change them."}
        </Typography.Text>
      </div>

      <div
        style={{
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <Space align="start" size={12}>
            <span
              className="material-symbols-rounded"
              aria-hidden
              style={{
                fontSize: 22,
                lineHeight: 1,
                width: 40,
                height: 40,
                borderRadius: 10,
                display: "grid",
                placeItems: "center",
                background: "#e7f0fe",
                color: "#1877f2",
              }}
            >
              ads_click
            </span>
            <div>
              <Typography.Text strong style={{ fontSize: 15 }}>
                Meta Ads (Facebook Ads Manager)
              </Typography.Text>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  Lets the <b>Meta Ads: get insights</b> step read daily spend, reach, clicks, results and more.
                  Where the rows go next is up to each workflow.
                </Typography.Text>
              </div>
            </div>
          </Space>
          <Tooltip
            title={
              !isAdmin
                ? "Only workspace admins can connect Facebook."
                : !configured
                  ? "The Facebook app isn't configured on this server yet."
                  : notReady
                    ? "The database update for Meta Ads hasn't been applied yet."
                    : undefined
            }
          >
            <Button
              type="primary"
              disabled={!canConnect}
              style={canConnect ? { background: "#1877f2" } : undefined}
              href={canConnect && team?.id ? metaConnectUrl(team.id, "/workflows/integrations") : undefined}
            >
              {connections.length ? "Connect another" : "Continue with Facebook"}
            </Button>
          </Tooltip>
        </div>

        {status && !configured ? (
          <Alert
            style={{ marginTop: 14 }}
            type="warning"
            showIcon
            message="One-time setup: the Facebook app"
            description={<MetaSetupSteps redirectUri={status.redirectUri} />}
          />
        ) : null}
        {notReady ? (
          <Alert
            style={{ marginTop: 14 }}
            type="warning"
            showIcon
            message="Database update needed"
            description="Apply migration 20261151000000_meta_ads_connections.sql to this workspace's database to store Facebook connections."
          />
        ) : null}
        {error ? (
          <Alert style={{ marginTop: 14 }} type="error" showIcon message="Couldn't load the Facebook connections." />
        ) : null}

        {!notReady && !isLoading && connections.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Not connected yet."
            style={{ margin: "18px 0 4px" }}
          />
        ) : null}

        {connections.map((c) => {
          const expires = c.token_kind === "user" && c.token_expires_at ? dayjs(c.token_expires_at) : null;
          const expiringSoon = expires ? expires.diff(dayjs(), "day") < 10 : false;
          const broken = Boolean(c.revoked_at) || c.last_test_ok === false;
          return (
            <div
              key={c.id}
              style={{ marginTop: 16, borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 14 }}
            >
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
              >
                <Space size={8} wrap>
                  <Typography.Text strong>{c.meta_user_name ?? `Facebook ${c.meta_user_id}`}</Typography.Text>
                  {c.token_kind === "system_user" ? (
                    <Tag color="blue">System user · doesn&rsquo;t expire</Tag>
                  ) : expires ? (
                    <Tag color={expiringSoon ? "orange" : "default"}>Expires {expires.format("D MMM YYYY")}</Tag>
                  ) : null}
                  {broken ? (
                    <Tag color="red">Needs reconnecting</Tag>
                  ) : c.last_test_ok ? (
                    <Tag color="green">Working</Tag>
                  ) : null}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {c.accounts.length} ad account{c.accounts.length === 1 ? "" : "s"}
                    {c.last_test_at ? ` · checked ${dayjs(c.last_test_at).format("D MMM, h:mm A")}` : ""}
                  </Typography.Text>
                </Space>
                {isAdmin ? (
                  <Space>
                    <Button
                      size="small"
                      loading={refreshAccounts.isPending && refreshAccounts.variables === c.id}
                      onClick={() =>
                        refreshAccounts.mutate(c.id, {
                          onSuccess: (r) => message.success(`Ad accounts refreshed — ${r.accounts ?? 0} found.`),
                          onError: (e) => message.error(e instanceof Error ? e.message : "Refresh failed."),
                        })
                      }
                    >
                      Refresh accounts
                    </Button>
                    {broken || expiringSoon ? (
                      <Button size="small" href={team?.id ? metaConnectUrl(team.id, "/workflows/integrations") : undefined}>
                        Reconnect
                      </Button>
                    ) : null}
                    <Popconfirm
                      title="Disconnect Facebook?"
                      description="Workflow steps reading these ad accounts will fail until Facebook is connected again."
                      okText="Disconnect"
                      okButtonProps={{ danger: true }}
                      onConfirm={() =>
                        disconnect.mutate(c.id, {
                          onSuccess: () => message.success("Facebook disconnected."),
                          onError: (e) => message.error(e instanceof Error ? e.message : "Disconnect failed."),
                        })
                      }
                    >
                      <Button size="small" danger loading={disconnect.isPending && disconnect.variables === c.id}>
                        Disconnect
                      </Button>
                    </Popconfirm>
                  </Space>
                ) : null}
              </div>
              {c.last_test_error && broken ? (
                <Typography.Text type="danger" style={{ fontSize: 12, display: "block", marginTop: 6 }}>
                  {c.last_test_error}
                </Typography.Text>
              ) : null}
              <Table<MetaAdAccountRow>
                style={{ marginTop: 10 }}
                size="small"
                rowKey="id"
                columns={accountColumns}
                dataSource={c.accounts}
                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                scroll={{ x: "max-content" }}
              />
            </div>
          );
        })}

        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, margin: "14px 0 0" }}>
          Use it in a workflow: add the <b>Meta Ads: get insights</b> step, pick ad accounts, a level and dates. Later
          steps receive the rows as <Typography.Text code>{"{{steps.<key>.rows}}"}</Typography.Text> — for example an{" "}
          HTTP step that posts them to a Google Apps Script, Zapier or Make.{" "}
          <Link href="/workflows">Open workflows</Link>
        </Typography.Paragraph>
      </div>
    </Card>
  );
}

export default function WorkflowIntegrationsPage() {
  // useSearchParams needs a Suspense boundary in a client page.
  return (
    <Suspense fallback={null}>
      <IntegrationsPage />
    </Suspense>
  );
}
