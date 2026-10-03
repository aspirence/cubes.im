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
import { LoadingOutlined, PlusOutlined } from "@ant-design/icons";
import {
  useDocs,
  usePages,
  usePageShares,
  useCreateDoc,
  useCreatePage,
  useUpdatePage,
  useDeletePage,
  type Page,
  type UpdatePageInput,
} from "@/features/app-docs/use-docs";
import { useProjectMembers } from "@/features/projects/use-project-members";
import { NotionEditor } from "@/features/editor/notion-editor";
import {
  htmlToPageContent,
  pageContentToHtml,
} from "@/features/app-docs/page-content";
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
  const [html, setHtml] = useState("");
  const activePageRef = useRef<string | null>(null);
  const titleRef = useRef("");
  const htmlRef = useRef("");
  const timerRef = useRef<number | undefined>(undefined);

  /**
   * What the header tells the writer about their words. Until this existed a
   * save could fail — no network, a private page of someone else's (RLS says
   * "forbidden") — and the page looked exactly as if it had saved.
   *
   *   saving  edits are waiting for the debounce, or a save is in flight
   *   saved   every page's last save landed and nothing has changed since
   *   error   a save failed and its words are still only here; Retry (or the
   *           next keystroke on that page) sends them again
   */
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error">("saved");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // The bookkeeping, keyed by page: edits since the last flush of the page
  // being shown; the saves waiting their turn (newest wins per page); the
  // save on the wire; the saves that failed and are kept until they land.
  // Refs, because flush() and the unmount cleanup read them outside render.
  const dirtyRef = useRef(false);
  const pendingRef = useRef(new Map<string, UpdatePageInput>());
  const inFlightRef = useRef<UpdatePageInput | null>(null);
  const failedRef = useRef(new Map<string, UpdatePageInput>());
  // Pages deleted (or gone from the list) while something of theirs was still
  // unsaved: a late answer for them is noise, never a failure to report.
  const goneRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const errorToastAtRef = useRef(0);

  const settleState = () => {
    if (dirtyRef.current || inFlightRef.current || pendingRef.current.size > 0) setSaveState("saving");
    else setSaveState(failedRef.current.size > 0 ? "error" : "saved");
  };

  // One save on the wire at a time: two PATCHes racing can land out of order
  // and leave the older text in the database. Promises rather than mutate
  // callbacks: react-query drops per-call callbacks once the component is
  // gone, and the tab-away flush must still run and still be able to say it
  // failed. A failure keeps its payload (failedRef) and stops the pump —
  // offline, a loop of retries would only burn the network; Retry and the
  // next keystroke on that page send it again.
  const pump = () => {
    if (inFlightRef.current) return;
    const next = pendingRef.current.values().next().value as UpdatePageInput | undefined;
    if (!next) return;
    pendingRef.current.delete(next.id);
    if (goneRef.current.has(next.id)) {
      pump();
      return;
    }
    inFlightRef.current = next;
    setSaveState("saving");
    updatePage
      .mutateAsync(next)
      .then(() => {
        inFlightRef.current = null;
        if (!goneRef.current.has(next.id)) {
          failedRef.current.delete(next.id);
          setSavedAt(Date.now());
        }
        pump();
      })
      .catch((err: unknown) => {
        inFlightRef.current = null;
        // The row was deleted while this was on the wire: nothing to report.
        if (goneRef.current.has(next.id)) {
          pump();
          return;
        }
        const now = Date.now();
        if (!mountedRef.current) {
          // The chip is gone (tab left): every page still queued gets its one
          // attempt and its own honest toast — nothing can be retried here.
          errorToastAtRef.current = now;
          message.error(`Couldn't save "${next.title ?? "Untitled"}" — the last edits there were not saved.`);
          pump();
          return;
        }
        // On screen: the pump stops (offline, a loop of retries would only
        // burn the network), so everything still queued is unsaved too and
        // moves to the failed set, newest words per page kept. Retry, or the
        // next keystroke on a page, sends it again.
        if (!pendingRef.current.has(next.id)) failedRef.current.set(next.id, next);
        for (const [id, payload] of pendingRef.current) failedRef.current.set(id, payload);
        pendingRef.current.clear();
        // The chip says it while the page is on screen; a failure on another
        // page has no chip, so its toast must not be throttled away.
        const elsewhere = next.id !== activePageRef.current;
        if (elsewhere || now - errorToastAtRef.current > 60_000) {
          errorToastAtRef.current = now;
          const forbidden = err instanceof Error && err.message === "forbidden";
          message.error(
            elsewhere
              ? `Couldn't save "${next.title ?? "Untitled"}" — its edits are kept here; press Retry.`
              : forbidden
                ? "This page couldn't be saved — you can't edit it."
                : "Couldn't save the page. Your edits are still here — Retry, or keep typing.",
          );
        }
      })
      .finally(() => {
        settleState();
      });
  };

  // Reads only refs (page id, doc id, title, html) — so it stays correct even
  // when captured by the unmount cleanup, with no stale first-render closure
  // over state (the bug that silently dropped the last 700ms of edits on
  // tab-away). A no-op when nothing changed: a blur or a page switch must not
  // write the seeded copy back (it would bump updated_at, flash "Saving…",
  // and on a shared page overwrite a teammate's newer words).
  const flush = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    if (!dirtyRef.current) return;
    const pid = activePageRef.current;
    const did = docIdRef.current;
    if (!pid || !did) return;
    dirtyRef.current = false;
    failedRef.current.delete(pid); // newer words supersede the failed ones
    pendingRef.current.set(pid, {
      id: pid,
      docId: did,
      title: titleRef.current.trim() || "Untitled",
      content: htmlToPageContent(htmlRef.current),
    });
    pump();
  };
  /** Sends every failed page again, then whatever is unsaved on the page shown. */
  const retry = () => {
    for (const payload of failedRef.current.values()) {
      if (goneRef.current.has(payload.id)) continue;
      if (!pendingRef.current.has(payload.id)) pendingRef.current.set(payload.id, payload);
    }
    failedRef.current.clear();
    if (dirtyRef.current) flush();
    else pump();
  };
  const schedule = () => {
    dirtyRef.current = true;
    setSaveState("saving");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flush, 700);
  };
  /** Forgets everything unsaved about a page that no longer exists. */
  const forget = (pageId: string) => {
    goneRef.current.add(pageId);
    pendingRef.current.delete(pageId);
    failedRef.current.delete(pageId);
    if (activePageRef.current === pageId) {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
      dirtyRef.current = false;
    }
    settleState();
  };

  // Closing the tab with edits still waiting or failing would lose them; the
  // browser's own "leave site?" prompt is the only thing that can stop that.
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || inFlightRef.current || pendingRef.current.size > 0 || failedRef.current.size > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    // Pages that left the list (a subpage cascade-deleted with its parent, a
    // teammate's delete) take their unsaved words with them; only once the
    // list has really answered, so a cold start cannot wipe the queue.
    if (pages !== undefined && !pagesLoading) {
      for (const id of [...pendingRef.current.keys(), ...failedRef.current.keys()]) {
        if (!pageList.some((x) => x.id === id)) forget(id);
      }
    }
    if (activePage && seededRef.current !== activePage.id) {
      if (activePageRef.current && activePageRef.current !== activePage.id) {
        // Save the page we're leaving — unless it was just deleted, in which
        // case there is no row to save into.
        if (pageList.some((x) => x.id === activePageRef.current)) flush();
        else forget(activePageRef.current);
      }
      seededRef.current = activePage.id;
      activePageRef.current = activePage.id;
      // The freshest words for this page: what is still waiting to be saved
      // (queued, on the wire, or failed) beats the cache, which only knows
      // about saves that landed.
      const local =
        pendingRef.current.get(activePage.id) ??
        failedRef.current.get(activePage.id) ??
        (inFlightRef.current?.id === activePage.id ? inFlightRef.current : undefined);
      const seededTitle = local?.title ?? activePage.title;
      setTitle(seededTitle);
      titleRef.current = seededTitle;
      const seeded = pageContentToHtml(local?.content !== undefined ? local.content : activePage.content);
      setHtml(seeded);
      htmlRef.current = seeded;
      dirtyRef.current = false;
      settleState();
    }
    if (!activePage && activePageRef.current) {
      // Deselected (deleted, or the list emptied) — save if the row is still
      // there, forget it if not.
      if (pageList.some((x) => x.id === activePageRef.current)) flush();
      else forget(activePageRef.current);
      seededRef.current = null;
      activePageRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.id, pageList]);

  // Flush on unmount (leaving the Doc tab unmounts this component). `flush`
  // reads only refs, so the first-render closure is safe; mountedRef tells a
  // failing save that the chip is gone and a toast is all it can do.
  useEffect(() => {
    // StrictMode runs this cleanup once on mount and mounts again; the flag
    // must come back with it.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // One last attempt for every page — failed ones included — each with
      // its own honest toast if it fails; nothing can be retried after this.
      retry();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTitle = (t: string) => {
    setTitle(t);
    titleRef.current = t;
    schedule();
  };
  const onHtml = (next: string) => {
    setHtml(next);
    htmlRef.current = next;
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
            // Nothing unsaved may chase a row that is gone (it would come
            // back as "forbidden" and look like a save failure).
            forget(p.id);
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
        borderRadius: 12,
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
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <SaveStatus state={saveState} savedAt={savedAt} onRetry={retry} />
              <span style={{ flex: 1 }} />
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
            <NotionEditor
              key={activePage.id}
              value={html}
              onChange={onHtml}
              // The tab already debounces every change to the same save; a
              // separate commit on blur would just fire a second write.
              onCommit={flush}
              variant="page"
              placeholder="Start writing, or press / for blocks…"
              linkPreviews={false}
            />
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
          .docs-shell > aside{ width:100%; flex:none; max-height:220px; border-right:none; border-bottom:1px solid ${token.colorBorderSecondary} }
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


/**
 * The save indicator in the page header. Quiet when all is well, loud when it
 * is not: "Saving…" while edits wait or travel, "Saved" (hover for the time)
 * when they landed, and a red "Couldn't save · Retry" that stays until a save
 * succeeds — because a page that silently didn't save is the worst outcome
 * an editor can have.
 */
function SaveStatus({
  state,
  savedAt,
  onRetry,
}: {
  state: "saving" | "saved" | "error";
  savedAt: number | null;
  onRetry: () => void;
}) {
  const { token } = theme.useToken();
  const color = state === "error" ? token.colorError : token.colorTextTertiary;
  const when = savedAt ? new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  // One live region that stays mounted whatever the state, so assistive
  // tech hears the text change instead of a new element appearing; only the
  // outcomes are announced, not the transient "Saving…".
  return (
    <span
      role="status"
      aria-live={state === "saving" ? "off" : "polite"}
      aria-atomic="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12.5,
        lineHeight: 1,
        whiteSpace: "nowrap",
        color,
      }}
    >
      {state === "error" ? (
        <>
          <MIcon name="cloud_off" size={15} color={color} />
          Couldn&apos;t save
          <Button type="link" size="small" style={{ padding: 0, height: "auto", fontSize: 12.5 }} onClick={onRetry}>
            Retry
          </Button>
        </>
      ) : state === "saving" ? (
        <>
          <LoadingOutlined spin style={{ fontSize: 13 }} />
          Saving…
        </>
      ) : (
        <Tooltip title={when ? `Saved at ${when}` : "Nothing to save yet"}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <MIcon name="cloud_done" size={15} color={color} />
            Saved
          </span>
        </Tooltip>
      )}
    </span>
  );
}
