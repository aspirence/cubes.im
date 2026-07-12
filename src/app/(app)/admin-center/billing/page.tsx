"use client";

import { useState } from "react";
import { App, Button, Card, InputNumber, Slider, Skeleton, Tag, Typography, theme } from "antd";
import {
  usePlatformPricing,
  useTeamSubscription,
  useUpdateTeamStorage,
  computeMonthlyCents,
  money,
} from "@/features/billing/use-pricing";

const { Title, Text } = Typography;

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
  const update = useUpdateTeamStorage();

  // Local edit (null until touched); until then show the saved value.
  const [gbEdit, setGbEdit] = useState<number | null>(null);

  if (pLoading || sLoading || !pricing) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  const cur = pricing.currency;
  const storage = gbEdit ?? sub?.storage_gb ?? pricing.base_storage_gb;
  const monthly = computeMonthlyCents(pricing, storage);
  const extraGb = Math.max(0, storage - pricing.base_storage_gb);
  const dirty = storage !== (sub?.storage_gb ?? pricing.base_storage_gb);

  const save = async () => {
    try {
      await update.mutateAsync(storage);
      message.success("Storage plan updated.");
    } catch {
      message.error("Only a team admin can change billing.");
    }
  };

  const maxGb = Math.max(1000, pricing.base_storage_gb * 10);

  return (
    <div style={{ maxWidth: 860, display: "grid", gap: 16 }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>Billing</Title>
        <Text type="secondary">
          One simple plan — unlimited team members. You only pay more as you need more storage.
        </Text>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16 }} className="bl-grid">
        {/* Plan + benefits */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: token.colorText }}>Cubes</span>
            <Tag color="green" style={{ margin: 0 }}>Active</Tag>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>
              {money(pricing.base_price_cents, cur)}
            </span>
            <span style={{ color: token.colorTextTertiary }}>/ month base</span>
          </div>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Unlimited members · {pricing.base_storage_gb} GB included
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
            <Row label={`Base (${pricing.base_storage_gb} GB, unlimited members)`} value={money(pricing.base_price_cents, cur)} token={token} />
            <Row
              label={`Extra storage (${extraGb} GB × ${money(pricing.price_per_gb_cents, cur)})`}
              value={money(extraGb * pricing.price_per_gb_cents, cur)}
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

          <Button type="primary" block style={{ marginTop: 14 }} loading={update.isPending} disabled={!dirty} onClick={save}>
            {dirty ? "Update plan" : "Saved"}
          </Button>
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
