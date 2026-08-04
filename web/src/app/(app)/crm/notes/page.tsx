"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Spin,
  Tooltip,
  theme,
} from "antd";
import { useAuth } from "@/features/auth/use-auth";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import {
  useCreateCrmNote,
  useCrmNotes,
  useDeleteCrmNote,
  useUpdateCrmNote,
} from "@/features/app-crm/use-crm-notes";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import {
  crmPersonName,
  type CrmNoteWithTargets,
  type CrmTargetRef,
  type CrmTargetType,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { NotionEditor } from "@/features/editor/notion-editor";
import { richTextToPlain } from "@/features/editor/rich-text";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";
import {
  TargetPicker,
  decodeTarget,
  encodeTarget,
} from "../_components/target-picker";
import { ENTITY_META, entityMeta } from "../_components/entity-meta";
import { FormSection } from "../_components/form-section";
import {
  CRM_DRAWER_BODY_STYLE,
  CRM_DRAWER_FORM_STYLE,
  CRM_DRAWER_WIDTH,
  CrmDrawerFields,
  CrmDrawerFooter,
} from "../_components/drawer-footer";
import {
  CRM_HOVER_ROW_CLASS,
  CrmPageHeader,
  CrmSearch,
  CrmToolbar,
  EmptyState,
  ErrorState,
  EntityAvatar,
  Panel,
  RowActions,
  SoftChip,
  crmDateTime,
  crmFromNow,
  crmPageStyle,
  useCrmStyles,
} from "../_lib/ui";

type NoteFormValues = {
  title: string;
  body?: string;
  targets?: string[];
};

/** Toolbar filter: every note, or only those linked to one kind of record. */
type LinkFilter = "all" | CrmTargetType;

const LINK_FILTERS: CrmTargetType[] = ["person", "company", "deal"];

/**
 * The note body inside an AntD Form.Item.
 *
 * Form.Item clones its child with `value`/`onChange`, which is exactly the
 * editor's contract — but `value` arrives undefined before the form is seeded,
 * and NotionEditor wants a string.
 */
function NoteBodyField({
  value,
  onChange,
}: {
  value?: string;
  onChange?: (next: string) => void;
}) {
  return (
    <NotionEditor
      value={value ?? ""}
      onChange={(next) => onChange?.(next)}
      // The form's own Save is the commit; blur must not fire a write.
      onCommit={() => {}}
      placeholder="Call recap, meeting summary, research…"
      minRows={4}
      maxRows={12}
      linkPreviews={false}
    />
  );
}

export default function CrmNotesPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  useCrmStyles();
  const {
    data: notes,
    isLoading,
    isError,
    error,
    refetch,
  } = useCrmNotes();
  const { data: people } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const { data: deals } = useCrmDeals();
  const { user } = useAuth();
  const { data: members } = useTeamMembers();
  const createNote = useCreateCrmNote();
  const updateNote = useUpdateCrmNote();
  const deleteNote = useDeleteCrmNote();

  const [search, setSearch] = useState("");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "updated">(
    "newest",
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmNoteWithTargets | null>(null);
  const [viewTarget, setViewTarget] = useState<CrmTargetRef | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Quick edit happens on the card itself — the Drawer stays for the full form.
  const [inlineId, setInlineId] = useState<string | null>(null);
  const [inlineTitle, setInlineTitle] = useState("");
  const [inlineBody, setInlineBody] = useState("");
  const [form] = Form.useForm<NoteFormValues>();

  const recordName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people ?? [])
      map.set(`person:${p.id}`, crmPersonName(p) || "Unnamed person");
    for (const c of companies ?? []) map.set(`company:${c.id}`, c.name);
    for (const d of deals ?? []) map.set(`deal:${d.id}`, d.name);
    return (type: string, id: string) => map.get(`${type}:${id}`) ?? null;
  }, [people, companies, deals]);

  const author = useMemo(() => {
    const map = new Map<string, { name: string; avatar: string | null }>();
    for (const m of members ?? [])
      if (m.user)
        map.set(m.user.id, { name: m.user.name, avatar: m.user.avatar_url });
    return (id: string | null) => {
      const found = id ? map.get(id) : undefined;
      return found ?? { name: "Someone", avatar: null };
    };
  }, [members]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = (notes ?? []).filter((n) => {
      if (
        linkFilter !== "all" &&
        !n.targets.some((t) => t.target_type === linkFilter)
      ) {
        return false;
      }
      if (authorFilter !== "all" && n.created_by !== authorFilter) return false;
      if (!needle) return true;
      // "Everything we wrote about Acme" is the question a note archive is
      // actually asked, so the records a note is filed against are part of
      // its searchable text — not just its own words.
      const linked = n.targets
        .map((t) => recordName(t.target_type, t.target_id) ?? "")
        .join(" ");
      // Bodies are rich text now; searching the raw HTML would make "p" and
      // "li" match every note in the workspace.
      return [n.title, richTextToPlain(n.body), linked, author(n.created_by).name]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    const sorted = [...filtered];
    if (sortBy === "oldest") {
      sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    } else if (sortBy === "updated") {
      sorted.sort((a, b) =>
        (b.updated_at ?? b.created_at).localeCompare(
          a.updated_at ?? a.created_at,
        ),
      );
    } else {
      sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return sorted;
  }, [notes, search, linkFilter, authorFilter, sortBy, recordName, author]);

  const clearFilters = () => {
    setSearch("");
    setLinkFilter("all");
    setAuthorFilter("all");
  };

  const openCreate = () => {
    setInlineId(null);
    setEditing(null);
    form.resetFields();
    setFormOpen(true);
  };

  const openEdit = (note: CrmNoteWithTargets) => {
    setInlineId(null);
    setEditing(note);
    form.setFieldsValue({
      title: note.title,
      body: note.body ?? undefined,
      targets: note.targets.map((t) =>
        encodeTarget({
          type: t.target_type as CrmTargetRef["type"],
          id: t.target_id,
        }),
      ),
    });
    setFormOpen(true);
  };

  const handleSubmit = async (values: NoteFormValues) => {
    try {
      if (editing) {
        await updateNote.mutateAsync({
          id: editing.id,
          patch: {
            title: values.title.trim(),
            body: values.body?.trim() || null,
          },
        });
        message.success("Note updated.");
      } else {
        await createNote.mutateAsync({
          title: values.title.trim(),
          body: values.body?.trim() || null,
          targets: (values.targets ?? []).map(decodeTarget),
        });
        message.success("Note added.");
      }
      setFormOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Failed to save note."));
    }
  };

  /** Turn one card into its own little editor — title and body, nothing else. */
  const startInline = (note: CrmNoteWithTargets) => {
    setFormOpen(false);
    setInlineId(note.id);
    setInlineTitle(note.title);
    setInlineBody(note.body ?? "");
  };

  const saveInline = async (note: CrmNoteWithTargets) => {
    const title = inlineTitle.trim();
    if (!title) {
      message.error("Note title is required.");
      return;
    }
    try {
      await updateNote.mutateAsync({
        id: note.id,
        patch: { title, body: inlineBody.trim() || null },
      });
      setInlineId(null);
      message.success("Note updated.");
    } catch (err) {
      message.error(errMsg(err, "Failed to save note."));
    }
  };

  const newNoteButton = (
    <Button
      type="primary"
      icon={<MIcon name="add" size={16} />}
      onClick={openCreate}
    >
      New note
    </Button>
  );

  const renderTargets = (note: CrmNoteWithTargets) => {
    const chips = note.targets
      .map((x) => {
        const name = recordName(x.target_type, x.target_id);
        if (!name) return null;
        const meta = entityMeta(x.target_type);
        const open = () =>
          setViewTarget({
            type: x.target_type as CrmTargetRef["type"],
            id: x.target_id,
          });
        return (
          <span
            key={x.id}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                open();
              }
            }}
            style={{ cursor: "pointer", display: "inline-flex", maxWidth: 220 }}
          >
            <SoftChip tone="custom" color={meta.color} icon={meta.icon}>
              {name}
            </SoftChip>
          </span>
        );
      })
      .filter(Boolean);
    if (chips.length === 0) return null;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{chips}</div>
    );
  };

  const body = (() => {
    if (isLoading) {
      return (
        <Panel padding={0}>
          <div style={{ display: "grid", placeItems: "center", padding: 64 }}>
            <Spin size="large" />
          </div>
        </Panel>
      );
    }

    if (isError) {
      return (
        <Panel padding={0}>
          <ErrorState
            title="Couldn't load notes"
            error={error}
            onRetry={() => void refetch()}
          />
        </Panel>
      );
    }

    if ((notes ?? []).length === 0) {
      return (
        <Panel padding={0}>
          <EmptyState
            icon="sticky_note_2"
            accent={token.colorPrimary}
            title="No notes yet"
            description="Capture the first call summary, meeting recap or piece of research — link it to a person, company or deal and it shows up on that record too."
            action={newNoteButton}
          />
        </Panel>
      );
    }

    if (rows.length === 0) {
      const needle = search.trim();
      const linked =
        linkFilter === "all" ? null : ENTITY_META[linkFilter].plural.toLowerCase();
      const authorLabel =
        authorFilter === "all"
          ? null
          : authorFilter === user?.id
            ? "you"
            : author(authorFilter).name;
      return (
        <Panel padding={0}>
          <EmptyState
            icon="search_off"
            title={
              needle ? "No notes match your search" : "No notes match this filter"
            }
            description={(() => {
              const total = (notes ?? []).length;
              if (needle) {
                return `Nothing${linked ? ` filed against ${linked}` : ""} here mentions “${needle}”. Try a different word, or clear the filters to see all ${total} notes.`;
              }
              // Either filter can be the one holding the list empty, so the
              // sentence has to name whichever is actually on.
              const parts = [
                linked ? `linked to ${linked}` : null,
                authorFilter === "all" ? null : `written by ${authorLabel}`,
              ].filter(Boolean);
              return `No notes ${parts.join(" and ")}. Clear the filters to see all ${total} notes.`;
            })()}
            action={<Button onClick={clearFilters}>Clear filters</Button>}
          />
        </Panel>
      );
    }

    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          alignItems: "start",
          gap: 12,
        }}
      >
        {rows.map((n) => {
          const who = author(n.created_by);
          const chips = renderTargets(n);
          const inline = inlineId === n.id;
          return (
            <Panel key={n.id} hover={!inline} padding={16}>
              <div
                className={CRM_HOVER_ROW_CLASS}
                onClick={inline ? undefined : () => openEdit(n)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  cursor: inline ? "default" : "pointer",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    minHeight: 24,
                  }}
                >
                  {inline ? (
                    <Input
                      autoFocus
                      value={inlineTitle}
                      onChange={(e) => setInlineTitle(e.target.value)}
                      onPressEnter={() => saveInline(n)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setInlineId(null);
                      }}
                      placeholder="Note title"
                      style={{ flex: 1, minWidth: 0, fontWeight: 600 }}
                    />
                  ) : (
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 14,
                        fontWeight: 600,
                        lineHeight: 1.4,
                        letterSpacing: "-0.1px",
                        color: token.colorText,
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: 2,
                        overflow: "hidden",
                      }}
                    >
                      {n.title || "Untitled note"}
                    </div>
                  )}
                  <RowActions
                    open={confirmId === n.id}
                    style={{
                      marginTop: -2,
                      display: inline ? "none" : undefined,
                    }}
                  >
                    <Tooltip title="Quick edit">
                      <Button
                        type="text"
                        size="small"
                        aria-label="Edit this note in place"
                        icon={<MIcon name="edit" size={16} />}
                        onClick={() => startInline(n)}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="Delete this note?"
                      description="This cannot be undone — notes have no Deleted bin."
                      okText="Delete"
                      okButtonProps={{ danger: true }}
                      onOpenChange={(open) =>
                        setConfirmId((current) =>
                          open ? n.id : current === n.id ? null : current,
                        )
                      }
                      onConfirm={async () => {
                        try {
                          await deleteNote.mutateAsync(n.id);
                          message.success("Note deleted.");
                        } catch (err) {
                          message.error(errMsg(err, "Failed to delete note."));
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
                  </RowActions>
                </div>

                {inline ? (
                  <div onKeyDown={(e) => { if (e.key === "Escape") setInlineId(null); }}>
                    <NotionEditor
                      value={inlineBody}
                      onChange={setInlineBody}
                      // Saving is the row's own Save button; the editor has no
                      // business committing on every blur here.
                      onCommit={() => {}}
                      placeholder="Call recap, meeting summary, research…"
                      minRows={3}
                      maxRows={12}
                      linkPreviews={false}
                    />
                  </div>
                ) : n.body ? (
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.55,
                      color: token.colorTextSecondary,
                      whiteSpace: "pre-wrap",
                      display: "-webkit-box",
                      WebkitBoxOrient: "vertical",
                      WebkitLineClamp: 4,
                      overflow: "hidden",
                      wordBreak: "break-word",
                    }}
                  >
                    {richTextToPlain(n.body)}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: 12.5,
                      color: token.colorTextQuaternary,
                      fontStyle: "italic",
                    }}
                  >
                    No details
                  </div>
                )}

                {chips}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: "auto",
                    paddingTop: 10,
                    borderTop: `1px solid ${token.colorSplit}`,
                    minWidth: 0,
                  }}
                >
                  <EntityAvatar
                    name={who.name}
                    kind="person"
                    src={who.avatar}
                    size={22}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      color: token.colorTextSecondary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {who.name}
                  </span>
                  {inline ? (
                    <div
                      style={{
                        marginLeft: "auto",
                        display: "flex",
                        gap: 8,
                        flex: "none",
                      }}
                    >
                      <Button size="small" onClick={() => setInlineId(null)}>
                        Cancel
                      </Button>
                      <Button
                        type="primary"
                        size="small"
                        loading={updateNote.isPending}
                        onClick={() => saveInline(n)}
                      >
                        Save
                      </Button>
                    </div>
                  ) : (
                    <Tooltip title={crmDateTime(n.created_at)}>
                      <span
                        style={{
                          fontSize: 12,
                          color: token.colorTextTertiary,
                          marginLeft: "auto",
                          flex: "none",
                        }}
                      >
                        {crmFromNow(n.created_at)}
                      </span>
                    </Tooltip>
                  )}
                </div>
              </div>
            </Panel>
          );
        })}
      </div>
    );
  })();

  return (
    <div style={crmPageStyle()}>
      <CrmPageHeader
        title="Notes"
        subtitle="Call recaps, meeting summaries and research, filed against the records they belong to."
        count={isLoading || isError ? null : rows.length}
      />

      <CrmToolbar>
        <CrmSearch
          value={search}
          onChange={setSearch}
          placeholder="Search notes and what they're on…"
          width={260}
        />
        {/* Filed against what — the second question after "what does it say". */}
        <Segmented
          value={linkFilter}
          onChange={(v) => setLinkFilter(v as LinkFilter)}
          options={[
            { value: "all", label: "All" },
            ...LINK_FILTERS.map((t) => ({
              value: t,
              label: ENTITY_META[t].plural,
            })),
          ]}
        />
        <Select
          value={authorFilter}
          onChange={setAuthorFilter}
          style={{ minWidth: 150 }}
          options={[
            { value: "all", label: "Anyone" },
            ...(members ?? [])
              .filter((m) => m.active && m.user)
              .map((m) => ({
                value: m.user!.id,
                label: m.user!.id === user?.id ? "Me" : m.user!.name,
              })),
          ]}
        />
        <Select
          value={sortBy}
          onChange={setSortBy}
          style={{ minWidth: 160 }}
          options={[
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
            { value: "updated", label: "Recently edited" },
          ]}
        />
        <div style={{ marginLeft: "auto" }}>{newNoteButton}</div>
      </CrmToolbar>

      {body}

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit note" : "New note"}
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
            <FormSection label="Note" first>
              <Form.Item
                name="title"
                label="Title"
                rules={[{ required: true, message: "Note title is required" }]}
              >
                <Input placeholder="e.g. Discovery call recap" />
              </Form.Item>
              <Form.Item name="body" label="Note">
                <NoteBodyField />
              </Form.Item>
            </FormSection>

            {!editing && (
              <FormSection label="Relations">
                <Form.Item name="targets" label="Linked records">
                  <TargetPicker />
                </Form.Item>
              </FormSection>
            )}
          </CrmDrawerFields>

          <CrmDrawerFooter>
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={createNote.isPending || updateNote.isPending}
            >
              {editing ? "Save changes" : "Add note"}
            </Button>
          </CrmDrawerFooter>
        </Form>
      </Drawer>

      <RecordDrawer target={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
