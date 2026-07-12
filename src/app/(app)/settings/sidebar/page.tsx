"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Card, Space, Tag, Typography, theme } from "antd";
import { useInstalledApps } from "@/features/apps-platform/use-installed-apps";
import {
  getPrimarySidebarCatalog,
  orderPrimarySidebarItems,
  type PrimarySidebarItem,
} from "@/app/(app)/_lib/primary-sidebar";
import {
  DEFAULT_SIDEBAR_PINNED_ITEM_IDS,
  useUIStore,
} from "@/store/ui-store";

function MIcon({
  name,
  size = 18,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1, color }}
    >
      {name}
    </span>
  );
}

function SortablePinnedItem({
  item,
  onRemove,
}: {
  item: PrimarySidebarItem;
  onRemove: (id: string) => void;
}) {
  const { token } = theme.useToken();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: Boolean(item.fixedFirst) });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.78 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 12,
          background: token.colorBgContainer,
          boxShadow: isDragging ? "0 10px 24px rgba(16,24,40,.12)" : "0 1px 2px rgba(16,24,40,.04)",
        }}
      >
        {item.fixedFirst ? (
          // Home is pinned to first and can't be dragged.
          <span
            title="Pinned to first"
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: token.colorFillTertiary,
              color: token.colorTextQuaternary,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <MIcon name="push_pin" />
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Drag ${item.label}`}
            {...attributes}
            {...listeners}
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              border: "none",
              background: token.colorFillTertiary,
              color: token.colorTextTertiary,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "grab",
              flex: "none",
            }}
          >
            <MIcon name="drag_indicator" />
          </button>
        )}

        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: item.kind === "app" ? token.colorPrimaryBg : token.colorFillTertiary,
            color: item.kind === "app" ? "#4a4ad0" : token.colorTextSecondary,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <MIcon name={item.icon} size={20} />
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: token.colorText,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>{item.label}</span>
            <Tag
              bordered={false}
              color={item.kind === "app" ? "processing" : "default"}
              style={{ marginInlineEnd: 0, fontSize: 11 }}
            >
              {item.kind === "app" ? "Installed app" : "Core"}
            </Tag>
            {item.locked ? (
              <Tag bordered={false} color="gold" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                Required
              </Tag>
            ) : null}
          </div>
          <div style={{ marginTop: 3, fontSize: 12.5, color: token.colorTextSecondary }}>
            {item.kind === "app"
              ? "Opens the installed app directly from the primary rail."
              : "Shows this workspace area in the primary rail."}
          </div>
        </div>

        <Button
          type="text"
          onClick={() => onRemove(item.id)}
          disabled={item.locked}
          icon={<MIcon name="remove_circle" size={18} />}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

function AvailableItemCard({
  item,
  onAdd,
}: {
  item: PrimarySidebarItem;
  onAdd: (id: string) => void;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 12,
        background: token.colorBgContainer,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: item.kind === "app" ? token.colorPrimaryBg : token.colorFillTertiary,
          color: item.kind === "app" ? "#4a4ad0" : token.colorTextSecondary,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <MIcon name={item.icon} size={20} />
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: token.colorText,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>{item.label}</span>
          <Tag
            bordered={false}
            color={item.kind === "app" ? "processing" : "default"}
            style={{ marginInlineEnd: 0, fontSize: 11 }}
          >
            {item.kind === "app" ? "Installed app" : "Core"}
          </Tag>
        </div>
        <div style={{ marginTop: 3, fontSize: 12.5, color: token.colorTextSecondary }}>
          Add this item to the primary sidebar.
        </div>
      </div>

      <Button type="primary" ghost onClick={() => onAdd(item.id)}>
        Add
      </Button>
    </div>
  );
}

export default function SidebarSettingsPage() {
  const { data: installedApps } = useInstalledApps();
  const sidebarPinnedItemIds = useUIStore((s) => s.sidebarPinnedItemIds);
  const setSidebarPinnedItems = useUIStore((s) => s.setSidebarPinnedItems);
  const resetSidebarPinnedItems = useUIStore((s) => s.resetSidebarPinnedItems);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const catalog = getPrimarySidebarCatalog(installedApps);
  const pinnedItems = orderPrimarySidebarItems(catalog, sidebarPinnedItemIds);
  const pinnedIds = pinnedItems.map((item) => item.id);
  const availableItems = catalog.filter((item) => !pinnedIds.includes(item.id));

  const handleAdd = (id: string) => {
    setSidebarPinnedItems([...pinnedIds, id]);
  };

  const handleRemove = (id: string) => {
    const item = pinnedItems.find((entry) => entry.id === id);
    if (item?.locked) return;
    setSidebarPinnedItems(pinnedIds.filter((entryId) => entryId !== id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Home (fixedFirst) can't be moved, and nothing drops above it.
    const fixedCount = pinnedItems.filter((item) => item.fixedFirst).length;
    const activeItem = pinnedItems.find((entry) => entry.id === String(active.id));
    if (activeItem?.fixedFirst) return;
    const oldIndex = pinnedIds.indexOf(String(active.id));
    const newIndex = Math.max(fixedCount, pinnedIds.indexOf(String(over.id)));
    if (oldIndex < 0 || newIndex < 0) return;
    setSidebarPinnedItems(arrayMove(pinnedIds, oldIndex, newIndex));
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 6 }}>
              Sidebar
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Pin more destinations into the primary rail, including installed
              apps, and drag them into the order you want. Default set:{" "}
              {DEFAULT_SIDEBAR_PINNED_ITEM_IDS.length} core items.
            </Typography.Paragraph>
          </div>
          <Button onClick={resetSidebarPinnedItems}>Reset defaults</Button>
        </div>
      </Card>

      <Card
        title="Pinned items"
        extra={
          <Typography.Text type="secondary">
            Drag to reorder
          </Typography.Text>
        }
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
            <div style={{ display: "grid", gap: 10 }}>
              {pinnedItems.map((item) => (
                <SortablePinnedItem
                  key={item.id}
                  item={item}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </Card>

      <Card
        title="Available items"
        extra={
          <Typography.Text type="secondary">
            {availableItems.length === 0
              ? "Nothing left to add"
              : `${availableItems.length} available`}
          </Typography.Text>
        }
      >
        {availableItems.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {availableItems.map((item) => (
              <AvailableItemCard
                key={item.id}
                item={item}
                onAdd={handleAdd}
              />
            ))}
          </div>
        ) : (
          <Typography.Text type="secondary">
            Install more apps from App Center or re-add hidden core sections here.
          </Typography.Text>
        )}
      </Card>
    </Space>
  );
}
