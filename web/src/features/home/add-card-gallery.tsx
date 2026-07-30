"use client";

import { useMemo, useState } from "react";
import { Empty, Input, Modal, Tag, theme } from "antd";
import {
  PRESET_CATEGORIES,
  presetsForViewer,
  type CardPreset,
} from "./card-presets";
import { useAnalyticsCapabilities } from "./analytics-access";

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

const CATEGORY_ICON: Record<string, string> = {
  Featured: "star",
  Performance: "trophy",
  Workload: "groups",
  Deadlines: "event_upcoming",
  Overview: "donut_small",
  KPIs: "tag",
  Lists: "format_list_bulleted",
  Personal: "person",
};

/** Tint per category for the tile header band (brand-adjacent, not status). */
const CATEGORY_TINT: Record<string, string> = {
  Performance: "#4a4ad0",
  Workload: "#1c7ed6",
  Deadlines: "#d9480f",
  Overview: "#2b8a3e",
  KPIs: "#5f3dc4",
  Lists: "#0b7285",
  Personal: "#862e9c",
};

/**
 * The Add-card gallery — pick what the card should SAY before tuning how it
 * looks (the config drawer, with its live preview, is step two).
 *
 * The offer is role-shaped via useAnalyticsCapabilities: viewers without team
 * scope (limited members, guests) see only user-level presets — offering
 * "workload by member" to someone whose data is their own tasks would render
 * a chart of just themselves mislabelled as the team. Data stays RLS-scoped
 * regardless of what's picked here.
 */
export function AddCardGallery({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** A chosen preset, or null for a blank custom card. */
  onPick: (preset: CardPreset | null) => void;
}) {
  const { token } = theme.useToken();
  const caps = useAnalyticsCapabilities();
  const [category, setCategory] = useState<string>("Featured");
  const [search, setSearch] = useState("");

  const available = useMemo(() => presetsForViewer(caps.teamScope), [caps.teamScope]);

  const categories = useMemo(() => {
    const withPresets = PRESET_CATEGORIES.filter((c) =>
      available.some((p) => p.category === c),
    );
    return ["Featured", ...withPresets];
  }, [available]);

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => {
    if (q) {
      return available.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q),
      );
    }
    if (category === "Featured") return available.filter((p) => p.featured);
    return available.filter((p) => p.category === category);
  }, [available, q, category]);

  const pick = (preset: CardPreset | null) => {
    setSearch("");
    onPick(preset);
  };

  const customTile = (
    <button
      type="button"
      onClick={() => pick(null)}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 12,
        overflow: "hidden",
        border: `1.5px dashed ${token.colorBorder}`,
        background: token.colorBgContainer,
        cursor: "pointer",
        textAlign: "left",
        minHeight: 150,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          minHeight: 84,
          color: token.colorTextTertiary,
        }}
      >
        <MIcon name="add_circle" size={34} color={token.colorTextQuaternary} />
      </div>
      <div style={{ padding: "10px 12px 12px" }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: token.colorText }}>Custom card</div>
        <div style={{ marginTop: 2, fontSize: 12, color: token.colorTextSecondary, lineHeight: 1.45 }}>
          Start blank and build your own chart, KPI or list.
        </div>
      </div>
    </button>
  );

  return (
    <Modal
      open={open}
      onCancel={() => {
        setSearch("");
        onClose();
      }}
      footer={null}
      width="min(960px, calc(100vw - 24px))"
      destroyOnHidden
      styles={{ body: { padding: 0 }, content: { padding: 0, overflow: "hidden" } }}
    >
      <div style={{ display: "flex", minHeight: 480, maxHeight: "78vh" }}>
        {/* Category rail */}
        <div
          style={{
            width: 190,
            flex: "none",
            borderRight: `1px solid ${token.colorSplit}`,
            padding: "18px 10px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 8px 12px",
              fontSize: 15,
              fontWeight: 700,
              color: token.colorText,
            }}
          >
            <MIcon name="dashboard_customize" size={19} color="#4a4ad0" />
            Add card
          </div>
          {categories.map((c) => {
            const active = !q && c === category;
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setCategory(c);
                  setSearch("");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "7px 10px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  background: active ? token.colorPrimaryBg : "transparent",
                  color: active ? token.colorPrimary : token.colorTextSecondary,
                }}
              >
                <MIcon
                  name={CATEGORY_ICON[c] ?? "widgets"}
                  size={17}
                  color={active ? token.colorPrimary : token.colorTextTertiary}
                />
                {c}
              </button>
            );
          })}
        </div>

        {/* Tiles */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px",
              borderBottom: `1px solid ${token.colorSplit}`,
            }}
          >
            <span style={{ fontSize: 14.5, fontWeight: 600, color: token.colorText, flex: "none" }}>
              {q ? "Search" : category}
            </span>
            <Input
              allowClear
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cards…"
              prefix={<MIcon name="search" size={16} color={token.colorTextTertiary} />}
              style={{ maxWidth: 300, marginLeft: "auto" }}
            />
          </div>

          {/* Role note — say what the numbers cover, don't make users guess. */}
          <div
            style={{
              padding: "8px 18px 0",
              fontSize: 12,
              color: token.colorTextTertiary,
            }}
          >
            {caps.teamScope
              ? caps.tier === "member"
                ? "Charts cover the spaces and projects you can access."
                : "Charts cover the whole workspace."
              : "You're seeing personal analytics — cards cover your own tasks."}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px 18px" }}>
            {shown.length === 0 && q ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`Nothing matches "${search.trim()}"`}
                style={{ marginTop: 48 }}
              />
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))",
                  gap: 12,
                }}
              >
                {!q && category === "Featured" ? customTile : null}
                {shown.map((p) => {
                  const tint = CATEGORY_TINT[p.category] ?? "#4a4ad0";
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => pick(p)}
                      className="cardgal-tile"
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        borderRadius: 12,
                        overflow: "hidden",
                        border: `1px solid ${token.colorBorderSecondary}`,
                        background: token.colorBgContainer,
                        cursor: "pointer",
                        textAlign: "left",
                        minHeight: 150,
                        transition: "border-color .12s, box-shadow .12s",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minHeight: 84,
                          background: `color-mix(in srgb, ${tint} 9%, transparent)`,
                        }}
                      >
                        <MIcon name={p.icon} size={32} color={tint} />
                      </div>
                      <div style={{ padding: "10px 12px 12px", flex: 1 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: token.colorText,
                          }}
                        >
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.title}
                          </span>
                          <Tag
                            style={{ margin: 0, fontSize: 10, lineHeight: "15px", flex: "none" }}
                            color={p.level === "team" ? "geekblue" : undefined}
                          >
                            {p.level === "team" ? "Team" : "You"}
                          </Tag>
                        </div>
                        <div
                          style={{
                            marginTop: 3,
                            fontSize: 12,
                            color: token.colorTextSecondary,
                            lineHeight: 1.45,
                          }}
                        >
                          {p.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`.cardgal-tile:hover { border-color: #4a4ad0 !important; box-shadow: 0 4px 14px -6px rgba(74,74,208,.35); }`}</style>
    </Modal>
  );
}
