"use client";

import { useState } from "react";
import { App, Button, Card, Input, InputNumber, Result, Select, Skeleton, Typography, theme } from "antd";
import {
  useIsPlatformAdmin,
  usePlatformPricing,
  useUpdatePlatformPricing,
  computeMonthlyCents,
  money,
  type PlatformPricing,
} from "@/features/billing/use-pricing";

const { Title, Text } = Typography;

function MIcon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1 }}>
      {name}
    </span>
  );
}

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AUD", "CAD"];

export default function PricingAdminPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { data: isAdmin, isLoading: adminLoading } = useIsPlatformAdmin();
  const { data: saved, isLoading } = usePlatformPricing();
  const update = useUpdatePlatformPricing();

  // Local edits (null until touched); show the saved config until then.
  const [edit, setEdit] = useState<PlatformPricing | null>(null);
  const [previewGb, setPreviewGb] = useState(250);
  const form = edit ?? saved;

  if (adminLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (!isAdmin) {
    return (
      <Result
        status="403"
        title="Super-admins only"
        subTitle="You need to be a platform super-admin to view this page."
      />
    );
  }
  if (isLoading || !form) return <Skeleton active paragraph={{ rows: 6 }} />;

  const patch = (p: Partial<PlatformPricing>) => setEdit({ ...form, ...p });
  const cur = form.currency;

  const save = async () => {
    try {
      await update.mutateAsync({ ...form, benefits: form.benefits.map((b) => b.trim()).filter(Boolean) });
      message.success("Pricing updated — it's live everywhere now.");
    } catch {
      message.error("Couldn't save. You must be a super-admin.");
    }
  };

  const field: React.CSSProperties = { display: "grid", gap: 6, marginBottom: 16 };
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: token.colorText };
  const hint: React.CSSProperties = { fontSize: 12, color: token.colorTextTertiary };

  return (
    <div style={{ maxWidth: 900, display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Pricing</Title>
          <Text type="secondary">
            Super-admin controls for the global plan. Changes apply to every team&apos;s billing and the public pricing page instantly.
          </Text>
        </div>
        <Button type="primary" loading={update.isPending} onClick={save}>
          Save pricing
        </Button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }} className="pr-grid">
        {/* Config */}
        <Card title="Plan configuration">
          <div style={field}>
            <span style={label}>Base price / month</span>
            <span style={hint}>Includes unlimited team members + the base storage below.</span>
            <InputNumber
              addonBefore={cur}
              min={0}
              step={1}
              value={form.base_price_cents / 100}
              onChange={(v) => patch({ base_price_cents: Math.round((v ?? 0) * 100) })}
              style={{ width: 220 }}
            />
          </div>
          <div style={field}>
            <span style={label}>Base storage included</span>
            <InputNumber
              addonAfter="GB"
              min={0}
              value={form.base_storage_gb}
              onChange={(v) => patch({ base_storage_gb: v ?? 0 })}
              style={{ width: 220 }}
            />
          </div>
          <div style={field}>
            <span style={label}>Price per extra GB</span>
            <span style={hint}>Charged for every GB above the base allotment.</span>
            <InputNumber
              addonBefore={cur}
              min={0}
              step={0.01}
              value={form.price_per_gb_cents / 100}
              onChange={(v) => patch({ price_per_gb_cents: Math.round((v ?? 0) * 100) })}
              style={{ width: 220 }}
            />
          </div>
          <div style={field}>
            <span style={label}>Currency</span>
            <Select
              value={form.currency}
              onChange={(currency) => patch({ currency })}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
              style={{ width: 220 }}
            />
          </div>
        </Card>

        {/* Live calculator */}
        <Card title="Price calculator">
          <div style={field}>
            <span style={label}>Storage a team needs</span>
            <InputNumber
              addonAfter="GB"
              min={0}
              value={previewGb}
              onChange={(v) => setPreviewGb(v ?? 0)}
              style={{ width: "100%" }}
            />
          </div>
          <div
            style={{
              marginTop: 8,
              padding: 18,
              borderRadius: 14,
              background: token.colorFillQuaternary,
              border: `1px solid ${token.colorBorderSecondary}`,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 34, fontWeight: 800, color: token.colorText, letterSpacing: "-0.02em" }}>
              {money(computeMonthlyCents(form, previewGb), cur)}
              <span style={{ fontSize: 14, fontWeight: 500, color: token.colorTextTertiary }}> /mo</span>
            </div>
            <div style={hint}>
              {money(form.base_price_cents, cur)} base
              {previewGb > form.base_storage_gb
                ? ` + ${previewGb - form.base_storage_gb} GB × ${money(form.price_per_gb_cents, cur)}`
                : ""}
            </div>
          </div>
        </Card>
      </div>

      {/* Benefits */}
      <Card
        title="Benefits shown on pricing"
        extra={
          <Button size="small" icon={<MIcon name="add" size={15} />} onClick={() => patch({ benefits: [...form.benefits, ""] })}>
            Add benefit
          </Button>
        }
      >
        {form.benefits.length === 0 ? (
          <Text type="secondary">No benefits yet — add a few to show on the pricing page.</Text>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {form.benefits.map((b, i) => (
              <div key={i} style={{ display: "flex", gap: 8 }}>
                <Input
                  value={b}
                  placeholder="e.g. Unlimited projects"
                  onChange={(e) => {
                    const next = [...form.benefits];
                    next[i] = e.target.value;
                    patch({ benefits: next });
                  }}
                />
                <Button
                  danger
                  type="text"
                  icon={<MIcon name="delete" size={17} />}
                  onClick={() => patch({ benefits: form.benefits.filter((_, j) => j !== i) })}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <style>{`@media(max-width:820px){.pr-grid{grid-template-columns:1fr !important;}}`}</style>
    </div>
  );
}
