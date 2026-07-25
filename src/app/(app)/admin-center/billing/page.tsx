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
  const { data: details, isError: detailsError, refetch: refreshDetails } = useSubscriptionDetails(teamId);
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
  // Storage can never go below the included allotment — floor every source
  // (slider, manual box, or stored value) at base_storage_gb.
  const rawGb = gbEdit ?? sub?.storage_gb ?? pricing.base_storage_gb;
  const storage = Math.max(pricing.base_storage_gb, Math.round(rawGb || pricing.base_storage_gb));
  const seats = Math.max(1, (members ?? []).filter((m) => m.user && m.member_type !== "guest").length);
  const monthly = computeMonthlyCents(pricing, storage, seats);
  const seatsCents = seats * pricing.price_per_user_cents;
  const extraGb = Math.max(0, storage - pricing.base_storage_gb);
  const maxGb = Math.max(1000, pricing.base_storage_gb * 10);

  // Fail-SAFE subscribed flag: only treat as NOT subscribed when Dodo positively
  // says so. If we couldn't reach Dodo (undefined/error) but our DB has a Dodo
  // customer, assume subscribed — never expose the "start trial" CTA to a payer.
  const hasCustomer = Boolean(sub?.dodo_customer_id);
  const detailsUnknown = details == null || detailsError;
  const subscribed = details?.subscribed === true || (detailsUnknown && hasCustomer);
  // We can't confirm live state (Dodo unreachable) yet the team is a customer.
  const stateUnknown = detailsUnknown && hasCustomer;

  const inTrial =
    subscribed &&
    Boolean(details?.trial_period_days) &&
    (details?.payments ?? []).length === 0 &&
    !details?.previous_billing_date;
  const chip = statusChip(details, sub?.status ?? "active", inTrial);
  const canceling = Boolean(details?.cancel_at_period_end || sub?.cancel_at_period_end);
  const dodoStatus = details?.status ?? sub?.status ?? "active";
  const isDead = ["cancelled", "canceled", "failed", "expired"].includes(dodoStatus) && !canceling;
  const pastDue = ["on_hold", "paused"].includes(dodoStatus);
  // Prefer Dodo's live next-billing date; the stale DB mirror only backs a live sub.
  const periodEnd = details?.next_billing_date ?? (isDead ? null : sub?.current_period_end) ?? null;
  const periodStart = details?.previous_billing_date ?? null;
  // The real recurring amount from Dodo once subscribed; the estimate before.
  const amountCents = subscribed && details?.amount_cents != null ? details.amount_cents : monthly;
  const amountCur = subscribed && details?.currency ? details.currency : cur;
  const taxNote = subscribed && details?.tax_inclusive === false ? " (excl. tax)" : "";
  // Prefer the Dodo-mirrored billed seats; flag when the live team count differs.
  const billedSeats = sub?.seats ?? seats;
  const seatsMismatch = sub?.seats != null && sub.seats !== seats;
  const savedStorage = Math.max(pricing.base_storage_gb, sub?.storage_gb ?? pricing.base_storage_gb);
  const planLabel = subscribed ? "Cubes · Cloud" : "Cubes · Free";
  const payments = details?.payments ?? [];

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
      // Guard against double-subscribing: if this team already has a Dodo
      // customer, never start a fresh checkout — send them to manage billing.
      if (hasCustomer) {
        message.info("You already have a subscription — opening billing management.");
        await openPortal();
        return;
      }
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, storageGb: storage }),
      });
      const json = await res.json();
      if (res.ok && json.checkout_url) {
        window.location.assign(json.checkout_url);
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
      if (res.ok && json.url) window.location.assign(json.url);
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

      {/* Past-due: needs an action, not just a chip. */}
      {pastDue ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderRadius: 12,
            background: token.colorErrorBg,
            border: `1px solid ${token.colorErrorBorder}`,
          }}
        >
          <MIcon name="error" size={20} color={token.colorError} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: token.colorText }}>Payment past due</div>
            <div style={{ fontSize: 12.5, color: token.colorTextSecondary }}>
              Your last charge didn&apos;t go through. Update your payment method to keep your subscription active.
            </div>
          </div>
          <Button danger type="primary" onClick={openPortal} icon={<MIcon name="credit_card" size={16} />}>
            Update payment method
          </Button>
        </div>
      ) : null}

      {/* Couldn't confirm live state — keep the payer's controls, warn softly. */}
      {stateUnknown ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 12,
            background: token.colorWarningBg,
            border: `1px solid ${token.colorWarningBorder}`,
            fontSize: 12.5,
            color: token.colorTextSecondary,
          }}
        >
          <MIcon name="sync_problem" size={18} color={token.colorWarning} />
          Couldn&apos;t reach the billing provider just now — showing your last known state. Refresh in a moment.
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16 }} className="bl-grid">
        {/* Current subscription — a labeled summary of the FACTS. */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: token.colorText }}>{planLabel}</span>
            <Tag color={chip.color} style={{ margin: 0 }}>{chip.label}</Tag>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>
              {money(subscribed ? amountCents : pricing.price_per_user_cents, amountCur)}
            </span>
            <span style={{ color: token.colorTextTertiary }}>
              {subscribed ? `/ month${taxNote}` : "/ user / month"}
            </span>
          </div>

          {/* Fact grid — what you're actually billed for. */}
          <div style={{ marginTop: 14, display: "grid", gap: 2 }}>
            <FactRow label="Status" token={token}>
              <Tag color={chip.color} style={{ margin: 0 }}>{chip.label}</Tag>
            </FactRow>
            <FactRow label="Billed seats" token={token}>
              <span>
                {billedSeats} {billedSeats === 1 ? "seat" : "seats"}
                {seatsMismatch ? (
                  <Text type="warning" style={{ fontSize: 11.5, marginLeft: 6 }}>
                    · team now has {seats} (syncs on next change)
                  </Text>
                ) : null}
              </span>
            </FactRow>
            <FactRow label="Storage" token={token}>{savedStorage} GB</FactRow>
            {subscribed && periodStart && periodEnd ? (
              <FactRow label="Current period" token={token}>
                {fmtDate(periodStart)} – {fmtDate(periodEnd)}
              </FactRow>
            ) : null}
            {subscribed && !isDead ? (
              <FactRow label={canceling ? "Access until" : inTrial ? "Trial ends" : "Next charge"} token={token}>
                {canceling || inTrial ? (
                  fmtDate(periodEnd)
                ) : periodEnd ? (
                  <span>
                    <b>{money(amountCents, amountCur)}</b> on {fmtDate(periodEnd)}
                  </span>
                ) : (
                  "—"
                )}
              </FactRow>
            ) : null}
          </div>

          {subscribed ? (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <Button onClick={openPortal} icon={<MIcon name="receipt_long" size={16} />}>
                Manage billing
              </Button>
              {canceling ? (
                <Button type="primary" loading={cancelSub.isPending} onClick={doResume} icon={<MIcon name="autorenew" size={16} />}>
                  Resume subscription
                </Button>
              ) : isDead ? (
                <Button type="primary" onClick={openPortal} icon={<MIcon name="autorenew" size={16} />}>
                  Reactivate
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

        {/* Change plan — storage → estimated price (NOT the billed amount) */}
        <Card title={subscribed ? "Change plan" : "Choose your plan"}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Set how much storage your team needs. {pricing.base_storage_gb} GB is included; extra is{" "}
            {money(pricing.price_per_gb_cents, cur)}/GB.
          </Text>
          <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
            <Slider min={pricing.base_storage_gb} max={maxGb} step={10} value={storage} onChange={(v) => setGbEdit(v)} style={{ flex: 1 }} />
            <InputNumber
              addonAfter="GB"
              min={pricing.base_storage_gb}
              step={10}
              value={rawGb}
              onChange={(v) => setGbEdit(v ?? pricing.base_storage_gb)}
              // Snap anything below the floor back up when the field loses focus.
              onBlur={() => setGbEdit(storage)}
              style={{ width: 140 }}
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
            <Row label={`Members (${seats} × ${money(pricing.price_per_user_cents, cur)})`} value={money(seatsCents, cur)} token={token} />
            <Row
              label={`Extra storage (${extraGb} GB × ${money(pricing.price_per_gb_cents, cur)})`}
              value={money(storageOverageCents(pricing, storage), cur)}
              token={token}
            />
            <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, margin: "10px 0" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontWeight: 700, color: token.colorText }}>
                {subscribed ? "Estimated total" : "Your monthly total"}
              </span>
              <span style={{ fontSize: 22, fontWeight: 800, color: token.colorText }}>
                {money(monthly, cur)}<span style={{ fontSize: 13, fontWeight: 500, color: token.colorTextTertiary }}> /mo</span>
              </span>
            </div>
            {subscribed ? (
              <Text type="secondary" style={{ fontSize: 11.5, display: "block", marginTop: 6 }}>
                Estimate for the selected options. Your actual charge is{" "}
                <b style={{ color: token.colorText }}>{money(amountCents, amountCur)}{taxNote}</b> — taxes and
                proration are settled by the payment provider.
              </Text>
            ) : null}
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

      {/* Invoices & receipts — full transparency for the buyer. */}
      {subscribed ? (
        <Card
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <MIcon name="receipt_long" size={18} /> Invoices & receipts
            </span>
          }
          extra={
            <Button size="small" onClick={openPortal} icon={<MIcon name="open_in_new" size={14} />}>
              Billing portal
            </Button>
          }
        >
          {details?.payments_error ? (
            <div style={{ padding: "20px 8px", textAlign: "center", color: token.colorTextSecondary }}>
              <MIcon name="cloud_off" size={22} color={token.colorTextQuaternary} />
              <div style={{ fontSize: 13, marginTop: 6 }}>Couldn&apos;t load your invoices right now.</div>
              <Button size="small" style={{ marginTop: 10 }} onClick={() => refreshDetails()}>
                Retry
              </Button>
            </div>
          ) : payments.length === 0 ? (
            <div style={{ padding: "24px 8px", textAlign: "center" }}>
              <MIcon name="request_quote" size={26} color={token.colorTextQuaternary} />
              <div style={{ fontSize: 13.5, color: token.colorText, fontWeight: 600, marginTop: 6 }}>
                No invoices yet
              </div>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                Your first invoice appears here after your trial converts to a paid charge.
              </Text>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 560 }}>
                {/* header */}
                <div className="bl-inv-row bl-inv-head" style={{ color: token.colorTextTertiary, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                  <span>Date</span>
                  <span>Invoice</span>
                  <span>Status</span>
                  <span style={{ textAlign: "right" }}>Amount</span>
                  <span style={{ textAlign: "right" }}>Receipt</span>
                </div>
                {payments.map((p) => {
                  const ok = p.status === "succeeded";
                  const failed = p.status === "failed";
                  const href = p.invoice_url
                    ? p.invoice_url
                    : `/api/billing/invoice?teamId=${teamId}&paymentId=${encodeURIComponent(p.id)}`;
                  return (
                    <div
                      key={p.id}
                      className="bl-inv-row"
                      style={{ borderBottom: `1px solid ${token.colorSplit}`, fontSize: 13.5 }}
                    >
                      <span style={{ color: token.colorText }}>{fmtDate(p.created_at)}</span>
                      <span style={{ color: token.colorTextSecondary, fontFamily: "var(--font-geist-mono), monospace", fontSize: 12 }}>
                        {p.invoice_id || "—"}
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <MIcon
                          name={ok ? "check_circle" : failed ? "cancel" : "schedule"}
                          size={16}
                          color={ok ? token.colorSuccess : failed ? token.colorError : token.colorTextTertiary}
                        />
                        <span style={{ color: token.colorTextSecondary, textTransform: "capitalize" }}>{p.status || "—"}</span>
                      </span>
                      <span style={{ textAlign: "right", fontWeight: 700, color: token.colorText }}>
                        {money(p.amount, p.currency)}
                      </span>
                      <span style={{ textAlign: "right" }}>
                        {ok ? (
                          <a href={href} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: token.colorPrimary, fontWeight: 600 }}>
                            <MIcon name="download" size={15} /> PDF
                          </a>
                        ) : (
                          <span style={{ color: token.colorTextQuaternary }}>—</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <Text type="secondary" style={{ fontSize: 11.5, display: "block", marginTop: 12 }}>
            Each receipt is the official invoice PDF. Amounts shown are the totals actually charged (incl. tax).
          </Text>
        </Card>
      ) : null}

      {!details?.configured ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          Payments aren&apos;t set up in this environment yet — amounts are illustrative.
        </Text>
      ) : null}

      <style>{`
        @media(max-width:820px){.bl-grid{grid-template-columns:1fr !important;}}
        .bl-inv-row{display:grid;grid-template-columns:1.2fr 1.4fr 1fr 0.9fr 0.8fr;gap:12px;align-items:center;padding:10px 4px;}
        .bl-inv-head{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:8px 4px;}
      `}</style>
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

/** A labeled fact line in the current-subscription card (label left, value right). */
function FactRow({
  label,
  children,
  token,
}: {
  label: string;
  children: React.ReactNode;
  token: { colorTextTertiary: string; colorText: string; colorSplit: string };
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        padding: "7px 0",
        borderTop: `1px solid ${token.colorSplit}`,
        fontSize: 13,
      }}
    >
      <span style={{ color: token.colorTextTertiary }}>{label}</span>
      <span style={{ color: token.colorText, fontWeight: 600, textAlign: "right" }}>{children}</span>
    </div>
  );
}
