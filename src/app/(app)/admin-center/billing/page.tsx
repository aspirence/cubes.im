"use client";

import { useState } from "react";
import { App, Button, Card, InputNumber, Slider, Skeleton, Tag, Typography, theme } from "antd";
import {
  usePlatformPricing,
  useTeamSubscription,
  useUpdateTeamStorage,
  computeMonthlyCents,
  storageOverageCents,
  money,
} from "@/features/billing/use-pricing";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useActiveTeam } from "@/features/teams/use-teams";

const { Title, Text } = Typography;

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  active: { color: "green", label: "Active" },
  paused: { color: "orange", label: "Past due" },
  canceled: { color: "red", label: "Canceled" },
};

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

export default function AdminBillingPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { data: pricing, isLoading: pLoading } = usePlatformPricing();
  const { data: sub, isLoading: sLoading } = useTeamSubscription();
  const { data: members } = useTeamMembers();
  const { data: activeTeam } = useActiveTeam();
  const update = useUpdateTeamStorage();

  // Local edit (null until touched); until then show the saved value.
  const [gbEdit, setGbEdit] = useState<number | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  if (pLoading || sLoading || !pricing) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  const cur = pricing.currency;
  const storage = gbEdit ?? sub?.storage_gb ?? pricing.base_storage_gb;
  // Billable seats = active, non-guest members.
  const seats = Math.max(
    1,
    (members ?? []).filter((m) => m.user && m.member_type !== "guest").length,
  );
  const monthly = computeMonthlyCents(pricing, storage, seats);
  const seatsCents = seats * pricing.price_per_user_cents;
  const extraGb = Math.max(0, storage - pricing.base_storage_gb);

  const teamId = activeTeam?.id;
  const hasSubscription = Boolean(sub?.dodo_customer_id);

  // Start a Dodo checkout for the chosen plan; if payments aren't configured yet
  // fall back to saving the storage choice (illustrative, no charge).
  const startCheckout = async () => {
    if (!teamId) return;
    setCheckingOut(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, storageGb: storage }),
      });
      const json = await res.json();
      if (res.ok && json.checkout_url) {
        window.location.href = json.checkout_url;
        return;
      }
      if (json.error === "not_configured") {
        await update.mutateAsync(storage);
        message.success("Storage plan updated.");
        return;
      }
      message.error(json.error || "Couldn't start checkout.");
    } catch {
      message.error("Couldn't start checkout.");
    } finally {
      setCheckingOut(false);
    }
  };

  const openPortal = async () => {
    if (!teamId) return;
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      const json = await res.json();
      if (res.ok && json.url) window.location.href = json.url;
      else message.error(json.error || "Couldn't open the billing portal.");
    } catch {
      message.error("Couldn't open the billing portal.");
    }
  };

  const maxGb = Math.max(1000, pricing.base_storage_gb * 10);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>Billing</Title>
        <Text type="secondary">
          Per-user pricing — {money(pricing.price_per_user_cents, cur)} per user / month, with{" "}
          {pricing.base_storage_gb} GB storage included. Buy extra storage anytime.
        </Text>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16 }} className="bl-grid">
        {/* Plan + benefits */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: token.colorText }}>Cubes</span>
            <Tag color={(STATUS_TAG[sub?.status ?? "active"] ?? STATUS_TAG.active).color} style={{ margin: 0 }}>
              {(STATUS_TAG[sub?.status ?? "active"] ?? STATUS_TAG.active).label}
            </Tag>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>
              {money(pricing.price_per_user_cents, cur)}
            </span>
            <span style={{ color: token.colorTextTertiary }}>/ user / month</span>
          </div>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {seats} {seats === 1 ? "member" : "members"} · {pricing.base_storage_gb} GB included
          </Text>
          <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, margin: "14px 0" }} />
          <div style={{ display: "grid", gap: 9 }}>
            {pricing.benefits.map((b) => (
              <div key={b} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5, color: token.colorTextSecondary }}>
                <MIcon name="check_circle" size={17} color={token.colorSuccess} />
                {b}
              </div>
            ))}
          </div>
        </Card>

        {/* Storage → price */}
        <Card title="Storage">
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Set how much storage your team needs. {pricing.base_storage_gb} GB is included; extra is{" "}
            {money(pricing.price_per_gb_cents, cur)}/GB.
          </Text>
          <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
            <Slider
              min={pricing.base_storage_gb}
              max={maxGb}
              step={10}
              value={storage}
              onChange={(v) => setGbEdit(v)}
              style={{ flex: 1 }}
            />
            <InputNumber
              addonAfter="GB"
              min={0}
              value={storage}
              onChange={(v) => setGbEdit(v ?? 0)}
              style={{ width: 130 }}
            />
          </div>

          <div
            style={{
              marginTop: 16,
              padding: 16,
              borderRadius: 12,
              background: token.colorFillQuaternary,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            {pricing.base_price_cents > 0 ? (
              <Row label="Platform fee" value={money(pricing.base_price_cents, cur)} token={token} />
            ) : null}
            <Row
              label={`Members (${seats} × ${money(pricing.price_per_user_cents, cur)})`}
              value={money(seatsCents, cur)}
              token={token}
            />
            <Row
              label={`Extra storage (${extraGb} GB × ${money(pricing.price_per_gb_cents, cur)})`}
              value={money(storageOverageCents(pricing, storage), cur)}
              token={token}
            />
            <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, margin: "10px 0" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontWeight: 700, color: token.colorText }}>Total</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: token.colorText }}>
                {money(monthly, cur)}<span style={{ fontSize: 13, fontWeight: 500, color: token.colorTextTertiary }}> /mo</span>
              </span>
            </div>
          </div>

          <Button
            type="primary"
            block
            style={{ marginTop: 14 }}
            loading={checkingOut || update.isPending}
            onClick={startCheckout}
            icon={<MIcon name="credit_card" size={16} />}
          >
            {hasSubscription ? "Update plan" : "Start 7-day free trial"}
          </Button>
          {hasSubscription ? (
            <Button block style={{ marginTop: 8 }} onClick={openPortal} icon={<MIcon name="receipt_long" size={16} />}>
              Manage billing &amp; invoices
            </Button>
          ) : (
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8, textAlign: "center" }}>
              7-day free trial — your card isn&apos;t charged until it ends. Cancel anytime.
            </Text>
          )}
          {sub?.current_period_end ? (
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8, textAlign: "center" }}>
              Renews {new Date(sub.current_period_end).toLocaleDateString()}
            </Text>
          ) : null}
        </Card>
      </div>

      <Text type="secondary" style={{ fontSize: 12 }}>
        Amounts are illustrative — no payment method is charged in this environment.
      </Text>

      <style>{`@media(max-width:820px){.bl-grid{grid-template-columns:1fr !important;}}`}</style>
    </div>
  );
}

function Row({ label, value, token }: { label: string; value: string; token: { colorTextSecondary: string; colorText: string } }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", fontSize: 13 }}>
      <span style={{ color: token.colorTextSecondary }}>{label}</span>
      <span style={{ color: token.colorText, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
