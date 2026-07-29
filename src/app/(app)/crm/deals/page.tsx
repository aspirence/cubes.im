"use client";

import { useMemo, useState } from "react";
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
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  theme,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useCreateCrmDeal,
  useCrmDeals,
  useDestroyCrmDeal,
  useMoveCrmDeal,
  useSetCrmDealDeleted,
  useUpdateCrmDeal,
} from "@/features/app-crm/use-crm-deals";
import { useCrmStages } from "@/features/app-crm/use-crm-stages";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import {
  CRM_CURRENCIES,
  crmMoney,
  crmPersonName,
  type CrmDealWithRefs,
  type CrmStage,
  type CrmTargetRef,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";

/** The board's "no stage" pseudo-column id (column ids are `col:<id>`). */
const NO_STAGE = "none";
const colId = (stageId: string) => `col:${stageId}`;

type DealFormValues = {
  name: string;
  amount?: number | null;
  currency_code?: string;
  stage_id?: string | null;
  close_date?: Dayjs | null;
  company_id?: string | null;
  contact_id?: string | null;
  owner_id?: string | null;
};

function DealCard({
  deal,
  onOpen,
  dragOverlay,
}: {
  deal: CrmDealWithRefs;
  onOpen?: (deal: CrmDealWithRefs) => void;
  dragOverlay?: boolean;
}) {
  const { token } = theme.useToken();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deal.id, disabled: dragOverlay });

  return (
    <div
      ref={dragOverlay ? undefined : setNodeRef}
      {...(dragOverlay ? {} : attributes)}
      {...(dragOverlay ? {} : listeners)}
      onClick={() => onOpen?.(deal)}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 8,
        padding: "10px 12px",
        cursor: "pointer",
        boxShadow: dragOverlay ? token.boxShadowSecondary : undefined,
      }}
    >
      <div style={{ fontWeight: 500, marginBottom: 4 }}>{deal.name}</div>
      <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
        {crmMoney(deal.amount, deal.currency_code)}
        {deal.company ? ` · ${deal.company.name}` : ""}
      </div>
      {(deal.contact || deal.close_date) && (
        <div
          style={{
            fontSize: 12,
            color: token.colorTextTertiary,
            marginTop: 4,
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>{crmPersonName(deal.contact)}</span>
          {deal.close_date ? (
            <span
              style={
                dayjs(deal.close_date).isBefore(dayjs(), "day")
                  ? { color: token.colorError, fontWeight: 600 }
                  : undefined
              }
            >
              {dayjs(deal.close_date).format("DD MMM")}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function BoardColumn({
  id,
  name,
  color,
  deals,
  onOpen,
  onAdd,
}: {
  id: string;
  name: string;
  color: string;
  deals: CrmDealWithRefs[];
  onOpen: (deal: CrmDealWithRefs) => void;
  onAdd?: () => void;
}) {
  const { token } = theme.useToken();
  const { setNodeRef, isOver } = useDroppable({ id });
  const total = deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const currency = deals.find((d) => d.amount !== null)?.currency_code ?? "USD";

  return (
    <div
      ref={setNodeRef}
      style={{
        width: 280,
        flexShrink: 0,
        background: isOver
          ? token.colorFillTertiary
          : token.colorFillQuaternary,
        borderRadius: 10,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxHeight: "calc(100vh - 240px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "2px 4px",
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: color,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 600 }}>{name}</span>
        <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>
          {deals.length}
        </span>
        <span
          style={{
            marginLeft: "auto",
            color: token.colorTextSecondary,
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          {crmMoney(total, currency)}
        </span>
        {onAdd ? (
          <Button
            type="text"
            size="small"
            aria-label={`Add a deal in ${name}`}
            icon={<MIcon name="add" size={16} />}
            onClick={onAdd}
            style={{ flexShrink: 0 }}
          />
        ) : null}
      </div>
      <div
        style={{
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minHeight: 24,
        }}
      >
        <SortableContext
          items={deals.map((d) => d.id)}
          strategy={verticalListSortingStrategy}
        >
          {deals.map((d) => (
            <DealCard key={d.id} deal={d} onOpen={onOpen} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

export default function CrmDealsPage() {
  const { message } = App.useApp();
  const { data: deals, isLoading } = useCrmDeals();
  const { data: stages } = useCrmStages();
  const { data: companies } = useCrmCompanies();
  const { data: people } = useCrmPeople();
  const { data: members } = useTeamMembers();
  const createDeal = useCreateCrmDeal();
  const updateDeal = useUpdateCrmDeal();
  const moveDeal = useMoveCrmDeal();
  const setDeleted = useSetCrmDealDeleted();
  const destroyDeal = useDestroyCrmDeal();

  const [view, setView] = useState<"board" | "table">("board");
  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmDealWithRefs | null>(null);
  const [viewTarget, setViewTarget] = useState<CrmTargetRef | null>(null);
  const [activeDeal, setActiveDeal] = useState<CrmDealWithRefs | null>(null);
  const [form] = Form.useForm<DealFormValues>();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const liveDeals = useMemo(
    () => (deals ?? []).filter((d) => !d.deleted_at),
    [deals],
  );

  const knownStageIds = useMemo(
    () => new Set((stages ?? []).map((s) => s.id)),
    [stages],
  );

  const columns = useMemo(() => {
    const cols: {
      id: string;
      stageId: string | null;
      name: string;
      color: string;
      deals: CrmDealWithRefs[];
    }[] = (stages ?? []).map((s: CrmStage) => ({
      id: colId(s.id),
      stageId: s.id,
      name: s.name,
      color: s.color,
      deals: liveDeals
        .filter((d) => d.stage_id === s.id)
        .sort((a, b) => a.position - b.position),
    }));
    const orphans = liveDeals
      .filter((d) => !d.stage_id || !knownStageIds.has(d.stage_id))
      .sort((a, b) => a.position - b.position);
    if (orphans.length > 0) {
      cols.push({
        id: colId(NO_STAGE),
        stageId: null,
        name: "No stage",
        color: "#8a8d98",
        deals: orphans,
      });
    }
    return cols;
  }, [stages, liveDeals, knownStageIds]);

  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) if (m.user) map.set(m.user.id, m.user.name);
    return (id: string | null) => (id && map.get(id)) || "—";
  }, [members]);

  const tableRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (deals ?? [])
      .filter((d) => (showDeleted ? Boolean(d.deleted_at) : !d.deleted_at))
      .filter((d) => {
        if (!needle) return true;
        return [d.name, d.company?.name ?? "", crmPersonName(d.contact)]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
  }, [deals, search, showDeleted]);

  const stageById = useMemo(() => {
    const map = new Map<string, CrmStage>();
    for (const s of stages ?? []) map.set(s.id, s);
    return map;
  }, [stages]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDeal(liveDeals.find((d) => d.id === event.active.id) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDeal(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const overId = String(over.id);

    // Resolve the target column: a column id, or the column holding the card.
    const targetCol = overId.startsWith("col:")
      ? columns.find((c) => c.id === overId)
      : columns.find((c) => c.deals.some((d) => d.id === overId));
    if (!targetCol) return;

    const rest = targetCol.deals.filter((d) => d.id !== dealId);
    let position: number;
    if (overId.startsWith("col:") || rest.length === 0) {
      position = (rest[rest.length - 1]?.position ?? 0) + 1;
    } else {
      const overIndex = rest.findIndex((d) => d.id === overId);
      if (overIndex === -1) {
        position = (rest[rest.length - 1]?.position ?? 0) + 1;
      } else {
        const prev = rest[overIndex - 1];
        const next = rest[overIndex];
        position = prev
          ? (prev.position + next.position) / 2
          : next.position - 1;
      }
    }

    const current = liveDeals.find((d) => d.id === dealId);
    if (
      current &&
      current.stage_id === targetCol.stageId &&
      current.position === position
    ) {
      return;
    }
    moveDeal.mutate(
      { id: dealId, stage_id: targetCol.stageId, position },
      {
        onError: (err) =>
          message.error(errMsg(err, "Failed to move the deal.")),
      },
    );
  };

  const companyOptions = useMemo(
    () =>
      (companies ?? [])
        .filter((c) => !c.deleted_at)
        .map((c) => ({ value: c.id, label: c.name })),
    [companies],
  );
  const peopleOptions = useMemo(
    () =>
      (people ?? [])
        .filter((p) => !p.deleted_at)
        .map((p) => ({ value: p.id, label: crmPersonName(p) || "Unnamed" })),
    [people],
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

  const openCreate = (stageId?: string | null) => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ stage_id: stageId ?? stages?.[0]?.id ?? null });
    setFormOpen(true);
  };

  const openEdit = (deal: CrmDealWithRefs) => {
    setEditing(deal);
    form.setFieldsValue({
      name: deal.name,
      amount: deal.amount,
      currency_code: deal.currency_code,
      stage_id: deal.stage_id,
      close_date: deal.close_date ? dayjs(deal.close_date) : null,
      company_id: deal.company_id,
      contact_id: deal.contact_id,
      owner_id: deal.owner_id,
    });
    setFormOpen(true);
  };

  const handleSubmit = async (values: DealFormValues) => {
    const stageDeals = liveDeals.filter(
      (d) => d.stage_id === (values.stage_id ?? null),
    );
    const patch = {
      name: values.name.trim(),
      amount: values.amount ?? null,
      currency_code: values.currency_code || "USD",
      stage_id: values.stage_id ?? null,
      close_date: values.close_date
        ? values.close_date.format("YYYY-MM-DD")
        : null,
      company_id: values.company_id ?? null,
      contact_id: values.contact_id ?? null,
      owner_id: values.owner_id ?? null,
    };
    try {
      if (editing) {
        await updateDeal.mutateAsync({ id: editing.id, patch });
        message.success("Deal updated.");
      } else {
        await createDeal.mutateAsync({
          ...patch,
          position:
            Math.max(0, ...stageDeals.map((d) => d.position)) + 1,
        });
        message.success("Deal created.");
      }
      setFormOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Failed to save deal."));
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Space
        style={{
          width: "100%",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Deals
          </Typography.Title>
          <Segmented
            value={view}
            onChange={(v) => setView(v as "board" | "table")}
            options={[
              { value: "board", label: "Board" },
              { value: "table", label: "Table" },
            ]}
          />
        </Space>
        <Space wrap>
          {view === "table" && (
            <>
              <Input
                allowClear
                prefix={<MIcon name="search" size={16} />}
                placeholder="Search deals…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 220 }}
              />
              <Space size={6}>
                <Switch
                  size="small"
                  checked={showDeleted}
                  onChange={setShowDeleted}
                />
                <Typography.Text type="secondary">Deleted</Typography.Text>
              </Space>
            </>
          )}
          <Button
            type="primary"
            icon={<MIcon name="add" size={16} />}
            onClick={() => openCreate()}
          >
            New deal
          </Button>
        </Space>
      </Space>

      {view === "board" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDeal(null)}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              overflowX: "auto",
              alignItems: "flex-start",
              paddingBottom: 12,
            }}
          >
            {columns.map((c) => (
              <BoardColumn
                key={c.id}
                id={c.id}
                name={c.name}
                color={c.color}
                deals={c.deals}
                onOpen={(deal) =>
                  setViewTarget({ type: "deal", id: deal.id })
                }
                onAdd={
                  c.stageId ? () => openCreate(c.stageId) : undefined
                }
              />
            ))}
          </div>
          <DragOverlay>
            {activeDeal ? <DealCard deal={activeDeal} dragOverlay /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <Table
          rowKey="id"
          size="middle"
          loading={isLoading}
          dataSource={tableRows}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          onRow={(d) => ({
            onClick: () => setViewTarget({ type: "deal", id: d.id }),
            style: { cursor: "pointer" },
          })}
          columns={[
            {
              title: "Deal",
              dataIndex: "name",
              render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
              sorter: (a, b) => a.name.localeCompare(b.name),
            },
            {
              title: "Stage",
              key: "stage",
              render: (_, d) => {
                const stage = d.stage_id ? stageById.get(d.stage_id) : null;
                return stage ? (
                  <Tag color={stage.color}>{stage.name}</Tag>
                ) : (
                  <Tag>No stage</Tag>
                );
              },
              filters: (stages ?? []).map((s) => ({
                text: s.name,
                value: s.id,
              })),
              onFilter: (value, d) => d.stage_id === value,
            },
            {
              title: "Amount",
              key: "amount",
              render: (_, d) => crmMoney(d.amount, d.currency_code),
              sorter: (a, b) => (a.amount ?? 0) - (b.amount ?? 0),
            },
            {
              title: "Company",
              key: "company",
              render: (_, d) => d.company?.name ?? "—",
            },
            {
              title: "Contact",
              key: "contact",
              render: (_, d) => crmPersonName(d.contact) || "—",
            },
            {
              title: "Owner",
              key: "owner",
              render: (_, d) => memberName(d.owner_id),
            },
            {
              title: "Close date",
              dataIndex: "close_date",
              render: (v: string | null) =>
                v ? dayjs(v).format("DD MMM YYYY") : "—",
              sorter: (a, b) =>
                (a.close_date ?? "").localeCompare(b.close_date ?? ""),
            },
            {
              title: "",
              key: "actions",
              width: 120,
              render: (_, d) => (
                <Space onClick={(e) => e.stopPropagation()}>
                  {d.deleted_at ? (
                    <>
                      <Button
                        size="small"
                        onClick={async () => {
                          try {
                            await setDeleted.mutateAsync({
                              id: d.id,
                              deleted: false,
                            });
                            message.success("Deal restored.");
                          } catch (err) {
                            message.error(errMsg(err, "Failed to restore."));
                          }
                        }}
                      >
                        Restore
                      </Button>
                      <Popconfirm
                        title="Permanently delete this deal?"
                        description="This cannot be undone."
                        onConfirm={async () => {
                          try {
                            await destroyDeal.mutateAsync(d.id);
                            message.success("Deal permanently deleted.");
                          } catch (err) {
                            message.error(errMsg(err, "Failed to delete."));
                          }
                        }}
                      >
                        <Button size="small" danger>
                          Destroy
                        </Button>
                      </Popconfirm>
                    </>
                  ) : (
                    <>
                      <Button
                        type="text"
                        size="small"
                        icon={<MIcon name="edit" size={16} />}
                        onClick={() => openEdit(d)}
                      />
                      <Popconfirm
                        title="Delete this deal?"
                        description="It moves to Deleted and can be restored."
                        onConfirm={async () => {
                          try {
                            await setDeleted.mutateAsync({
                              id: d.id,
                              deleted: true,
                            });
                            message.success("Deal deleted.");
                          } catch (err) {
                            message.error(errMsg(err, "Failed to delete."));
                          }
                        }}
                      >
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<MIcon name="delete" size={16} />}
                        />
                      </Popconfirm>
                    </>
                  )}
                </Space>
              ),
            },
          ]}
        />
      )}

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit deal" : "New deal"}
        width={420}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Deal name"
            rules={[{ required: true, message: "Deal name is required" }]}
          >
            <Input placeholder="e.g. Acme — Annual plan" />
          </Form.Item>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item
              name="amount"
              label="Amount"
              style={{ flex: 1, marginRight: 8 }}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                placeholder="10000"
              />
            </Form.Item>
            <Form.Item
              name="currency_code"
              label="Currency"
              initialValue="USD"
              style={{ width: 110 }}
            >
              <Select
                options={CRM_CURRENCIES.map((c) => ({ value: c, label: c }))}
              />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="stage_id" label="Stage">
            <Select allowClear options={stageOptions} placeholder="Stage" />
          </Form.Item>
          <Form.Item name="close_date" label="Close date">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="company_id" label="Company">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={companyOptions}
              placeholder="Company"
            />
          </Form.Item>
          <Form.Item name="contact_id" label="Point of contact">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={peopleOptions}
              placeholder="Person"
            />
          </Form.Item>
          <Form.Item name="owner_id" label="Owner">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={memberOptions}
              placeholder="Team member"
            />
          </Form.Item>
          <Space style={{ justifyContent: "flex-end", width: "100%" }}>
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={createDeal.isPending || updateDeal.isPending}
            >
              {editing ? "Save changes" : "Create deal"}
            </Button>
          </Space>
        </Form>
      </Drawer>

      <RecordDrawer target={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
