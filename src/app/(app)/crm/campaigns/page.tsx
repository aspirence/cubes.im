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
  const { data: spend, isLoading } = useCrmCampaignSpend(campaign.id);
  const upsertSpend = useUpsertCampaignSpend();
  const deleteSpend = useDeleteCampaignSpend();

  const [day, setDay] = useState<Dayjs>(dayjs());
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [confirmSpendId, setConfirmSpendId] = useState<string | null>(null);

  const rows = useMemo(() => spend ?? [], [spend]);
  const total = useMemo(() => sumSpend(rows), [rows]);
  /** Cost per lead divides by the leads that were real — see `billableLeads`. */
  const billable = useMemo(() => billableLeads(leads), [leads]);
  const junk = leads.length - billable;
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
          <OverviewField label="Total spend">
            {crmMoney(total, campaign.currency_code)}
          </OverviewField>
          <OverviewField label="Leads">
            {leads.length}
            {junk > 0 ? (
              <span style={{ color: token.colorTextTertiary }}>
                {" "}
                · {junk} junk
              </span>
            ) : null}
          </OverviewField>
          <OverviewField label="Cost per lead">
            {costPerLead(total, billable, campaign.currency_code)}
            {junk > 0 ? (
              <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>
                {" "}
                (junk excluded)
              </span>
            ) : null}
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
            {crmMoney(total, campaign.currency_code)}
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
          <span style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
            {leads.length} attributed
          </span>
        }
      >
        {leads.length === 0 ? (
          <EmptyState
            compact
            icon="target"
            title="No leads from this campaign yet"
            description="Deals point at a campaign from the deal form — pick this one and it shows up here."
          />
        ) : (
          leads.map((deal, index) => {
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
  const { data: campaigns, isLoading } = useCrmCampaigns();
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

  const emptyText = filtered ? (
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
        count={isLoading ? null : rows.length}
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
