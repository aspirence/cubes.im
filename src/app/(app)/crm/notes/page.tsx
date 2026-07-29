"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Spin,
  Tooltip,
  theme,
} from "antd";
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
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";
import {
  TargetPicker,
  decodeTarget,
  encodeTarget,
} from "../_components/target-picker";
import { entityMeta } from "../_components/entity-meta";
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

export default function CrmNotesPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  useCrmStyles();
  const { data: notes, isLoading } = useCrmNotes();
  const { data: people } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const { data: deals } = useCrmDeals();
  const { data: members } = useTeamMembers();
  const createNote = useCreateCrmNote();
  const updateNote = useUpdateCrmNote();
  const deleteNote = useDeleteCrmNote();

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmNoteWithTargets | null>(null);
  const [viewTarget, setViewTarget] = useState<CrmTargetRef | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
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
    return (notes ?? []).filter((n) => {
      if (!needle) return true;
      return [n.title, n.body ?? ""].join(" ").toLowerCase().includes(needle);
    });
  }, [notes, search]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setFormOpen(true);
  };

  const openEdit = (note: CrmNoteWithTargets) => {
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
      return (
        <Panel padding={0}>
          <EmptyState
            icon="search_off"
            title="No notes match your search"
            description={`Nothing here mentions “${search.trim()}”. Try a different word, or clear the search to see all ${(notes ?? []).length} notes.`}
            action={<Button onClick={() => setSearch("")}>Clear search</Button>}
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
          return (
            <Panel key={n.id} hover padding={16}>
              <div
                className={CRM_HOVER_ROW_CLASS}
                onClick={() => openEdit(n)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  cursor: "pointer",
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
                  <RowActions
                    open={confirmId === n.id}
                    style={{ marginTop: -2 }}
                  >
                    <Tooltip title="Edit">
                      <Button
                        type="text"
                        size="small"
                        icon={<MIcon name="edit" size={16} />}
                        onClick={() => openEdit(n)}
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

                {n.body ? (
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
                    {n.body}
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
        count={isLoading ? null : rows.length}
      />

      <CrmToolbar>
        <CrmSearch
          value={search}
          onChange={setSearch}
          placeholder="Search notes…"
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
                <Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} />
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
