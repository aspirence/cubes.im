"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Dropdown,
  Empty,
  Spin,
  Tooltip,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import {
  useDocs,
  usePages,
  usePageShares,
  useCreateDoc,
  useCreatePage,
  useUpdatePage,
  useDeletePage,
  type Block,
  type Page,
} from "@/features/app-docs/use-docs";
import { useProjectMembers } from "@/features/projects/use-project-members";
import { BlockEditor } from "@/features/app-docs/block-editor";
import { PageShareModal } from "./page-share-modal";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

interface TreeNode {
  page: Page;
  children: TreeNode[];
  depth: number;
}

function buildTree(pages: Page[]): TreeNode[] {
  const byParent = new Map<string | null, Page[]>();
  for (const p of pages) {
    const key = p.parent_id ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(p);
    byParent.set(key, arr);
  }
  const build = (parentId: string | null, depth: number): TreeNode[] =>
    (byParent.get(parentId) ?? []).map((page) => ({
      page,
      depth,
      children: build(page.id, depth + 1),
    }));
  return build(null, 0);
}

export function DocsTab({ projectId }: { projectId: string }) {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const { data: docs, isLoading: docsLoading, refetch: refetchDocs } = useDocs(projectId);
  const createDoc = useCreateDoc();
  const createPage = useCreatePage();
  const updatePage = useUpdatePage();
  const deletePage = useDeletePage();

  // Exactly one doc per project, generated on demand (enforced by a unique index).
  const doc = (docs ?? [])[0] ?? null;
  const docId = doc?.id ?? null;
  const docIdRef = useRef<string | null>(null);
  useEffect(() => {
    docIdRef.current = docId;
  }, [docId]);

  const ensuredRef = useRef(false);
  useEffect(() => {
    if (!docsLoading && (docs?.length ?? 0) === 0 && !ensuredRef.current) {
      ensuredRef.current = true;
      createDoc
        .mutateAsync({ projectId, title: "Project doc" })
        .catch(() => void refetchDocs());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsLoading, docs?.length, projectId]);

  const { data: pages, isLoading: pagesLoading } = usePages(docId ?? undefined);
  const pageList = useMemo(() => pages ?? [], [pages]);
  const tree = useMemo(() => buildTree(pageList), [pageList]);

  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [shareOpen, setShareOpen] = useState(false);

  if (
    pageList.length > 0 &&
    (!selectedPageId || !pageList.some((p) => p.id === selectedPageId))
  ) {
    setSelectedPageId(pageList[0].id);
  }
  const activePage = pageList.find((p) => p.id === selectedPageId) ?? null;

  // People a PRIVATE page is explicitly shared with — shown as avatars.
  const { data: members } = useProjectMembers(projectId);
  const { data: activeShares } = usePageShares(
    activePage?.is_private ? activePage.id : undefined,
  );
  const sharedUsers = useMemo(() => {
    if (!activePage?.is_private) return [];
    const ids = new Set(activeShares ?? []);
    return (members ?? [])
      .map((m) => m.team_member?.user)
      .filter(
        (u): u is { id: string; name: string; email: string; avatar_url: string | null } =>
          Boolean(u) && ids.has(u!.id),
      );
  }, [members, activeShares, activePage?.is_private]);

  // Every project doc starts with at least one page — auto-create the first one
  // when the doc has none (fresh doc, or an older empty one). Guarded to fire
  // once per mount so deleting the last page doesn't immediately re-add one.
  const firstPageRef = useRef(false);
  useEffect(() => {
    if (docId && !pagesLoading && pageList.length === 0 && !firstPageRef.current) {
      firstPageRef.current = true;
      createPage
        .mutateAsync({ docId, projectId, parentId: null, sortOrder: 0 })
        .then((page) => setSelectedPageId(page.id))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, pagesLoading, pageList.length, projectId]);

  /* ---- editor local state + debounced save (flush via ref) ---- */
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const activePageRef = useRef<string | null>(null);
  const titleRef = useRef("");
  const blocksRef = useRef<Block[]>([]);
  const timerRef = useRef<number | undefined>(undefined);

  // Reads only refs (page id, doc id, title, blocks) + the stable
  // updatePage.mutate — so it stays correct even when captured by the unmount
  // cleanup, with no stale first-render closure over state (the bug that
  // silently dropped the last 700ms of edits on tab-away).
  const flush = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const pid = activePageRef.current;
    const did = docIdRef.current;
    if (!pid || !did) return;
    updatePage.mutate({
      id: pid,
      docId: did,
      title: titleRef.current.trim() || "Untitled",
      content: blocksRef.current,
    });
  };
  const schedule = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flush, 700);
  };

  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (activePage && seededRef.current !== activePage.id) {
      if (activePageRef.current && activePageRef.current !== activePage.id) {
        flush(); // save the page we're leaving
      }
      seededRef.current = activePage.id;
      activePageRef.current = activePage.id;
      setTitle(activePage.title);
      titleRef.current = activePage.title;
      setBlocks(activePage.content);
      blocksRef.current = activePage.content;
    }
    if (!activePage && activePageRef.current) {
      flush(); // deselected (e.g. deleted) — don't lose pending edits
      seededRef.current = null;
      activePageRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.id]);

  // Flush on unmount (leaving the Doc tab unmounts this component). `flush`
  // reads only refs, so the first-render closure is safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), []);

  const onTitle = (t: string) => {
    setTitle(t);
    titleRef.current = t;
    schedule();
  };
  const onBlocks = (b: Block[]) => {
    setBlocks(b);
    blocksRef.current = b;
    schedule();
  };

  /* ---- actions ---- */
  const addPage = async (parentId: string | null) => {
    if (!docId) return;
    try {
      const maxSort = pageList
        .filter((p) => (p.parent_id ?? null) === parentId)
        .reduce((m, p) => Math.max(m, p.sort_order), -1);
      const page = await createPage.mutateAsync({
        docId,
        projectId,
        parentId,
        sortOrder: maxSort + 1,
      });
      if (parentId) {
        // Reveal the parent so the new subpage is visible.
        setCollapsed((c) => {
          const next = new Set(c);
          next.delete(parentId);
          return next;
        });
      }
      setSelectedPageId(page.id);
    } catch {
      message.error("Couldn't add the page.");
    }
  };

  const setPrivacy = (p: Page, isPrivate: boolean) => {
    if (!docId) return;
    updatePage.mutate(
      { id: p.id, docId, is_private: isPrivate },
      {
        onError: () => message.error("Only admins can change others' pages."),
        onSuccess: () =>
          message.success(isPrivate ? "Page is now private." : "Page shared with the project."),
      },
    );
  };

  const removePage = (p: Page) => {
    if (!docId) return;
    modal.confirm({
      title: `Delete "${p.title || "Untitled"}"?`,
      content: "Its subpages are deleted too. This can't be undone.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: () =>
        deletePage
          .mutateAsync({ id: p.id, docId })
          .then(() => {
            if (selectedPageId === p.id) setSelectedPageId(null);
          })
          .catch(() => message.error("Couldn't delete the page.")),
    });
  };

  const pageMenu = (p: Page): MenuProps => ({
    items: [
      { key: "sub", label: "Add subpage", onClick: () => void addPage(p.id) },
      {
        key: "priv",
        label: p.is_private ? "Share with project" : "Make private",
        onClick: () => setPrivacy(p, !p.is_private),
      },
      { type: "divider" },
      { key: "del", label: "Delete page", danger: true, onClick: () => removePage(p) },
    ],
  });

  const toggleCollapse = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderNode = (node: TreeNode): React.ReactNode => {
    const p = node.page;
    const on = p.id === selectedPageId;
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(p.id);
    return (
      <div key={p.id}>
        <div
          className="wl-doc-page-row"
          onClick={() => setSelectedPageId(p.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "5px 8px",
            paddingLeft: 6 + node.depth * 14,
            borderRadius: 8,
            cursor: "pointer",
            position: "relative",
            background: on ? token.controlItemBgActive : "transparent",
            color: on ? token.colorText : token.colorTextSecondary,
          }}
        >
          <button
            type="button"
            aria-label={isCollapsed ? "Expand" : "Collapse"}
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleCollapse(p.id);
            }}
            style={{
              width: 18,
              height: 18,
              border: "none",
              background: "transparent",
              cursor: hasChildren ? "pointer" : "default",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
              color: token.colorTextTertiary,
              visibility: hasChildren ? "visible" : "hidden",
            }}
          >
            <MIcon name={isCollapsed ? "chevron_right" : "expand_more"} size={16} />
          </button>
          <MIcon name="description" size={15} color={on ? token.colorPrimary : token.colorTextTertiary} />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 13.5,
              fontWeight: on ? 600 : 500,
            }}
          >
            {p.title || "Untitled"}
          </span>
          {p.is_private ? (
            <Tooltip title="Private — only you and project admins">
              <span style={{ display: "inline-flex" }}>
                <MIcon name="lock" size={13} color={token.colorTextTertiary} />
              </span>
            </Tooltip>
          ) : null}
          <span
            className="wl-doc-page-actions"
            onClick={(e) => e.stopPropagation()}
            style={{ display: "inline-flex", gap: 0 }}
          >
            <Tooltip title="Add subpage">
              <Button
                type="text"
                size="small"
                aria-label="Add subpage"
                icon={<MIcon name="add" size={15} />}
                onClick={() => void addPage(p.id)}
              />
            </Tooltip>
            <Dropdown menu={pageMenu(p)} trigger={["click"]} placement="bottomRight">
              <Button type="text" size="small" aria-label="Page options" icon={<MIcon name="more_horiz" size={15} />} />
            </Dropdown>
          </span>
        </div>
        {hasChildren && !isCollapsed ? node.children.map((c) => renderNode(c)) : null}
      </div>
    );
  };

  const loadingDoc = docsLoading || (!doc && createDoc.isPending);

  return (
    <div
      className="docs-shell"
      style={{
        display: "flex",
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 14,
        overflow: "hidden",
        background: token.colorBgContainer,
        height: "calc(100vh - 220px)",
        minHeight: 460,
      }}
    >
      {/* Page tree */}
      <aside
        style={{
          width: 268,
          flex: "none",
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: token.colorFillQuaternary,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "14px 12px 10px",
          }}
        >
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: token.colorPrimary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <MIcon name="menu_book" size={16} color="#fff" />
          </span>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: token.colorText }}>
            {doc?.title ?? "Doc"}
          </span>
          <Tooltip title="New page">
            <Button
              type="text"
              size="small"
              aria-label="New page"
              icon={<PlusOutlined />}
              onClick={() => void addPage(null)}
            />
          </Tooltip>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 12px" }}>
          {pagesLoading || loadingDoc ? (
            <div style={{ padding: 16, textAlign: "center" }}>
              <Spin size="small" />
            </div>
          ) : tree.length === 0 ? (
            <div style={{ padding: "8px 4px" }}>
              <Button type="dashed" block size="small" icon={<PlusOutlined />} onClick={() => void addPage(null)}>
                Add a page
              </Button>
            </div>
          ) : (
            tree.map((node) => renderNode(node))
          )}
        </div>
      </aside>

      {/* Editor */}
      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", background: token.colorBgContainer }}>
        {loadingDoc ? (
          <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
            <Spin />
          </div>
        ) : activePage ? (
          <div style={{ maxWidth: 780, margin: "0 auto", padding: "22px 40px 96px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 8,
                marginBottom: 10,
              }}
            >
              {sharedUsers.length > 0 ? (
                <Avatar.Group
                  max={{ count: 5 }}
                  size={24}
                  style={{ cursor: "pointer" }}
                >
                  {sharedUsers.map((u) => (
                    <Tooltip key={u.id} title={u.name}>
                      <Avatar
                        size={24}
                        src={u.avatar_url ?? undefined}
                        onClick={() => setShareOpen(true)}
                        style={{ fontSize: 11 }}
                      >
                        {initials(u.name)}
                      </Avatar>
                    </Tooltip>
                  ))}
                </Avatar.Group>
              ) : null}
              <Button
                size="small"
                icon={<MIcon name={activePage.is_private ? "lock" : "group"} size={15} />}
                onClick={() => setShareOpen(true)}
              >
                {activePage.is_private
                  ? sharedUsers.length > 0
                    ? `Private · ${sharedUsers.length}`
                    : "Private"
                  : "Shared"}
              </Button>
            </div>
            <input
              value={title}
              onChange={(e) => onTitle(e.target.value)}
              placeholder="Untitled"
              style={{
                width: "100%",
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 34,
                fontWeight: 800,
                color: token.colorText,
                marginBottom: 14,
                padding: 0,
              }}
            />
            <BlockEditor value={blocks} onChange={onBlocks} />
          </div>
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Add a page to start writing."
            >
              <Button type="primary" icon={<PlusOutlined />} onClick={() => void addPage(null)}>
                Add a page
              </Button>
            </Empty>
          </div>
        )}
      </main>

      <style>{`
        .wl-doc-page-actions { opacity: 0; transition: opacity .12s ease; }
        .wl-doc-page-row:hover { background: ${token.colorFillTertiary}; }
        .wl-doc-page-row:hover .wl-doc-page-actions { opacity: 1; }
        @media (max-width:640px){
          .docs-shell{ flex-direction:column }
          .docs-shell > aside{ width:100%; flex:none; max-height:220px; border-right:none; border-bottom:1px solid #ececf0 }
        }
      `}</style>

      <PageShareModal
        projectId={projectId}
        page={activePage}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}
