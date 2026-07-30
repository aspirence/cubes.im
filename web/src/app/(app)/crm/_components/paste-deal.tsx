"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  theme,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useAuth } from "@/features/auth/use-auth";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useCreateCrmCompany, useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCreateCrmPerson, useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useCreateCrmDeal, useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmStages } from "@/features/app-crm/use-crm-stages";
import { useCrmCampaigns } from "@/features/app-crm/use-crm-campaigns";
import { useCreateCrmReminder } from "@/features/app-crm/use-crm-reminders";
import {
  CRM_LEAD_STATUSES,
  CRM_LEAD_STATUS_DEFAULT,
  crmPersonName,
  type CrmLeadStatus,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "./m-icon";
import {
  CRM_REMIND_AT_FORMAT,
  crmDefaultRemindAt,
  crmDisabledRemindDate,
} from "./reminder-controls";
import { SoftChip, fallbackDealName } from "../_lib/ui";
import { useCrmPrefsStore } from "../_lib/crm-prefs-store";
import {
  hasUsefulSignal,
  parsePastedDeal,
  type ParsedDeal,
} from "../_lib/paste-parse";

/** Select value meaning "create the record I pasted, it isn't in the CRM yet". */
const CREATE_NEW = "__create_new__";

type DealFormValues = {
  /** Optional — a blank one is filled in from the deal's relations on save. */
  name?: string;
  phone?: string;
  stage_id?: string | null;
  /** The lead's own health — never the board axis, which is `stage_id`. */
  status?: CrmLeadStatus;
  /** Where the lead came from; without it the lead has no cost per lead. */
  campaign_id?: string | null;
  close_date?: Dayjs | null;
  company_id?: string | null;
  owner_id?: string | null;
  /** Set a personal follow-up nudge on the new deal. Off by default. */
  remind?: boolean;
  remind_at?: Dayjs | null;
};

/** Would a paste here land in a field the user is actually typing into? */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

/** True while an AntD overlay owns the screen — never hijack a paste there. */
function overlayOpen(): boolean {
  return Boolean(
    document.querySelector(".ant-modal-wrap:not(.ant-modal-wrap-hidden)") ??
      document.querySelector(".ant-drawer-open") ??
      document.querySelector(".ant-image-preview-wrap"),
  );
}

/** An untouched parse — what the dialog starts from when opened by a button. */
const BLANK: ParsedDeal = {
  name: null,
  closeDate: null,
  email: null,
  phone: null,
  personName: null,
  companyName: null,
  domain: null,
  raw: "",
};

/**
 * The CRM's quick deal dialog, reachable two ways:
 *   • paste anywhere on the page — the lead you copied out of an email, a
 *     sheet row or a WhatsApp message opens the form already filled in;
 *   • a caller flips `open` (the dashboard's "Create a deal" buttons), which
 *     opens the same form blank.
 * Pastes into a real input are left alone, and a blob with no usable signal is
 * ignored silently.
 */
export function DealQuickCreate({
  open = false,
  onClose,
  capturePaste = true,
}: {
  /** External open request (button-triggered); paste opens it on its own. */
  open?: boolean;
  onClose?: () => void;
  capturePaste?: boolean;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { user } = useAuth();
  const [form] = Form.useForm<DealFormValues>();

  const [parsed, setParsed] = useState<ParsedDeal | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const lastCompanyId = useCrmPrefsStore((s) => s.lastCompanyId);
  const setLastCompanyId = useCrmPrefsStore((s) => s.setLastCompanyId);
  const lastCampaignId = useCrmPrefsStore((s) => s.lastCampaignId);
  const setLastCampaignId = useCrmPrefsStore((s) => s.setLastCampaignId);

  const { data: stages } = useCrmStages();
  const { data: campaigns } = useCrmCampaigns();
  const { data: companies } = useCrmCompanies();
  const { data: people } = useCrmPeople();
  const { data: deals } = useCrmDeals();
  const { data: members } = useTeamMembers();
  const createDeal = useCreateCrmDeal();
  const createCompany = useCreateCrmCompany();
  const createPerson = useCreateCrmPerson();
  const createReminder = useCreateCrmReminder();

  /** Only show the "when" picker while the follow-up box is ticked. */
  const remindTicked = Form.useWatch("remind", form) ?? false;

  const liveCompanies = useMemo(
    () => (companies ?? []).filter((c) => !c.deleted_at),
    [companies],
  );
  const livePeople = useMemo(
    () => (people ?? []).filter((p) => !p.deleted_at),
    [people],
  );
  const liveCampaigns = useMemo(
    () => (campaigns ?? []).filter((c) => !c.deleted_at),
    [campaigns],
  );

  /** The company the pasted text points at, if the CRM already has it. */
  const matchedCompany = useMemo(() => {
    if (!parsed) return null;
    const byDomain = parsed.domain
      ? liveCompanies.find(
          (c) => c.domain && c.domain.toLowerCase().replace(/^www\./, "") === parsed.domain,
        )
      : undefined;
    if (byDomain) return byDomain;
    const name = parsed.companyName?.trim().toLowerCase();
    return name
      ? (liveCompanies.find((c) => c.name.trim().toLowerCase() === name) ?? null)
      : null;
  }, [parsed, liveCompanies]);

  /** The contact the pasted text points at, matched on email then full name. */
  const matchedPerson = useMemo(() => {
    if (!parsed) return null;
    const email = parsed.email?.trim().toLowerCase();
    const byEmail = email
      ? livePeople.find((p) => p.email?.trim().toLowerCase() === email)
      : undefined;
    if (byEmail) return byEmail;
    const name = parsed.personName?.trim().toLowerCase();
    return name
      ? (livePeople.find((p) => crmPersonName(p).trim().toLowerCase() === name) ?? null)
      : null;
  }, [parsed, livePeople]);

  const canCreateCompany = Boolean(parsed?.companyName && !matchedCompany);
  const canCreateContact = Boolean(
    (parsed?.personName || parsed?.email) && !matchedPerson,
  );

  /* ------------------------------------------------------------ listener */

  const openFrom = useCallback(
    (text: string) => {
      const result = parsePastedDeal(text);
      if (!hasUsefulSignal(result)) return false;
      setParsed(result);
      setShowRaw(false);
      return true;
    },
    [],
  );

  useEffect(() => {
    if (!capturePaste) return;
    const onPaste = (e: ClipboardEvent) => {
      if (parsed || open) return; // the dialog already owns this paste
      if (isEditableTarget(e.target) || overlayOpen()) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text.trim().length < 3) return;
      if (openFrom(text)) e.preventDefault();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [parsed, open, capturePaste, openFrom]);

  /** Open either way; a button-opened dialog starts from a blank parse. */
  const active = parsed ?? (open ? BLANK : null);

  /* --------------------------------------------------------------- form */

  // The parse seeds the form through `initialValues` + a per-paste `key`
  // rather than a setFieldsValue effect: the fields are then correct on the
  // very first paint, with no window where the dialog shows an empty form.
  const initialValues = useMemo<DealFormValues | undefined>(() => {
    if (!active) return undefined;
    return {
      name: active.name ?? "",
      phone: active.phone ?? undefined,
      stage_id: stages?.[0]?.id ?? null,
      // Every lead starts life as "new"; the desk moves it from there — and a
      // lead you pasted BECAUSE someone just called can be marked here.
      status: CRM_LEAD_STATUS_DEFAULT,
      // This is the fastest capture path in the product, so it is exactly where
      // attribution gets lost. Leads arrive in runs from one campaign, so the
      // last one used is the guess — same trick as `lastCompanyId` above.
      campaign_id: liveCampaigns.some((c) => c.id === lastCampaignId)
        ? lastCampaignId
        : null,
      // A pasted date wins; otherwise today, since a lead captured now is
      // usually being worked now.
      close_date: active.closeDate ? dayjs(active.closeDate) : dayjs(),
      // Nothing in the paste identified a company? Fall back to the one used
      // last time — leads tend to arrive in runs for the same account.
      company_id:
        matchedCompany?.id ??
        (canCreateCompany
          ? CREATE_NEW
          : (liveCompanies.some((c) => c.id === lastCompanyId)
              ? lastCompanyId
              : null)),
      owner_id: user?.id ?? null,
      // Off by default: most captures do not want a nudge, and a dialog that
      // silently schedules one for every lead turns the bell into noise.
      remind: false,
      remind_at: crmDefaultRemindAt(),
    };
  }, [
    active,
    stages,
    matchedCompany,
    canCreateCompany,
    liveCompanies,
    lastCompanyId,
    liveCampaigns,
    lastCampaignId,
    user?.id,
  ]);

  const companyOptions = useMemo(
    () => [
      ...(canCreateCompany
        ? [{ value: CREATE_NEW, label: `Create “${parsed?.companyName}”` }]
        : []),
      ...liveCompanies.map((c) => ({ value: c.id, label: c.name })),
    ],
    [canCreateCompany, parsed?.companyName, liveCompanies],
  );

  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.active && m.user)
        .map((m) => ({ value: m.user!.id, label: m.user!.name })),
    [members],
  );

  const stageOptions = useMemo(
    () => (stages ?? []).map((s) => ({ value: s.id, label: s.name })),
    [stages],
  );

  const statusOptions = useMemo(
    () => CRM_LEAD_STATUSES.map((s) => ({ value: s.value, label: s.label })),
    [],
  );

  const campaignOptions = useMemo(
    () => liveCampaigns.map((c) => ({ value: c.id, label: c.name })),
    [liveCampaigns],
  );

  const close = () => {
    setParsed(null);
    setSubmitting(false);
    onClose?.();
  };

  const handleSubmit = async (values: DealFormValues) => {
    if (!active) return;
    setSubmitting(true);
    try {
      // Create the referenced records first so the deal can point at them.
      let companyId = values.company_id ?? null;
      if (companyId === CREATE_NEW) {
        const created = await createCompany.mutateAsync({
          name: active.companyName ?? "New company",
          domain: active.domain ?? null,
        });
        companyId = created.id;
      }

      const phone = values.phone?.trim() || null;

      // No contact picker on this dialog any more — a fast capture should not
      // stop to ask. A paste that identified a person is still real data
      // though, so link them, creating the record when the CRM lacks it.
      let contactId = matchedPerson?.id ?? null;
      if (!contactId && canCreateContact) {
        const [first, ...rest] = (active.personName ?? "").trim().split(/\s+/);
        const created = await createPerson.mutateAsync({
          first_name: first || (active.email?.split("@")[0] ?? "New"),
          last_name: rest.join(" "),
          email: active.email ?? null,
          phone,
          company_id: companyId,
        });
        contactId = created.id;
      }

      const stageId = values.stage_id ?? null;
      const stageDeals = (deals ?? []).filter(
        (d) => !d.deleted_at && d.stage_id === stageId,
      );
      // Name is optional — fall back to whoever the deal is attached to, so a
      // one-tap capture still reads sensibly on the board.
      const typedName = values.name?.trim();
      const deal = await createDeal.mutateAsync({
        name:
          typedName ||
          fallbackDealName({
            company:
              active.companyName ??
              liveCompanies.find((c) => c.id === companyId)?.name,
            contact:
              active.personName ??
              crmPersonName(livePeople.find((p) => p.id === contactId)),
            phone,
          }),
        phone,
        stage_id: stageId,
        status: values.status ?? CRM_LEAD_STATUS_DEFAULT,
        campaign_id: values.campaign_id ?? null,
        close_date: values.close_date ? values.close_date.format("YYYY-MM-DD") : null,
        company_id: companyId,
        contact_id: contactId,
        owner_id: values.owner_id ?? null,
        position: Math.max(0, ...stageDeals.map((d) => d.position)) + 1,
      });

      // The follow-up nudge, if the box is still ticked. The deal is already
      // saved at this point, so a failed reminder degrades to a warning rather
      // than throwing the whole capture away.
      let reminderFailed = false;
      if (values.remind && values.remind_at) {
        try {
          await createReminder.mutateAsync({
            target_type: "deal",
            target_id: deal.id,
            remind_at: values.remind_at.toISOString(),
            note: `Follow up on ${deal.name}`,
          });
        } catch {
          reminderFailed = true;
        }
      }

      // Remember the account and the campaign so the next capture defaults
      // to both — a run of leads from one ad shouldn't need re-picking.
      if (companyId) setLastCompanyId(companyId);
      if (values.campaign_id) setLastCampaignId(values.campaign_id);
      if (reminderFailed) {
        message.warning("Deal created, but the follow-up reminder didn't save.");
      } else {
        message.success(
          active.raw ? "Deal created from your clipboard." : "Deal created.",
        );
      }
      close();
    } catch (err) {
      setSubmitting(false);
      message.error(errMsg(err, "Couldn't create the deal."));
    }
  };

  /* --------------------------------------------------------------- view */

  // Chips summarising what the parser actually recognised, so the user can
  // trust the prefilled form at a glance instead of re-reading every field.
  const found = useMemo(() => {
    if (!parsed) return [];
    const chips: { icon: string; label: string; tone: "success" | "accent" }[] = [];
    if (parsed.closeDate) chips.push({ icon: "event", label: "Close date", tone: "success" });
    if (matchedCompany) {
      chips.push({ icon: "domain", label: `Matched ${matchedCompany.name}`, tone: "success" });
    } else if (canCreateCompany) {
      chips.push({ icon: "add_business", label: `New company`, tone: "accent" });
    }
    if (matchedPerson) {
      chips.push({
        icon: "person",
        label: `Matched ${crmPersonName(matchedPerson)}`,
        tone: "success",
      });
    } else if (canCreateContact) {
      chips.push({ icon: "person_add", label: "New contact", tone: "accent" });
    }
    return chips;
  }, [parsed, matchedCompany, matchedPerson, canCreateCompany, canCreateContact]);

  return (
    <Modal
      open={Boolean(active)}
      onCancel={close}
      footer={null}
      width={520}
      destroyOnHidden
      title={
        <Space size={8}>
          <MIcon
            name={parsed ? "content_paste_go" : "target"}
            size={18}
            color={token.colorPrimary}
          />
          <span>{parsed ? "New deal from clipboard" : "New deal"}</span>
        </Space>
      }
    >
      {active ? (
        <>
          {found.length > 0 ? (
            <Space size={[6, 6]} wrap style={{ marginBottom: 14 }}>
              {found.map((c) => (
                <SoftChip key={c.label} tone={c.tone} icon={c.icon}>
                  {c.label}
                </SoftChip>
              ))}
            </Space>
          ) : null}

          <Form
            key={active.raw || "blank"}
            form={form}
            layout="vertical"
            initialValues={initialValues}
            onFinish={handleSubmit}
          >
            <Form.Item
              name="name"
              label="Deal name"
              extra="Leave blank and we'll name it after the company or contact."
            >
              <Input placeholder="e.g. Acme — Annual plan" autoFocus />
            </Form.Item>

            <Form.Item name="phone" label="Mobile number">
              <Input inputMode="tel" placeholder="+91 98765 43210" maxLength={40} />
            </Form.Item>

            <Space.Compact style={{ width: "100%" }}>
              <Form.Item name="stage_id" label="Stage" style={{ flex: 1, marginRight: 8 }}>
                <Select allowClear options={stageOptions} placeholder="Stage" />
              </Form.Item>
              <Form.Item name="close_date" label="Close date" style={{ flex: 1 }}>
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Space.Compact>

            <Space.Compact style={{ width: "100%" }}>
              <Form.Item
                name="status"
                label="Status"
                style={{ flex: 1, marginRight: 8 }}
              >
                <Select options={statusOptions} placeholder="Status" />
              </Form.Item>
              <Form.Item
                name="campaign_id"
                label="Campaign"
                style={{ flex: 1 }}
              >
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={campaignOptions}
                  placeholder="Which campaign?"
                  notFoundContent="No campaigns yet"
                />
              </Form.Item>
            </Space.Compact>

            {/* Company and owner pair up: two more one-line pickers stacked
                would push the reminder row below the fold on a laptop. */}
            <Space.Compact style={{ width: "100%" }}>
              <Form.Item
                name="company_id"
                label="Company"
                style={{ flex: 1, marginRight: 8 }}
              >
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={companyOptions}
                  placeholder="Company"
                />
              </Form.Item>
              <Form.Item name="owner_id" label="Owner" style={{ flex: 1 }}>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={memberOptions}
                  placeholder="Team member"
                />
              </Form.Item>
            </Space.Compact>

            {/* The nudge that keeps a captured lead from going cold — a
                personal reminder on the new deal, not a team task. */}
            <Form.Item
              name="remind"
              valuePropName="checked"
              style={{ marginBottom: remindTicked ? 8 : undefined }}
            >
              <Checkbox>Remind me to follow up</Checkbox>
            </Form.Item>

            {remindTicked ? (
              <Form.Item name="remind_at" label="Remind me at">
                <DatePicker
                  showTime={{ format: "HH:mm", minuteStep: 5 }}
                  format={CRM_REMIND_AT_FORMAT}
                  disabledDate={crmDisabledRemindDate}
                  allowClear={false}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            ) : null}

            {/* The source text, folded away — proof of what was read.
                Only a pasted dialog has one; a button-opened form does not. */}
            <div style={{ marginBottom: 16, display: active.raw ? undefined : "none" }}>
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                  color: token.colorTextTertiary,
                  fontSize: 12,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <MIcon
                  name={showRaw ? "expand_less" : "expand_more"}
                  size={16}
                  color={token.colorTextTertiary}
                />
                {showRaw ? "Hide pasted text" : "Show pasted text"}
              </button>
              {showRaw ? (
                <div
                  style={{
                    marginTop: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: token.colorFillQuaternary,
                    color: token.colorTextSecondary,
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    maxHeight: 140,
                    overflowY: "auto",
                  }}
                >
                  {active.raw}
                </div>
              ) : null}
            </div>

            <Space style={{ justifyContent: "flex-end", width: "100%" }}>
              <Button onClick={close}>Cancel</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                Create deal
              </Button>
            </Space>
          </Form>
        </>
      ) : null}
    </Modal>
  );
}

/** The quiet hint that makes the shortcut discoverable. */
export function PasteDealHint({ style }: { style?: React.CSSProperties }) {
  const { token } = theme.useToken();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        color: token.colorTextTertiary,
        ...style,
      }}
    >
      <MIcon name="content_paste" size={14} color={token.colorTextQuaternary} />
      Paste a lead anywhere on this page to start a deal
    </span>
  );
}
