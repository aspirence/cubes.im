"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  App,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Segmented,
  Select,
  Table,
  Tooltip,
  theme,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { EChart, CHART_FONT } from "@/features/home/echart";
import {
  useCreateCrmCampaign,
  useCrmCampaignSpend,
  useCrmCampaigns,
  useDeleteCampaignSpend,
  useDestroyCrmCampaign,
  useSetCrmCampaignDeleted,
  useUpdateCrmCampaign,
  useUpsertCampaignSpend,
  type CrmCampaignPatch,
} from "@/features/app-crm/use-crm-campaigns";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import {
  CRM_CAMPAIGN_CHANNELS,
  CRM_CAMPAIGN_STATUSES,
  CRM_CURRENCIES,
  CRM_LEAD_STATUSES,
  crmCampaignStatusMeta,
  crmLeadStatusMeta,
  type CrmCampaign,
  type CrmCampaignSpend,
  type CrmCampaignStatus,
  type CrmDealWithRefs,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { CrmToggle } from "../_components/crm-toggle";
import { CrmListRow } from "../_components/list-row";
import { KpiStrip, type KpiItem } from "../_components/kpi-strip";
import { CampaignGlyph } from "../_components/deal-glyph";
import { FormSection } from "../_components/form-section";
import { CRM_ACCENT, leadStatusIcon } from "../_components/entity-meta";
import { TILE_GRID } from "../_components/layout";
import {
  CRM_DRAWER_BODY_STYLE,
  CRM_DRAWER_FORM_STYLE,
  CRM_DRAWER_WIDTH,
  CrmDrawerFields,
  CrmDrawerFooter,
} from "../_components/drawer-footer";
import {
  CrmPageHeader,
  CrmSearch,
  CrmToolbar,
  EmptyState,
  ErrorState,
  OverviewField,
  OverviewGrid,
  Panel,
  RowActions,
  SoftChip,
  StatTile,
  crmDate,
  crmMoney,
  crmMoneyPrecise,
  crmPageStyle,
  crmPersonName,
  fallbackDealName,
} from "../_lib/ui";

/**
 * What a new campaign bills in. `app_crm_campaigns.currency_code` defaults to
 * 'INR' in the migration — the form seeding anything else just meant a campaign
 * created two different ways disagreed.
 */
const CRM_CAMPAIGN_CURRENCY_DEFAULT = "INR";

/** The detail drawer matches the record drawer's width, not the form drawers'. */
const DETAIL_DRAWER_WIDTH = 560;

type StatusFilter = "ALL" | CrmCampaignStatus;

type CampaignFormValues = {
  name: string;
  channel?: string | null;
  status?: CrmCampaignStatus;
  currency_code?: string;
  /** Set it once and the nightly sweep logs it every day the campaign runs. */
  daily_budget?: number | null;
  started_on?: Dayjs | null;
  ended_on?: Dayjs | null;
  notes?: string;
};

/** Total of a set of daily spend rows. */
function sumSpend(rows: CrmCampaignSpend[] | undefined): number {
  return (rows ?? []).reduce((total, r) => total + Number(r.amount ?? 0), 0);
}

/**
 * The leads a cost-per-lead is actually divided by.
 *
 * `junk` and `not_interested` are separate statuses precisely so this line can
 * exist: a lead that turned you down was still a real lead the campaign bought,
 * a junk one (bot fill, wrong number, duplicate) was never a lead at all and
 * dividing by it flatters every campaign it lands on.
 */
function billableLeads(leads: CrmDealWithRefs[]): number {
  return leads.filter((d) => crmLeadStatusMeta(d.status).value !== "junk")
    .length;
}

/**
 * Spend ÷ leads. Two fraction digits, not `crmMoney`'s whole units — a ₹33.40
 * cost per lead is the number people compare campaigns on, and rounding it to
 * "₹33" (or a sub-unit CPL to "₹0") throws away the comparison. An em dash when
 * nothing came in: a campaign with no leads has no cost per lead, and printing
 * the raw spend there would read as a lie.
 */
function costPerLead(
  spend: number,
  leads: number,
  currency: string,
): string {
  return leads > 0 ? crmMoneyPrecise(spend / leads, currency) : "—";
}

/** How many days of day-by-day history the trend chart shows. */
const TREND_DAYS = 14;

/**
 * The window the trend covers: the last `days` days the campaign was actually
 * live. Running past `ended_on` would draw a tail of zero-spend days that reads
 * as a campaign that stopped working rather than one that stopped, and running
 * before `started_on` invents history it never had.
 */
function trendWindow(campaign: CrmCampaign, days: number) {
  const today = dayjs().startOf("day");
  const ended = campaign.ended_on ? dayjs(campaign.ended_on) : null;
  const end = ended && ended.isBefore(today, "day") ? ended : today;
  const started = campaign.started_on ? dayjs(campaign.started_on) : null;
  let start = end.subtract(days - 1, "day");
  if (started && started.isAfter(start, "day")) start = started;
  return { start, end };
}

/** Spend and billable leads landing inside a closed day range, inclusive. */
function windowTotals(
  spend: CrmCampaignSpend[],
  leads: CrmDealWithRefs[],
  from: Dayjs,
  to: Dayjs,
) {
  const money = spend
    .filter((r) => {
      const on = dayjs(r.spend_on);
      return !on.isBefore(from, "day") && !on.isAfter(to, "day");
    })
    .reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  const inRange = leads.filter((d) => {
    const at = dayjs(d.created_at);
    return !at.isBefore(from, "day") && !at.isAfter(to, "day");
  });
  return { money, leads: inRange.length, billable: billableLeads(inRange) };
}

/**
 * Percent change, rounded, with the "there was nothing to grow from" case
 * handled: 0 → 5 is not "+Infinity%", it has no percentage at all, so the
 * caller gets null and shows no chip rather than a nonsense one.
 */
function pctDelta(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

/** "12 Mar 2025 → 30 Apr 2025", with either end open. */
function dateRange(
  started: string | null,
  ended: string | null,
): string {
  if (!started && !ended) return "—";
  if (started && !ended) return `${crmDate(started)} → ongoing`;
  if (!started && ended) return `until ${crmDate(ended)}`;
  return `${crmDate(started)} → ${crmDate(ended)}`;
}

/** A deal's display name, falling back the way every other CRM surface does. */
function dealLabel(deal: CrmDealWithRefs): string {
  return (
    deal.name?.trim() ||
    fallbackDealName({
      company: deal.company?.name,
      contact: crmPersonName(deal.contact),
      phone: deal.phone,
    })
  );
}

/**
 * Channel picker. The seven suggestions cover most spend, but `channel` is free
 * text in the database on purpose — anything typed that isn't on the list is
 * offered as its own option, so a partner or offline source can be named.
 */
function ChannelSelect({
  value,
  onChange,
}: {
  value?: string | null;
  onChange?: (value: string | null) => void;
}) {
  const [search, setSearch] = useState("");

  const options = useMemo(() => {
    const known = new Set<string>(CRM_CAMPAIGN_CHANNELS);
    const list: { value: string; label: string }[] = CRM_CAMPAIGN_CHANNELS.map(
      (c) => ({ value: c, label: c }),
    );
    // A saved custom channel has to stay selectable when the drawer reopens.
    if (value && !known.has(value)) list.push({ value, label: value });
    const typed = search.trim();
    if (typed && !known.has(typed) && typed !== value) {
      list.push({ value: typed, label: `Use “${typed}”` });
    }
    return list;
  }, [value, search]);

  return (
    <Select
      allowClear
      showSearch
      placeholder="Meta, Google, a partner…"
      value={value ?? undefined}
      onChange={(next) => onChange?.(next ?? null)}
      onSearch={setSearch}
      optionFilterProp="label"
      options={options}
    />
  );
}

/**
 * The body of the campaign detail drawer: what the campaign is, its daily spend
 * ledger, and the leads it bought. Mounted only while a campaign is open (and
 * keyed by id), so the "add spend" composer never carries values between
 * campaigns.
 */
function CampaignDetail({
  campaign,
  leads,
}: {
  campaign: CrmCampaign;
  leads: CrmDealWithRefs[];
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const router = useRouter();
  const {
    data: spend,
    isLoading,
    isError: spendError,
    refetch: refetchSpend,
  } = useCrmCampaignSpend(campaign.id);
  const upsertSpend = useUpsertCampaignSpend();
  const deleteSpend = useDeleteCampaignSpend();

  const [day, setDay] = useState<Dayjs>(dayjs());
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [confirmSpendId, setConfirmSpendId] = useState<string | null>(null);
  /** Set by clicking a row in the lead mix — the breakdown IS the filter. */
  const [leadFilter, setLeadFilter] = useState<"ALL" | string>("ALL");

  const rows = useMemo(() => spend ?? [], [spend]);
  const total = useMemo(() => sumSpend(rows), [rows]);
  /** Cost per lead divides by the leads that were real — see `billableLeads`. */
  const billable = useMemo(() => billableLeads(leads), [leads]);
  const junk = leads.length - billable;
  const qualified = useMemo(
    () =>
      leads.filter((d) => {
        const v = crmLeadStatusMeta(d.status).value;
        return v === "qualified" || v === "converted";
      }).length,
    [leads],
  );

  /**
   * Last seven days against the seven before them.
   *
   * A campaign's lifetime cost per lead is an average over everything it ever
   * did, so it barely moves — which makes it useless for the only question
   * anyone opens this drawer with: is it getting worse *right now*? These are
   * the numbers that answer that.
   */
  const trend = useMemo(() => {
    const { end } = trendWindow(campaign, TREND_DAYS);
    const recent = windowTotals(rows, leads, end.subtract(6, "day"), end);
    const prior = windowTotals(
      rows,
      leads,
      end.subtract(13, "day"),
      end.subtract(7, "day"),
    );
    const cplNow = recent.billable > 0 ? recent.money / recent.billable : null;
    const cplPrior = prior.billable > 0 ? prior.money / prior.billable : null;
    return {
      recent,
      prior,
      cplNow,
      cplPrior,
      spendPct: pctDelta(recent.money, prior.money),
      leadsPct: pctDelta(recent.leads, prior.leads),
      cplPct:
        cplNow !== null && cplPrior !== null ? pctDelta(cplNow, cplPrior) : null,
    };
  }, [campaign, rows, leads]);

  /** Day-by-day money out and leads in — the two series the chart overlays. */
  const daily = useMemo(() => {
    const { start, end } = trendWindow(campaign, TREND_DAYS);
    if (start.isAfter(end, "day")) return [];
    const span = end.diff(start, "day") + 1;
    const days = Array.from({ length: span }, (_, i) => start.add(i, "day"));
    const spendByDay = new Map<string, number>();
    for (const r of rows) {
      const key = dayjs(r.spend_on).format("YYYY-MM-DD");
      spendByDay.set(key, (spendByDay.get(key) ?? 0) + Number(r.amount ?? 0));
    }
    const leadsByDay = new Map<string, number>();
    for (const d of leads) {
      const key = dayjs(d.created_at).format("YYYY-MM-DD");
      leadsByDay.set(key, (leadsByDay.get(key) ?? 0) + 1);
    }
    return days.map((d) => {
      const key = d.format("YYYY-MM-DD");
      return {
        label: d.format("D MMM"),
        spend: spendByDay.get(key) ?? 0,
        leads: leadsByDay.get(key) ?? 0,
      };
    });
  }, [campaign, rows, leads]);

  const hasTrendData = daily.some((d) => d.spend > 0 || d.leads > 0);

  const visibleLeads = useMemo(
    () =>
      leadFilter === "ALL"
        ? leads
        : leads.filter((d) => crmLeadStatusMeta(d.status).value === leadFilter),
    [leads, leadFilter],
  );

  /** Lead mix, biggest bucket first, with each bucket's share of spend. */
  const statusMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of leads) {
      const v = crmLeadStatusMeta(d.status).value;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return CRM_LEAD_STATUSES.filter((meta) => (counts.get(meta.value) ?? 0) > 0)
      .map((meta) => {
        const count = counts.get(meta.value) ?? 0;
        return {
          ...meta,
          count,
          share: leads.length > 0 ? count / leads.length : 0,
          // Junk was never bought, so it carries no cost — spreading spend
          // over it would price the real leads too cheaply.
          cost:
            meta.value === "junk" || billable === 0 || spendError
              ? null
              : (total / billable) * count,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [leads, billable, total, spendError]);
  const dayKey = day.format("YYYY-MM-DD");
  const existing = rows.find((r) => r.spend_on === dayKey) ?? null;

  const handleSaveSpend = async () => {
    if (amount === null || Number.isNaN(amount)) {
      message.warning("Enter what the campaign spent that day.");
      return;
    }
    try {
      await upsertSpend.mutateAsync({
        campaign_id: campaign.id,
        spend_on: dayKey,
        amount,
        note: note.trim() || null,
      });
      message.success(existing ? "Spend updated." : "Spend added.");
      setAmount(null);
      setNote("");
    } catch (err) {
      message.error(errMsg(err, "Failed to save spend."));
    }
  };

  const editRow = (row: CrmCampaignSpend) => {
    setDay(dayjs(row.spend_on));
    setAmount(Number(row.amount));
    setNote(row.note ?? "");
  };

  const composerHint = existing
    ? `${crmDate(existing.spend_on)} already has ${crmMoney(Number(existing.amount), campaign.currency_code)} — saving overwrites it.`
    : "One row per day. Re-entering a day overwrites it.";

  const kpis: KpiItem[] = [
    {
      key: "spend",
      label: "Total spend",
      value: spendError ? "—" : crmMoney(total, campaign.currency_code),
      hint: "Every day logged against this campaign, including days the nightly sweep filled in from its daily budget.",
      compare: "last 7d",
      delta:
        spendError || trend.spendPct === null
          ? null
          : { value: trend.spendPct, percent: true, goodWhenUp: false },
      footnote: spendError
        ? "Spend didn't load"
        : trend.spendPct === null
          ? `${crmMoney(trend.recent.money, campaign.currency_code)} in the last 7 days`
          : undefined,
      loading: isLoading,
    },
    {
      key: "leads",
      label: "Leads",
      value: leads.length,
      hint:
        junk > 0
          ? `${billable} billable, ${junk} junk. Junk never counts towards cost per lead.`
          : "Deals attributed to this campaign.",
      compare: "last 7d",
      delta:
        trend.leadsPct === null
          ? null
          : { value: trend.leadsPct, percent: true },
      footnote:
        trend.leadsPct === null
          ? `${trend.recent.leads} in the last 7 days`
          : undefined,
    },
    {
      key: "cpl",
      label: "Cost per lead",
      value: spendError
        ? "—"
        : costPerLead(total, billable, campaign.currency_code),
      hint: "Total spend ÷ leads that weren't junk.",
      compare: "last 7d",
      delta:
        spendError || trend.cplPct === null
          ? null
          : { value: trend.cplPct, percent: true, goodWhenUp: false },
      footnote: spendError
        ? "Spend didn't load"
        : trend.cplPct === null
          ? trend.cplNow !== null
            ? `${crmMoneyPrecise(trend.cplNow, campaign.currency_code)} in the last 7 days`
            : "Not enough recent leads to compare"
          : undefined,
      loading: isLoading,
    },
    {
      key: "qualified",
      label: "Cost per qualified",
      // The number a campaign is actually judged on: a hundred cheap leads
      // that never qualify cost more than ten expensive ones that do.
      value: spendError
        ? "—"
        : costPerLead(total, qualified, campaign.currency_code),
      hint: "Total spend ÷ leads now qualified or converted. The number that decides whether this campaign is worth running.",
      delta: null,
      footnote: spendError
        ? "Spend didn't load"
        : qualified > 0
          ? `${qualified} of ${leads.length} qualified or converted`
          : "Nothing qualified from this campaign yet",
      loading: isLoading,
    },
  ];

  const axisText = {
    fontFamily: CHART_FONT,
    fontSize: 11,
    color: token.colorTextTertiary,
  };

  const trendOption = {
    grid: { left: 4, right: 4, top: 26, bottom: 0, containLabel: true },
    legend: {
      top: 0,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { ...axisText, color: token.colorTextSecondary },
      data: ["Spend", "Leads"],
    },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: token.colorBgElevated,
      borderColor: token.colorBorderSecondary,
      textStyle: { fontFamily: CHART_FONT, fontSize: 12, color: token.colorText },
    },
    xAxis: {
      type: "category" as const,
      data: daily.map((d) => d.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...axisText, interval: daily.length > 10 ? 1 : 0 },
    },
    yAxis: [
      {
        type: "value" as const,
        axisLabel: {
          ...axisText,
          formatter: (v: number) =>
            v >= 100000
              ? `${Math.round(v / 1000)}k`
              : v >= 1000
                ? `${(v / 1000).toFixed(1)}k`
                : String(v),
        },
        splitLine: { lineStyle: { color: token.colorSplit } },
      },
      {
        type: "value" as const,
        minInterval: 1,
        axisLabel: axisText,
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "Spend",
        type: "bar" as const,
        data: daily.map((d) => d.spend),
        barMaxWidth: 16,
        itemStyle: { color: token.colorFillSecondary, borderRadius: [3, 3, 0, 0] },
      },
      {
        name: "Leads",
        type: "line" as const,
        yAxisIndex: 1,
        data: daily.map((d) => d.leads),
        smooth: true,
        symbolSize: 5,
        lineStyle: { width: 2, color: CRM_ACCENT.deal },
        itemStyle: { color: CRM_ACCENT.deal },
      },
    ],
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <KpiStrip items={kpis} />

      <Panel
        title="Spend against leads"
        padding={14}
        extra={
          daily.length > 0 ? (
            <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
              Last {daily.length} day{daily.length === 1 ? "" : "s"}
            </span>
          ) : null
        }
      >
        {isLoading ? (
          <div style={{ height: 180 }} />
        ) : spendError ? (
          <ErrorState
            compact
            title="Couldn't load the spend behind this chart"
            onRetry={() => void refetchSpend()}
          />
        ) : hasTrendData ? (
          <>
            {/* Two axes on purpose: money and lead counts share no scale, and
                forcing them onto one flattens whichever is smaller into the
                floor — which is exactly the line you came here to read. */}
            <EChart option={trendOption} height={180} />
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 11.5,
                lineHeight: 1.5,
                color: token.colorTextTertiary,
              }}
            >
              Bars are what you spent each day; the line is how many leads
              arrived. Bars climbing while the line stays flat is the campaign
              getting more expensive.
            </p>
          </>
        ) : (
          <EmptyState
            compact
            icon="show_chart"
            title="Nothing to plot yet"
            description="Log a day of spend, or attribute a lead to this campaign, and the trend fills in."
          />
        )}
      </Panel>

      <Panel padding={0} title="Lead mix">
        {statusMix.length === 0 ? (
          <EmptyState
            compact
            icon="donut_small"
            title="No leads to break down"
            description="Point a deal at this campaign and its status shows up here."
          />
        ) : (
          statusMix.map((row, index) => (
            <CrmListRow
              key={row.value}
              first={index === 0}
              pressed={leadFilter === row.value}
              onClick={() =>
                setLeadFilter((current) =>
                  current === row.value ? "ALL" : row.value,
                )
              }
              style={
                leadFilter === row.value
                  ? { background: token.colorFillTertiary }
                  : undefined
              }
            >
              <SoftChip
                tone={row.tone}
                icon={leadStatusIcon(row.value)}
                style={{ flex: "none", width: 132 }}
              >
                {row.label}
              </SoftChip>
              {/* The share bar carries the comparison the numbers can't: which
                  bucket this campaign mostly produces, at a glance. */}
              <span
                style={{
                  flex: 1,
                  minWidth: 40,
                  height: 6,
                  borderRadius: 999,
                  background: token.colorFillQuaternary,
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    display: "block",
                    width: `${Math.max(3, Math.round(row.share * 100))}%`,
                    height: "100%",
                    borderRadius: 999,
                    background:
                      row.value === "junk"
                        ? token.colorTextQuaternary
                        : CRM_ACCENT.deal,
                  }}
                />
              </span>
              <span
                style={{
                  flex: "none",
                  width: 56,
                  textAlign: "right",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: token.colorText,
                }}
              >
                {row.count}
              </span>
              <span
                style={{
                  flex: "none",
                  width: 84,
                  textAlign: "right",
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                  color: token.colorTextTertiary,
                }}
              >
                {row.cost === null
                  ? "—"
                  : crmMoney(row.cost, campaign.currency_code)}
              </span>
            </CrmListRow>
          ))
        )}
      </Panel>

      <Panel padding={14}>
        <OverviewGrid>
          <OverviewField label="Channel">
            {campaign.channel || "—"}
          </OverviewField>
          <OverviewField label="Currency">
            {campaign.currency_code}
          </OverviewField>
          <OverviewField label="Running" span={2}>
            {dateRange(campaign.started_on, campaign.ended_on)}
          </OverviewField>
          <OverviewField label="Created">
            {crmDate(campaign.created_at)}
          </OverviewField>
          {campaign.notes ? (
            <OverviewField label="Notes" span={2}>
              <span style={{ whiteSpace: "pre-wrap" }}>{campaign.notes}</span>
            </OverviewField>
          ) : null}
        </OverviewGrid>
      </Panel>

      <Panel
        padding={0}
        title="Daily spend"
        extra={
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: token.colorText,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {spendError ? "—" : crmMoney(total, campaign.currency_code)}
          </span>
        }
      >
        <div
          style={{
            padding: 12,
            borderBottom: `1px solid ${token.colorSplit}`,
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <DatePicker
              value={day}
              onChange={(next) => setDay(next ?? dayjs())}
              allowClear={false}
              format="DD MMM YYYY"
              style={{ width: 148 }}
            />
            <InputNumber<number>
              value={amount}
              onChange={(next) => setAmount(next)}
              min={0}
              placeholder="Amount"
              prefix={
                <span style={{ color: token.colorTextTertiary }}>
                  {campaign.currency_code}
                </span>
              }
              style={{ width: 168 }}
            />
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onPressEnter={handleSaveSpend}
              placeholder="Note (optional)"
              style={{ flex: 1, minWidth: 130 }}
            />
            <Button
              type="primary"
              onClick={handleSaveSpend}
              loading={upsertSpend.isPending}
            >
              {existing ? "Update" : "Add"}
            </Button>
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 11.5,
              lineHeight: 1.45,
              color: token.colorTextTertiary,
            }}
          >
            {composerHint}
          </div>
        </div>

        {isLoading ? (
          <div style={{ height: 88 }} />
        ) : spendError ? (
          <ErrorState
            compact
            title="Couldn't load this campaign's spend"
            onRetry={() => void refetchSpend()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon="payments"
            title="No spend logged yet"
            description="Add what this campaign spent each day and its cost per lead works itself out."
          />
        ) : (
          rows.map((row, index) => (
            <CrmListRow key={row.id} first={index === 0}>
              <span
                style={{
                  width: 96,
                  flex: "none",
                  fontSize: 12.5,
                  color: token.colorTextSecondary,
                }}
              >
                {crmDate(row.spend_on)}
              </span>
              <span
                style={{
                  width: 92,
                  flex: "none",
                  fontWeight: 500,
                  fontVariantNumeric: "tabular-nums",
                  color: token.colorText,
                }}
              >
                {crmMoney(Number(row.amount), campaign.currency_code)}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12.5,
                  color: token.colorTextTertiary,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.note ?? ""}
              </span>
              {/* Budget-derived days are a standing estimate, not a figure
                  anyone confirmed — say so, because cost per lead is built
                  on this number. Editing the day replaces it with an actual. */}
              {row.source === "budget" ? (
                <SoftChip icon="autorenew" style={{ flex: "none" }}>
                  Budget
                </SoftChip>
              ) : null}
              <RowActions
                open={confirmSpendId === row.id}
                style={{ flex: "none" }}
              >
                <Tooltip title="Edit this day">
                  <Button
                    type="text"
                    size="small"
                    icon={<MIcon name="edit" size={16} />}
                    onClick={() => editRow(row)}
                  />
                </Tooltip>
                <Popconfirm
                  title="Remove this day's spend?"
                  description="The day is deleted from the ledger and the totals recalculate."
                  okText="Remove"
                  okButtonProps={{ danger: true }}
                  onOpenChange={(open) => setConfirmSpendId(open ? row.id : null)}
                  onConfirm={async () => {
                    try {
                      await deleteSpend.mutateAsync(row.id);
                      message.success("Spend removed.");
                    } catch (err) {
                      message.error(errMsg(err, "Failed to remove spend."));
                    }
                  }}
                >
                  <Tooltip title="Remove">
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<MIcon name="delete" size={16} />}
                    />
                  </Tooltip>
                </Popconfirm>
              </RowActions>
            </CrmListRow>
          ))
        )}
      </Panel>

      <Panel
        padding={0}
        title="Leads"
        extra={
          leadFilter === "ALL" ? (
            <span style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
              {leads.length} attributed
            </span>
          ) : (
            <Button
              size="small"
              type="text"
              icon={<MIcon name="filter_alt_off" size={15} />}
              onClick={() => setLeadFilter("ALL")}
            >
              {`${visibleLeads.length} ${crmLeadStatusMeta(leadFilter).label.toLowerCase()}`}
            </Button>
          )
        }
      >
        {leads.length === 0 ? (
          <EmptyState
            compact
            icon="target"
            title="No leads from this campaign yet"
            description="Deals point at a campaign from the deal form — pick this one and it shows up here."
          />
        ) : visibleLeads.length === 0 ? (
          <EmptyState
            compact
            icon="filter_alt_off"
            title={`No ${crmLeadStatusMeta(leadFilter).label.toLowerCase()} leads`}
            description="That status has no leads on this campaign right now."
            action={
              <Button onClick={() => setLeadFilter("ALL")}>
                Show all {leads.length}
              </Button>
            }
          />
        ) : (
          visibleLeads.map((deal, index) => {
            const status = crmLeadStatusMeta(deal.status);
            return (
              <CrmListRow
                key={deal.id}
                first={index === 0}
                onClick={() => router.push(`/crm/deals?m=${deal.id}`)}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontWeight: 500,
                    color: token.colorText,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {dealLabel(deal)}
                </span>
                <SoftChip
                  tone={status.tone}
                  icon={leadStatusIcon(status.value)}
                  style={{ flex: "none" }}
                >
                  {status.label}
                </SoftChip>
                <span
                  style={{
                    flex: "none",
                    fontSize: 12,
                    color: token.colorTextTertiary,
                  }}
                >
                  {crmDate(deal.created_at)}
                </span>
              </CrmListRow>
            );
          })
        )}
      </Panel>
    </div>
  );
}

export default function CrmCampaignsPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const {
    data: campaigns,
    isLoading,
    isError,
    error,
    refetch,
  } = useCrmCampaigns();
  const { data: allSpend } = useCrmCampaignSpend();
  const { data: deals } = useCrmDeals();
  const createCampaign = useCreateCrmCampaign();
  const updateCampaign = useUpdateCrmCampaign();
  const setDeleted = useSetCrmCampaignDeleted();
  const destroyCampaign = useDestroyCrmCampaign();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [showDeleted, setShowDeleted] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmCampaign | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<string | null>(null);
  const [form] = Form.useForm<CampaignFormValues>();

  const liveCampaigns = useMemo(
    () => (campaigns ?? []).filter((c) => !c.deleted_at),
    [campaigns],
  );

  /** All-time spend per campaign, off the team-wide ledger. */
  const spendByCampaign = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of allSpend ?? []) {
      totals.set(
        row.campaign_id,
        (totals.get(row.campaign_id) ?? 0) + Number(row.amount ?? 0),
      );
    }
    return totals;
  }, [allSpend]);

  /** Live deals attributed to each campaign, newest first. */
  const leadsByCampaign = useMemo(() => {
    const map = new Map<string, CrmDealWithRefs[]>();
    for (const deal of deals ?? []) {
      if (deal.deleted_at || !deal.campaign_id) continue;
      const list = map.get(deal.campaign_id);
      if (list) list.push(deal);
      else map.set(deal.campaign_id, [deal]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return map;
  }, [deals]);

  /**
   * The workspace's default currency — whichever most live campaigns use. Only
   * a fallback for a month with no spend logged; the tiles below report the
   * currency their own numbers are actually in.
   */
  const currency = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of liveCampaigns) {
      counts.set(c.currency_code, (counts.get(c.currency_code) ?? 0) + 1);
    }
    let code = "USD";
    let best = 0;
    for (const [value, n] of counts) {
      if (n > best) {
        code = value;
        best = n;
      }
    }
    return { code, mixed: counts.size > 1 };
  }, [liveCampaigns]);

  /**
   * This month's spend, leads and cost per lead — all three in ONE currency.
   *
   * Campaigns each carry their own `currency_code` and those never add up: a
   * ₹50,000 Meta campaign plus a $500 Google one is not "₹50,500". So spend is
   * bucketed per currency, the biggest bucket is what the tiles report, and the
   * hint says the total is that currency only. The CPL denominator is narrowed
   * the same way (leads whose campaign bills in the reported currency, junk
   * dropped) or the ratio would mix after all. Soft-deleted campaigns are out
   * of every bucket — same rule as the dashboard tile and every other CRM list.
   */
  const monthly = useMemo(() => {
    const start = dayjs().startOf("month");
    const end = dayjs().endOf("month");
    const inMonth = (value: string) => {
      const on = dayjs(value);
      return !on.isBefore(start, "day") && !on.isAfter(end, "day");
    };
    const currencyOf = new Map(
      liveCampaigns.map((c) => [c.id, c.currency_code]),
    );

    const spendByCurrency = new Map<string, number>();
    for (const row of allSpend ?? []) {
      const code = currencyOf.get(row.campaign_id);
      if (!code) continue; // soft-deleted campaign — off the books
      if (!inMonth(row.spend_on)) continue;
      spendByCurrency.set(
        code,
        (spendByCurrency.get(code) ?? 0) + Number(row.amount ?? 0),
      );
    }
    const ranked = [...spendByCurrency.entries()].sort((a, b) => b[1] - a[1]);
    const code = ranked[0]?.[0] ?? currency.code;
    const spend = ranked[0]?.[1] ?? 0;

    // "Leads this month" is a count, not money, so it spans every campaign;
    // only the CPL denominator has to sit inside the reported currency.
    let leads = 0;
    let cplLeads = 0;
    for (const deal of deals ?? []) {
      if (deal.deleted_at || !deal.campaign_id) continue;
      const dealCurrency = currencyOf.get(deal.campaign_id);
      if (!dealCurrency) continue;
      if (!inMonth(deal.created_at)) continue;
      leads += 1;
      if (
        dealCurrency === code &&
        crmLeadStatusMeta(deal.status).value !== "junk"
      ) {
        cplLeads += 1;
      }
    }

    return { spend, leads, cplLeads, code, mixed: ranked.length > 1 };
  }, [allSpend, deals, liveCampaigns, currency.code]);

  const activeCount = useMemo(
    () => liveCampaigns.filter((c) => c.status === "active").length,
    [liveCampaigns],
  );

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (campaigns ?? [])
      .filter((c) => (showDeleted ? Boolean(c.deleted_at) : !c.deleted_at))
      .filter((c) => statusFilter === "ALL" || c.status === statusFilter)
      .filter((c) => {
        if (!needle) return true;
        return [c.name, c.channel ?? "", c.notes ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
  }, [campaigns, search, statusFilter, showDeleted]);

  const detailCampaign = useMemo(
    () => (campaigns ?? []).find((c) => c.id === detailId) ?? null,
    [campaigns, detailId],
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      status: "active",
      // Matches the column default in the migration ('INR'), so a campaign
      // created from the form and one created by any other path agree.
      currency_code: CRM_CAMPAIGN_CURRENCY_DEFAULT,
      // Spend starts the day you set the campaign up far more often than not.
      started_on: dayjs(),
    });
    setFormOpen(true);
  };

  const openEdit = (campaign: CrmCampaign) => {
    setEditing(campaign);
    form.setFieldsValue({
      name: campaign.name,
      channel: campaign.channel,
      status: crmCampaignStatusMeta(campaign.status).value,
      currency_code: campaign.currency_code,
      daily_budget: campaign.daily_budget,
      started_on: campaign.started_on ? dayjs(campaign.started_on) : null,
      ended_on: campaign.ended_on ? dayjs(campaign.ended_on) : null,
      notes: campaign.notes ?? undefined,
    });
    setFormOpen(true);
  };

  const handleSubmit = async (values: CampaignFormValues) => {
    const patch: CrmCampaignPatch & { name: string } = {
      name: values.name.trim(),
      channel: values.channel?.trim() || null,
      status: values.status ?? "active",
      currency_code: values.currency_code || CRM_CAMPAIGN_CURRENCY_DEFAULT,
      daily_budget: values.daily_budget ?? null,
      started_on: values.started_on
        ? values.started_on.format("YYYY-MM-DD")
        : null,
      ended_on: values.ended_on ? values.ended_on.format("YYYY-MM-DD") : null,
      notes: values.notes?.trim() || null,
    };
    try {
      if (editing) {
        await updateCampaign.mutateAsync({ id: editing.id, patch });
        message.success("Campaign updated.");
      } else {
        await createCampaign.mutateAsync(patch);
        message.success("Campaign added.");
      }
      setFormOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Failed to save campaign."));
    }
  };

  /** Quiet em dash for empty cells. */
  const dash = <span style={{ color: token.colorTextQuaternary }}>—</span>;

  const numberCell = (value: React.ReactNode) => (
    <span
      style={{
        color: token.colorTextSecondary,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </span>
  );

  const filtered = Boolean(search.trim()) || statusFilter !== "ALL";

  // Spend numbers that fail to load must not read as a campaign list that is
  // simply empty — one means "nothing to see", the other means "don't trust
  // the totals above".
  const emptyText = isError ? (
    <ErrorState
      compact
      title="Couldn't load campaigns"
      error={error}
      onRetry={() => void refetch()}
    />
  ) : filtered ? (
    <EmptyState
      compact
      icon="search_off"
      title="No campaigns match"
      description={
        search.trim()
          ? `Nothing found for “${search.trim()}”. Try a campaign name or a channel.`
          : "No campaign has that status right now."
      }
      action={
        <Button
          onClick={() => {
            setSearch("");
            setStatusFilter("ALL");
          }}
        >
          Clear filters
        </Button>
      }
    />
  ) : showDeleted ? (
    <EmptyState
      compact
      icon="restore_from_trash"
      title="Nothing in Deleted"
      description="Campaigns you delete land here first, so you can restore them before they are permanently removed."
    />
  ) : (
    <EmptyState
      compact
      icon="campaign"
      accent={token.colorPrimary}
      title="No campaigns yet"
      description="Add the paid campaigns your leads come from, log what they spend each day, and every lead gets a price."
      action={
        <Button
          type="primary"
          icon={<MIcon name="add" size={16} />}
          onClick={openCreate}
        >
          Add your first campaign
        </Button>
      }
    />
  );

  return (
    <div style={crmPageStyle()}>
      <CrmPageHeader
        title="Campaigns"
        count={isLoading || isError ? null : rows.length}
        subtitle="What each paid channel spends, and what it costs to buy a lead there."
      />

      <CrmToolbar>
        <CrmSearch
          value={search}
          onChange={setSearch}
          placeholder="Search campaigns…"
        />
        <Segmented
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          options={[
            { value: "ALL", label: "All" },
            ...CRM_CAMPAIGN_STATUSES.map((s) => ({
              value: s.value,
              label: s.label,
            })),
          ]}
        />
        <CrmToggle
          checked={showDeleted}
          onChange={setShowDeleted}
          label="Deleted"
        />
        <Button
          type="primary"
          icon={<MIcon name="add" size={16} />}
          onClick={openCreate}
          style={{ marginLeft: "auto" }}
        >
          New campaign
        </Button>
      </CrmToolbar>

      <div style={TILE_GRID}>
        <StatTile
          icon="campaign"
          color={CRM_ACCENT.campaign}
          label="Active campaigns"
          value={isLoading ? "—" : activeCount}
          hint={
            isLoading
              ? undefined
              : `of ${liveCampaigns.length} campaign${liveCampaigns.length === 1 ? "" : "s"}`
          }
        />
        <StatTile
          icon="payments"
          color={CRM_ACCENT.campaign}
          label="Spend this month"
          value={crmMoney(monthly.spend, monthly.code)}
          hint={
            monthly.mixed
              ? `${dayjs().format("MMMM YYYY")} · ${monthly.code} only`
              : dayjs().format("MMMM YYYY")
          }
        />
        <StatTile
          icon="target"
          color={CRM_ACCENT.deal}
          label="Leads this month"
          value={monthly.leads}
          hint="deals attributed to a campaign"
        />
        <StatTile
          icon="price_check"
          color={CRM_ACCENT.campaign}
          label="Cost per lead"
          value={costPerLead(monthly.spend, monthly.cplLeads, monthly.code)}
          hint={
            monthly.cplLeads > 0
              ? `this month's ${monthly.code} spend ÷ leads, junk excluded`
              : "no campaign leads yet this month"
          }
        />
      </div>

      <Panel padding={0}>
        <Table<CrmCampaign>
          rowKey="id"
          size="middle"
          loading={isLoading}
          dataSource={rows}
          pagination={{
            pageSize: 25,
            hideOnSinglePage: true,
            style: { marginInline: 16 },
          }}
          scroll={{ x: 1040 }}
          locale={{
            emptyText: isLoading ? <div style={{ height: 120 }} /> : emptyText,
          }}
          onRow={(c) => ({
            onClick: () => setDetailId(c.id),
            style: { cursor: "pointer" },
          })}
          columns={[
            {
              title: "Campaign",
              key: "name",
              render: (_, c) => (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minWidth: 0,
                  }}
                >
                  <CampaignGlyph name={c.name} />
                  <span
                    style={{
                      fontWeight: 500,
                      color: c.deleted_at
                        ? token.colorTextTertiary
                        : token.colorText,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {c.name}
                  </span>
                  {c.channel ? (
                    <SoftChip style={{ flex: "none" }}>{c.channel}</SoftChip>
                  ) : null}
                </div>
              ),
              sorter: (a, b) => a.name.localeCompare(b.name),
            },
            {
              title: "Status",
              key: "status",
              width: 118,
              render: (_, c) => {
                const meta = crmCampaignStatusMeta(c.status);
                return <SoftChip tone={meta.tone}>{meta.label}</SoftChip>;
              },
            },
            {
              title: "Running",
              key: "dates",
              width: 210,
              render: (_, c) => (
                <span style={{ color: token.colorTextTertiary }}>
                  {dateRange(c.started_on, c.ended_on)}
                </span>
              ),
              sorter: (a, b) =>
                (a.started_on ?? "").localeCompare(b.started_on ?? ""),
            },
            {
              title: "Total spend",
              key: "spend",
              width: 140,
              align: "right",
              render: (_, c) =>
                numberCell(
                  crmMoney(spendByCampaign.get(c.id) ?? 0, c.currency_code),
                ),
              sorter: (a, b) =>
                (spendByCampaign.get(a.id) ?? 0) -
                (spendByCampaign.get(b.id) ?? 0),
            },
            {
              title: "Leads",
              key: "leads",
              width: 92,
              align: "right",
              render: (_, c) =>
                numberCell((leadsByCampaign.get(c.id) ?? []).length),
              sorter: (a, b) =>
                (leadsByCampaign.get(a.id) ?? []).length -
                (leadsByCampaign.get(b.id) ?? []).length,
            },
            {
              title: (
                <Tooltip title="Spend ÷ leads, with junk leads left out of the denominator.">
                  <span>Cost per lead</span>
                </Tooltip>
              ),
              key: "cpl",
              width: 140,
              align: "right",
              render: (_, c) => {
                const leads = billableLeads(leadsByCampaign.get(c.id) ?? []);
                if (leads === 0) return dash;
                return numberCell(
                  costPerLead(
                    spendByCampaign.get(c.id) ?? 0,
                    leads,
                    c.currency_code,
                  ),
                );
              },
            },
            {
              title: "",
              key: "actions",
              width: 96,
              align: "right",
              render: (_, c) => (
                <RowActions open={confirmRow === c.id}>
                  {c.deleted_at ? (
                    <>
                      <Tooltip title="Restore">
                        <Button
                          type="text"
                          size="small"
                          icon={<MIcon name="restore_from_trash" size={17} />}
                          onClick={async () => {
                            try {
                              await setDeleted.mutateAsync({
                                id: c.id,
                                deleted: false,
                              });
                              message.success("Campaign restored.");
                            } catch (err) {
                              message.error(errMsg(err, "Failed to restore."));
                            }
                          }}
                        />
                      </Tooltip>
                      <Popconfirm
                        title="Permanently delete this campaign?"
                        description="This cannot be undone. Its daily spend goes with it and its leads stay, unattributed."
                        okText="Delete forever"
                        okButtonProps={{ danger: true }}
                        onOpenChange={(open) =>
                          setConfirmRow(open ? c.id : null)
                        }
                        onConfirm={async () => {
                          try {
                            await destroyCampaign.mutateAsync(c.id);
                            message.success("Campaign permanently deleted.");
                          } catch (err) {
                            message.error(errMsg(err, "Failed to delete."));
                          }
                        }}
                      >
                        <Tooltip title="Delete forever">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<MIcon name="delete_forever" size={17} />}
                          />
                        </Tooltip>
                      </Popconfirm>
                    </>
                  ) : (
                    <>
                      <Tooltip title="Edit">
                        <Button
                          type="text"
                          size="small"
                          icon={<MIcon name="edit" size={16} />}
                          onClick={() => openEdit(c)}
                        />
                      </Tooltip>
                      <Popconfirm
                        title="Delete this campaign?"
                        description="It moves to Deleted and can be restored, spend and all."
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onOpenChange={(open) =>
                          setConfirmRow(open ? c.id : null)
                        }
                        onConfirm={async () => {
                          try {
                            await setDeleted.mutateAsync({
                              id: c.id,
                              deleted: true,
                            });
                            message.success("Campaign deleted.");
                          } catch (err) {
                            message.error(errMsg(err, "Failed to delete."));
                          }
                        }}
                      >
                        <Tooltip title="Delete">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<MIcon name="delete" size={16} />}
                          />
                        </Tooltip>
                      </Popconfirm>
                    </>
                  )}
                </RowActions>
              ),
            },
          ]}
        />
      </Panel>

      <Drawer
        open={Boolean(detailCampaign)}
        onClose={() => setDetailId(null)}
        width={DETAIL_DRAWER_WIDTH}
        destroyOnHidden
        styles={{
          header: { padding: "14px 20px" },
          body: { padding: "8px 20px 20px" },
        }}
        title={
          detailCampaign ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                minWidth: 0,
              }}
            >
              <CampaignGlyph name={detailCampaign.name} size={40} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      letterSpacing: "-0.2px",
                      lineHeight: 1.3,
                      color: token.colorText,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {detailCampaign.name}
                  </span>
                  <SoftChip
                    tone={crmCampaignStatusMeta(detailCampaign.status).tone}
                    style={{ flex: "none" }}
                  >
                    {crmCampaignStatusMeta(detailCampaign.status).label}
                  </SoftChip>
                </div>
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 12.5,
                    fontWeight: 400,
                    color: token.colorTextTertiary,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {[
                    detailCampaign.channel,
                    dateRange(
                      detailCampaign.started_on,
                      detailCampaign.ended_on,
                    ),
                  ]
                    .filter((part) => part && part !== "—")
                    .join(" · ")}
                </div>
              </div>
            </div>
          ) : null
        }
        extra={
          detailCampaign && !detailCampaign.deleted_at ? (
            <Button
              icon={<MIcon name="edit" size={16} />}
              onClick={() => {
                const campaign = detailCampaign;
                setDetailId(null);
                openEdit(campaign);
              }}
            >
              Edit
            </Button>
          ) : null
        }
      >
        {detailCampaign ? (
          <CampaignDetail
            key={detailCampaign.id}
            campaign={detailCampaign}
            leads={leadsByCampaign.get(detailCampaign.id) ?? []}
          />
        ) : null}
      </Drawer>

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit campaign" : "New campaign"}
        width={CRM_DRAWER_WIDTH}
        destroyOnHidden
        styles={{ body: CRM_DRAWER_BODY_STYLE }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          style={CRM_DRAWER_FORM_STYLE}
        >
          <CrmDrawerFields>
            <FormSection label="Campaign" first>
              <Form.Item
                name="name"
                label="Name"
                rules={[
                  { required: true, message: "Campaign name is required" },
                ]}
              >
                <Input placeholder="Spring lead gen — Meta" />
              </Form.Item>
              <Form.Item
                name="channel"
                label="Channel"
                tooltip="Where the spend goes. Type anything — the list is only a shortcut."
              >
                <ChannelSelect />
              </Form.Item>
              <div style={{ display: "flex", gap: 12 }}>
                <Form.Item
                  name="status"
                  label="Status"
                  initialValue="active"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Select
                    options={CRM_CAMPAIGN_STATUSES.map((s) => ({
                      value: s.value,
                      label: s.label,
                    }))}
                  />
                </Form.Item>
                <Form.Item
                  name="currency_code"
                  label="Currency"
                  initialValue={CRM_CAMPAIGN_CURRENCY_DEFAULT}
                  style={{ width: 110, flex: "none" }}
                >
                  <Select
                    options={CRM_CURRENCIES.map((c) => ({
                      value: c,
                      label: c,
                    }))}
                  />
                </Form.Item>
              </div>
              {/* The whole point of a budget: type it once, and every day the
                  campaign is active gets a spend row without anyone opening
                  this screen. A hand-typed figure always wins over it. */}
              <Form.Item
                name="daily_budget"
                label="Daily budget"
                extra="Logged automatically each day while the campaign is active. Leave blank to enter spend by hand."
              >
                <InputNumber
                  style={{ width: "100%" }}
                  min={0}
                  step={100}
                  placeholder="e.g. 2000"
                />
              </Form.Item>
            </FormSection>

            <FormSection label="Dates">
              <div style={{ display: "flex", gap: 12 }}>
                <Form.Item
                  name="started_on"
                  label="Started"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <DatePicker style={{ width: "100%" }} format="DD MMM YYYY" />
                </Form.Item>
                <Form.Item
                  name="ended_on"
                  label="Ended"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <DatePicker style={{ width: "100%" }} format="DD MMM YYYY" />
                </Form.Item>
              </div>
            </FormSection>

            <FormSection label="Notes">
              <Form.Item
                name="notes"
                label="Notes"
                extra="Audience, creative, whatever the next person needs to know."
              >
                <Input.TextArea rows={3} placeholder="Optional" />
              </Form.Item>
            </FormSection>
          </CrmDrawerFields>

          <CrmDrawerFooter>
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={createCampaign.isPending || updateCampaign.isPending}
            >
              {editing ? "Save changes" : "Add campaign"}
            </Button>
          </CrmDrawerFooter>
        </Form>
      </Drawer>
    </div>
  );
}
