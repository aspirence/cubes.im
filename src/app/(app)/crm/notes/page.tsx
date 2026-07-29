"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
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

dayjs.extend(relativeTime);

type NoteFormValues = {
  title: string;
  body?: string;
  targets?: string[];
};

export default function CrmNotesPage() {
  const { message } = App.useApp();
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
  const [form] = Form.useForm<NoteFormValues>();

  const recordName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people ?? [])
      map.set(`person:${p.id}`, crmPersonName(p) || "Unnamed person");
    for (const c of companies ?? []) map.set(`company:${c.id}`, c.name);
    for (const d of deals ?? []) map.set(`deal:${d.id}`, d.name);
    return (type: string, id: string) => map.get(`${type}:${id}`) ?? null;
  }, [people, companies, deals]);

  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) if (m.user) map.set(m.user.id, m.user.name);
    return (id: string | null) => (id && map.get(id)) || "Someone";
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

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <Space
        style={{
          width: "100%",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <Typography.Title level={3} style={{ margin: 0 }}>
          Notes
        </Typography.Title>
        <Space wrap>
          <Input
            allowClear
            prefix={<MIcon name="search" size={16} />}
            placeholder="Search notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220 }}
          />
          <Button
            type="primary"
            icon={<MIcon name="add" size={16} />}
            onClick={openCreate}
          >
            New note
          </Button>
        </Space>
      </Space>

      {isLoading ? null : rows.length === 0 ? (
        <Empty description="No notes yet. Capture the first call summary, meeting recap, or research." />
      ) : (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {rows.map((n) => (
            <Card
              key={n.id}
              size="small"
              title={n.title || "Untitled note"}
              extra={
                <Space>
                  <Button
                    type="text"
                    size="small"
                    icon={<MIcon name="edit" size={16} />}
                    onClick={() => openEdit(n)}
                  />
                  <Popconfirm
                    title="Delete this note?"
                    onConfirm={async () => {
                      try {
                        await deleteNote.mutateAsync(n.id);
                        message.success("Note deleted.");
                      } catch (err) {
                        message.error(errMsg(err, "Failed to delete note."));
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
                </Space>
              }
            >
              {n.body ? (
                <Typography.Paragraph
                  style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}
                >
                  {n.body}
                </Typography.Paragraph>
              ) : null}
              <Space size={4} wrap>
                {n.targets.map((x) => {
                  const name = recordName(x.target_type, x.target_id);
                  if (!name) return null;
                  return (
                    <Tag
                      key={x.id}
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        setViewTarget({
                          type: x.target_type as CrmTargetRef["type"],
                          id: x.target_id,
                        })
                      }
                    >
                      {name}
                    </Tag>
                  );
                })}
              </Space>
              <div style={{ marginTop: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {memberName(n.created_by)} · {dayjs(n.created_at).fromNow()}
                </Typography.Text>
              </div>
            </Card>
          ))}
        </Space>
      )}

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit note" : "New note"}
        width={420}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
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
          {!editing && (
            <Form.Item name="targets" label="Linked records">
              <TargetPicker />
            </Form.Item>
          )}
          <Space style={{ justifyContent: "flex-end", width: "100%" }}>
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={createNote.isPending || updateNote.isPending}
            >
              {editing ? "Save changes" : "Add note"}
            </Button>
          </Space>
        </Form>
      </Drawer>

      <RecordDrawer target={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
