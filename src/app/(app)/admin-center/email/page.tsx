"use client";

import { App, Alert, Card, Result, Skeleton, Switch, Typography, theme } from "antd";
import dayjs from "dayjs";
import { useIsPlatformAdmin } from "@/features/billing/use-pricing";
import {
  useEmailTriggers,
  useSetEmailTrigger,
  type EmailTrigger,
} from "@/features/email/use-email";

const { Title, Text } = Typography;

function MIcon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/** Human labels + glyphs per seeded category. Unknown keys fall back gracefully. */
const CATEGORY_META: Record<string, { label: string; icon: string; blurb: string }> = {
  account: {
    label: "Account & access",
    icon: "key",
    blurb: "Sent when someone gains, changes, or is invited to access.",
  },
};

function categoryMeta(key: string) {
  return (
    CATEGORY_META[key] ?? {
      label: key.charAt(0).toUpperCase() + key.slice(1),
      icon: "mail",
      blurb: "",
    }
  );
}

function TriggerRow({ trigger }: { trigger: EmailTrigger }) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const setTrigger = useSetEmailTrigger();

  const onToggle = async (enabled: boolean) => {
    try {
      await setTrigger.mutateAsync({ eventKey: trigger.event_key, enabled });
      message.success(
        enabled
          ? `"${trigger.label}" can now send.`
          : `"${trigger.label}" is off for every workspace.`,
      );
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Couldn't update this scenario.",
      );
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "14px 2px",
        borderTop: `1px solid ${token.colorSplit}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: token.colorText }}>
          {trigger.label}
        </div>
        <div style={{ marginTop: 2, fontSize: 12.5, color: token.colorTextSecondary }}>
          {trigger.description}
        </div>
        <div
          style={{
            marginTop: 5,
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            color: token.colorTextQuaternary,
          }}
        >
          {trigger.event_key}
          {trigger.updated_at
            ? ` · updated ${dayjs(trigger.updated_at).format("MMM D, YYYY")}`
            : null}
        </div>
      </div>
      <Switch
        checked={trigger.enabled}
        loading={setTrigger.isPending && setTrigger.variables?.eventKey === trigger.event_key}
        onChange={onToggle}
        aria-label={`${trigger.label} — ${trigger.enabled ? "on" : "off"}`}
      />
    </div>
  );
}

/**
 * The platform-wide email console.
 *
 * This is the OUTER of two switches. Turning a scenario off here stops it for
 * every workspace on the platform, no matter how each is configured. Turning it
 * on only *permits* the send — each workspace still needs its own Resend key and
 * from-address before anything actually goes out. The two are AND-ed at send
 * time and neither can override the other, so the copy below says exactly that
 * rather than implying this page alone controls delivery.
 *
 * `useIsPlatformAdmin` here is convenience only — RLS (`is_platform_admin()`)
 * on platform_email_triggers is the real gate.
 */
export default function AdminEmailPage() {
  const { token } = theme.useToken();
  const { data: isPlatformAdmin, isLoading: adminLoading } = useIsPlatformAdmin();
  const { data: triggers, isLoading, isError, error } = useEmailTriggers();

  if (adminLoading) {
    return (
      <div style={{ padding: 4 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <Result
        status="403"
        title="Superadmins only"
        subTitle="This email console is for Cubes platform administrators."
      />
    );
  }

  const byCategory = new Map<string, EmailTrigger[]>();
  for (const t of triggers ?? []) {
    byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
  }
  const enabledCount = (triggers ?? []).filter((t) => t.enabled).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>
          Email
        </Title>
        <Text type="secondary">
          Decide which emails Cubes is allowed to send, across every workspace on
          the platform.
        </Text>
      </div>

      <Alert
        type="info"
        showIcon
        icon={<MIcon name="info" size={18} color="#4a4ad0" />}
        message="Two switches have to agree"
        description="A scenario switched off here never sends, for anyone. Switching it on only permits the send — each workspace still has to connect its own Resend key and verified from-address in the Resend app before mail actually goes out."
      />

      {isError ? (
        <Alert
          type="error"
          showIcon
          message="Couldn't load the email scenarios"
          description={error instanceof Error ? error.message : "Please try again."}
        />
      ) : isLoading ? (
        <Card>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : (triggers ?? []).length === 0 ? (
        <Card>
          <Text type="secondary">No email scenarios are registered yet.</Text>
        </Card>
      ) : (
        <>
          <Text style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
            {enabledCount} of {triggers?.length} scenarios are allowed to send.
          </Text>
          {[...byCategory.entries()].map(([category, rows]) => {
            const meta = categoryMeta(category);
            return (
              <Card key={category} styles={{ body: { padding: "16px 18px 6px" } }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 9,
                      background: token.colorPrimaryBg,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "none",
                    }}
                  >
                    <MIcon name={meta.icon} size={18} color="#4a4ad0" />
                  </span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: token.colorText }}>
                      {meta.label}
                    </div>
                    {meta.blurb ? (
                      <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                        {meta.blurb}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  {rows.map((t) => (
                    <TriggerRow key={t.event_key} trigger={t} />
                  ))}
                </div>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
