"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { App, Button, Card, InputNumber, Slider, Skeleton, Tag, Typography, theme } from "antd";
import {
  usePlatformPricing,
  useTeamSubscription,
  useUpdateTeamStorage,
  useSubscriptionDetails,
  useReconcileSubscription,
  useCancelSubscription,
  computeMonthlyCents,
  storageOverageCents,
  money,
} from "@/features/billing/use-pricing";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useActiveTeam } from "@/features/teams/use-teams";

const { Title, Text } = Typography;

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

/** Human status from the Dodo status + cancel flag + trial. */
function statusChip(
  details: ReturnType<typeof useSubscriptionDetails>["data"],
  fallbackStatus: string,
  inTrial: boolean,
): { color: string; label: string } {
  const s = details?.status ?? fallbackStatus;
  if (details?.cancel_at_period_end) return { color: "orange", label: "Canceling" };
  if (inTrial) return { color: "blue", label: "Free trial" };
  if (s === "active" || s === "pending") return { color: "green", label: "Active" };
  if (s === "on_hold" || s === "paused") return { color: "orange", label: "Past due" };
  if (s === "cancelled" || s === "canceled" || s === "failed" || s === "expired")
    return { color: "red", label: "Canceled" };
  return { color: "green", label: "Active" };
}

export default function AdminBillingPage() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: pricing, isLoading: pLoading } = usePlatformPricing();
  const { data: sub, isLoading: sLoading } = useTeamSubscription();
  const { data: members } = useTeamMembers();
  const { data: activeTeam } = useActiveTeam();
  const update = useUpdateTeamStorage();

  const teamId = activeTeam?.id;
  const { data: details } = useSubscriptionDetails(teamId);
  const reconcile = useReconcileSubscription(teamId);
  const cancelSub = useCancelSubscription(teamId);

  const [gbEdit, setGbEdit] = useState<number | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  // Returning from Dodo checkout: sync the new subscription into our DB now
  // (belt-and-suspenders alongside the webhook), then tidy the URL.
  const reconciledRef = useRef(false);
  useEffect(() => {
    const ok = searchParams.get("checkout") === "success";
    const subId = searchParams.get("subscription_id");
    if (ok && subId && teamId && !reconciledRef.current) {
      reconciledRef.current = true;
      reconcile.mutate(subId, {
        onSuccess: () => message.success("Subscription activated 🎉"),
        onSettled: () => router.replace("/admin-center/billing"),
      });
    }
  }, [searchParams, teamId, reconcile, router, message]);

  if (pLoading || sLoading || !pricing) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  const cur = pricing.currency;
  const storage = gbEdit ?? sub?.storage_gb ?? pricing.base_storage_gb;
  const seats = Math.max(1, (members ?? []).filter((m) => m.user && m.member_type !== "guest").length);
  const monthly = computeMonthlyCents(pricing, storage, seats);
  const seatsCents = seats * pricing.price_per_user_cents;
  const extraGb = Math.max(0, storage - pricing.base_storage_gb);
  const maxGb = Math.max(1000, pricing.base_storage_gb * 10);

  const subscribed = details?.subscribed ?? Boolean(sub?.dodo_customer_id);
  const inTrial =
    subscribed &&
    Boolean(details?.trial_period_days) &&
    (details?.payments ?? []).length === 0 &&
    !details?.previous_billing_date;
  const chip = statusChip(details, sub?.status ?? "active", inTrial);
  const periodEnd = details?.next_billing_date ?? sub?.current_period_end ?? null;
  const canceling = Boolean(details?.cancel_at_period_end || sub?.cancel_at_period_end);
  const dateLabel = inTrial
    ? `Free trial ends ${fmtDate(periodEnd)}`
    : canceling
      ? `Access until ${fmtDate(periodEnd)}`
      : periodEnd
        ? `Renews ${fmtDate(periodEnd)}`
        : "";
  // The real recurring amount from Dodo once subscribed; the estimate before.
  const amountCents = subscribed && details?.amount_cents != null ? details.amount_cents : monthly;
  const amountCur = subscribed && details?.currency ? details.currency : cur;

  const startCheckout = async () => {
    if (!teamId) return;
    setCheckingOut(true);
    try {
      if (subscribed) {
        await update.mutateAsync(storage);
        const res = await fetch("/api/billing/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId }),
        });
        const json = await res.json();
        if (res.ok && json.ok) {
          message.success("Plan updated — billing adjusted for your usage.");
          reconcile.reset();
          return;
        }
        message.error(json.error || "Couldn't update the plan.");
        return;
      }
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

  const doCancel = () =>
    modal.confirm({
      title: "Cancel subscription?",
      icon: null,
      centered: true,
      content: `Your team keeps full access until ${fmtDate(periodEnd) || "the end of the current period"}. After that it won't renew.`,
      okText: "Cancel subscription",
      okButtonProps: { danger: true },
      cancelText: "Keep it",
      onOk: async () => {
        try {
          await cancelSub.mutateAsync(false);
          message.success("Subscription set to cancel at the period end.");
        } catch (e) {
          message.error(e instanceof Error ? e.message : "Couldn't cancel.");
        }
      },
    });

  const doResume = async () => {
    try {
      await cancelSub.mutateAsync(true);
      message.success("Subscription resumed — it will keep renewing.");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Couldn't resume.");
    }
  };

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
        {/* Plan / current subscription */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: token.colorText }}>Cubes</span>
            <Tag color={chip.color} style={{ margin: 0 }}>{chip.label}</Tag>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>
              {money(subscribed ? amountCents : pricing.price_per_user_cents, amountCur)}
            </span>
            <span style={{ color: token.colorTextTertiary }}>{subscribed ? "/ month" : "/ user / month"}</span>
          </div>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {seats} {seats === 1 ? "member" : "members"} · {storage} GB
            {dateLabel ? ` · ${dateLabel}` : ""}
          </Text>

          {subscribed ? (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <Button onClick={openPortal} icon={<MIcon name="receipt_long" size={16} />}>
                Manage billing
              </Button>
              {canceling ? (
                <Button type="primary" loading={cancelSub.isPending} onClick={doResume} icon={<MIcon name="autorenew" size={16} />}>
                  Resume subscription
                </Button>
              ) : (
                <Button danger loading={cancelSub.isPending} onClick={doCancel}>
                  Cancel subscription
                </Button>
              )}
            </div>
          ) : null}

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
            <Slider min={pricing.base_storage_gb} max={maxGb} step={10} value={storage} onChange={(v) => setGbEdit(v)} style={{ flex: 1 }} />
            <InputNumber addonAfter="GB" min={0} value={storage} onChange={(v) => setGbEdit(v ?? 0)} style={{ width: 130 }} />
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
            <Row label={`Members (${seats} × ${money(pricing.price_per_user_cents, cur)})`} value={money(seatsCents, cur)} token={token} />
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

          <Button type="primary" block style={{ marginTop: 14 }} loading={checkingOut || update.isPending} onClick={startCheckout} icon={<MIcon name="credit_card" size={16} />}>
            {subscribed ? "Update plan" : "Start 7-day free trial"}
          </Button>
          {!subscribed ? (
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8, textAlign: "center" }}>
              7-day free trial — your card isn&apos;t charged until it ends. Cancel anytime.
            </Text>
          ) : null}
        </Card>
      </div>

      {/* Payment history */}
      {subscribed && (details?.payments ?? []).length > 0 ? (
        <Card title="Payment history">
          <div style={{ display: "grid", gap: 2 }}>
            {(details?.payments ?? []).map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 4px",
                  borderTop: `1px solid ${token.colorSplit}`,
                  fontSize: 13.5,
                }}
              >
                <MIcon
                  name={p.status === "succeeded" ? "check_circle" : p.status === "failed" ? "cancel" : "schedule"}
                  size={18}
                  color={p.status === "succeeded" ? token.colorSuccess : p.status === "failed" ? token.colorError : token.colorTextTertiary}
                />
                <span style={{ flex: 1, color: token.colorText }}>{fmtDate(p.created_at)}</span>
                <span style={{ color: token.colorTextTertiary, textTransform: "capitalize" }}>{p.status}</span>
                <span style={{ fontWeight: 700, color: token.colorText, minWidth: 72, textAlign: "right" }}>
                  {money(p.amount, p.currency)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {!details?.configured ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          Payments aren&apos;t set up in this environment yet — amounts are illustrative.
        </Text>
      ) : null}

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
