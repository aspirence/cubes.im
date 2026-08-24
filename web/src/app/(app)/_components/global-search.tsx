"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Empty, Input, Modal, Spin, Typography, theme } from "antd";
import type { InputRef } from "antd";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useUIStore } from "@/store/ui-store";

/** One row from the global_search RPC. */
interface SearchHit {
  kind: "project" | "task" | "comment" | "doc";
  id: string;
  title: string;
  snippet: string | null;
  project_id: string;
  project_name: string;
  task_id: string | null;
  task_no: number | null;
}

const KIND_META: Record<
  SearchHit["kind"],
  { label: string; icon: string }
> = {
  project: { label: "Projects", icon: "folder" },
  task: { label: "Tasks", icon: "task_alt" },
  comment: { label: "Comments", icon: "chat_bubble_outline" },
  doc: { label: "Docs", icon: "description" },
};

const KIND_ORDER: SearchHit["kind"][] = ["project", "task", "comment", "doc"];

function MIcon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1 }}
    >
      {name}
    </span>
  );
}

/** Where a hit navigates: the task drawer's ?task=/&comment= deep links, the
 *  docs tab, or the project itself. */
function hitUrl(hit: SearchHit): string {
  switch (hit.kind) {
    case "task":
      return `/projects/${hit.project_id}?task=${hit.task_id}`;
    case "comment":
      return `/projects/${hit.project_id}?task=${hit.task_id}&comment=${hit.id}`;
    case "doc":
      return `/projects/${hit.project_id}?tab=doc`;
    default:
      return `/projects/${hit.project_id}`;
  }
}

/**
 * The top-bar global search: a button beside "+ New" and a ⌘K / Ctrl+K
 * command-palette modal searching the whole workspace in one RPC — projects,
 * tasks (name + description), task comments, and doc titles.
 */
export function GlobalSearch() {
  const router = useRouter();
  const { token } = theme.useToken();
  const dark = useUIStore((s) => s.themeMode === "dark");
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  const supabase = useMemo(() => createClient(), []);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<InputRef>(null);

  // ⌘K / Ctrl+K from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Small debounce so we search per pause, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = debounced.trim();
  const resultsQuery = useQuery({
    queryKey: ["global-search", teamId, query],
    enabled: open && Boolean(teamId) && query.length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<SearchHit[]> => {
      // global_search postdates the generated Database types (the Supabase CLI
      // isn't linked here to regenerate them) — hence the casts.
      const { data, error } = await supabase.rpc(
        "global_search" as never,
        { p_team_id: teamId, p_query: query } as never,
      );
      if (error) throw error;
      return (data ?? []) as unknown as SearchHit[];
    },
  });

  // Grouped for headers, flat for keyboard order.
  const flat = useMemo(() => {
    const hits = resultsQuery.data ?? [];
    return KIND_ORDER.flatMap((k) => hits.filter((h) => h.kind === k));
  }, [resultsQuery.data]);

  useEffect(() => setActiveIndex(0), [flat]);

  const close = () => {
    setOpen(false);
    setQ("");
    setDebounced("");
  };

  const openHit = (hit: SearchHit) => {
    close();
    router.push(hitUrl(hit));
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flat[activeIndex]) {
      e.preventDefault();
      openHit(flat[activeIndex]);
    }
  };

  const muted = token.colorTextTertiary;
  const isMac =
    typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform);

  let flatIndex = -1;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Search everything"
        title={`Search (${isMac ? "⌘" : "Ctrl+"}K)`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 34,
          padding: "0 10px",
          border: `1px solid ${dark ? "#262b37" : "#e6e7ec"}`,
          background: dark ? "#14171f" : "#fff",
          borderRadius: 8,
          color: dark ? "#cdd2dd" : "#44464f",
          fontSize: 12.5,
          cursor: "pointer",
        }}
      >
        <MIcon name="search" size={18} />
        <span
          style={{
            fontSize: 11,
            color: muted,
            border: `1px solid ${dark ? "#262b37" : "#e6e7ec"}`,
            borderRadius: 4,
            padding: "1px 4px",
            lineHeight: 1.3,
          }}
        >
          {isMac ? "⌘K" : "Ctrl K"}
        </span>
      </button>

      {/* globals.css centers every modal (flex + margin:auto); a command
          palette belongs at the top of the screen, so this wrap opts out. */}
      <style>{`
        .gs-modal-wrap.ant-modal-wrap { align-items: flex-start; padding-top: 76px; }
        .gs-modal-wrap .ant-modal { margin: 0 auto; }
      `}</style>
      <Modal
        open={open}
        onCancel={close}
        footer={null}
        closable={false}
        width={620}
        wrapClassName="gs-modal-wrap"
        afterOpenChange={(o) => {
          if (o) inputRef.current?.focus();
        }}
        styles={{ content: { padding: 12 } }}
      >
        <Input
          ref={inputRef}
          size="large"
          allowClear
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Search projects, tasks, comments, docs…"
          prefix={
            <span style={{ color: muted, display: "inline-flex" }}>
              <MIcon name="search" size={19} />
            </span>
          }
          variant="borderless"
          autoFocus
        />

        <div
          style={{
            maxHeight: "56vh",
            overflowY: "auto",
            marginTop: 8,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {query.length < 2 ? (
            <div style={{ padding: "26px 12px", textAlign: "center" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                Type at least 2 characters — searches the whole workspace.
              </Typography.Text>
            </div>
          ) : resultsQuery.isFetching && flat.length === 0 ? (
            <div style={{ padding: 28, textAlign: "center" }}>
              <Spin size="small" />
            </div>
          ) : flat.length === 0 ? (
            <div style={{ padding: "18px 0" }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`No results for “${query}”`}
              />
            </div>
          ) : (
            KIND_ORDER.map((k) => {
              const group = flat.filter((h) => h.kind === k);
              if (group.length === 0) return null;
              return (
                <div key={k} style={{ paddingTop: 8 }}>
                  <div
                    style={{
                      padding: "2px 10px 4px",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      textTransform: "uppercase",
                      color: muted,
                    }}
                  >
                    {KIND_META[k].label}
                  </div>
                  {group.map((hit) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    const active = idx === activeIndex;
                    return (
                      <div
                        key={`${hit.kind}:${hit.id}`}
                        onClick={() => openHit(hit)}
                        onMouseEnter={() => setActiveIndex(idx)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 10px",
                          borderRadius: 8,
                          cursor: "pointer",
                          background: active
                            ? token.colorFillTertiary
                            : "transparent",
                        }}
                      >
                        <span style={{ color: muted, display: "inline-flex", flex: "none" }}>
                          <MIcon name={KIND_META[hit.kind].icon} size={17} />
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: 13.5,
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {hit.task_no != null ? (
                              <span style={{ color: muted, fontWeight: 500 }}>
                                #{hit.task_no}{" "}
                              </span>
                            ) : null}
                            {hit.title}
                          </div>
                          {hit.snippet ? (
                            <div
                              style={{
                                fontSize: 12,
                                color: muted,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {hit.snippet}
                            </div>
                          ) : null}
                        </div>
                        <span
                          style={{
                            flex: "none",
                            fontSize: 11.5,
                            color: muted,
                            maxWidth: 140,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {hit.project_name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </Modal>
    </>
  );
}
