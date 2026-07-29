"use client";

import { useMemo, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  useCreateCrmPerson,
  useCrmPeople,
  useDestroyCrmPerson,
  useSetCrmPersonDeleted,
  useUpdateCrmPerson,
} from "@/features/app-crm/use-crm-people";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import {
  crmPersonName,
  type CrmPersonWithCompany,
  type CrmTargetRef,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";

type PersonFormValues = {
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  job_title?: string;
  city?: string;
  linkedin_url?: string;
  company_id?: string | null;
};

export default function CrmPeoplePage() {
  const { message } = App.useApp();
  const { data: people, isLoading } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const createPerson = useCreateCrmPerson();
  const updatePerson = useUpdateCrmPerson();
  const setDeleted = useSetCrmPersonDeleted();
  const destroyPerson = useDestroyCrmPerson();

  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmPersonWithCompany | null>(null);
  const [viewTarget, setViewTarget] = useState<CrmTargetRef | null>(null);
  const [form] = Form.useForm<PersonFormValues>();

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (people ?? [])
      .filter((p) => (showDeleted ? Boolean(p.deleted_at) : !p.deleted_at))
      .filter((p) => {
        if (!needle) return true;
        return [
          crmPersonName(p),
          p.email ?? "",
          p.job_title ?? "",
          p.city ?? "",
          p.company?.name ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
  }, [people, search, showDeleted]);

  const companyOptions = useMemo(
    () =>
      (companies ?? [])
        .filter((c) => !c.deleted_at)
        .map((c) => ({ value: c.id, label: c.name })),
    [companies],
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setFormOpen(true);
  };

  const openEdit = (person: CrmPersonWithCompany) => {
    setEditing(person);
    form.setFieldsValue({
      first_name: person.first_name,
      last_name: person.last_name || undefined,
      email: person.email ?? undefined,
      phone: person.phone ?? undefined,
      job_title: person.job_title ?? undefined,
      city: person.city ?? undefined,
      linkedin_url: person.linkedin_url ?? undefined,
      company_id: person.company_id,
    });
    setFormOpen(true);
  };

  const handleSubmit = async (values: PersonFormValues) => {
    const patch = {
      first_name: values.first_name.trim(),
      last_name: values.last_name?.trim() ?? "",
      email: values.email?.trim() || null,
      phone: values.phone?.trim() || null,
      job_title: values.job_title?.trim() || null,
      city: values.city?.trim() || null,
      linkedin_url: values.linkedin_url?.trim() || null,
      company_id: values.company_id ?? null,
    };
    try {
      if (editing) {
        await updatePerson.mutateAsync({ id: editing.id, patch });
        message.success("Person updated.");
      } else {
        await createPerson.mutateAsync(patch);
        message.success("Person added.");
      }
      setFormOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Failed to save person."));
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
        <Typography.Title level={3} style={{ margin: 0 }}>
          People
        </Typography.Title>
        <Space wrap>
          <Input
            allowClear
            prefix={<MIcon name="search" size={16} />}
            placeholder="Search people…"
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
          <Button
            type="primary"
            icon={<MIcon name="add" size={16} />}
            onClick={openCreate}
          >
            New person
          </Button>
        </Space>
      </Space>

      <Table
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={rows}
        pagination={{ pageSize: 25, hideOnSinglePage: true }}
        onRow={(p) => ({
          onClick: () => setViewTarget({ type: "person", id: p.id }),
          style: { cursor: "pointer" },
        })}
        columns={[
          {
            title: "Name",
            key: "name",
            render: (_, p) => (
              <Space>
                <Avatar size={26} src={p.avatar_url ?? undefined}>
                  {(crmPersonName(p) || "?").charAt(0).toUpperCase()}
                </Avatar>
                <span style={{ fontWeight: 500 }}>
                  {crmPersonName(p) || "Unnamed"}
                </span>
              </Space>
            ),
            sorter: (a, b) => crmPersonName(a).localeCompare(crmPersonName(b)),
          },
          {
            title: "Email",
            dataIndex: "email",
            render: (v: string | null) => v || "—",
          },
          {
            title: "Phone",
            dataIndex: "phone",
            render: (v: string | null) => v || "—",
          },
          {
            title: "Company",
            key: "company",
            render: (_, p) => p.company?.name ?? "—",
            sorter: (a, b) =>
              (a.company?.name ?? "").localeCompare(b.company?.name ?? ""),
          },
          {
            title: "Job title",
            dataIndex: "job_title",
            render: (v: string | null) => v || "—",
          },
          {
            title: "City",
            dataIndex: "city",
            render: (v: string | null) => v || "—",
          },
          {
            title: "Created",
            dataIndex: "created_at",
            render: (v: string) => dayjs(v).format("DD MMM YYYY"),
            sorter: (a, b) => a.created_at.localeCompare(b.created_at),
          },
          {
            title: "",
            key: "actions",
            width: 120,
            render: (_, p) => (
              <Space onClick={(e) => e.stopPropagation()}>
                {p.deleted_at ? (
                  <>
                    <Button
                      size="small"
                      onClick={async () => {
                        try {
                          await setDeleted.mutateAsync({
                            id: p.id,
                            deleted: false,
                          });
                          message.success("Person restored.");
                        } catch (err) {
                          message.error(errMsg(err, "Failed to restore."));
                        }
                      }}
                    >
                      Restore
                    </Button>
                    <Popconfirm
                      title="Permanently delete this person?"
                      description="This cannot be undone."
                      onConfirm={async () => {
                        try {
                          await destroyPerson.mutateAsync(p.id);
                          message.success("Person permanently deleted.");
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
                      onClick={() => openEdit(p)}
                    />
                    <Popconfirm
                      title="Delete this person?"
                      description="They move to Deleted and can be restored."
                      onConfirm={async () => {
                        try {
                          await setDeleted.mutateAsync({
                            id: p.id,
                            deleted: true,
                          });
                          message.success("Person deleted.");
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

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit person" : "New person"}
        width={420}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item
              name="first_name"
              label="First name"
              rules={[{ required: true, message: "First name is required" }]}
              style={{ flex: 1, marginRight: 8 }}
            >
              <Input placeholder="First name" />
            </Form.Item>
            <Form.Item name="last_name" label="Last name" style={{ flex: 1 }}>
              <Input placeholder="Last name" />
            </Form.Item>
          </Space.Compact>
          <Form.Item
            name="email"
            label="Email"
            rules={[{ type: "email", message: "Enter a valid email" }]}
          >
            <Input placeholder="name@company.com" />
          </Form.Item>
          <Form.Item name="phone" label="Phone">
            <Input placeholder="+1 555 000 0000" />
          </Form.Item>
          <Form.Item name="company_id" label="Company">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={companyOptions}
              placeholder="Select a company"
            />
          </Form.Item>
          <Form.Item name="job_title" label="Job title">
            <Input placeholder="e.g. Head of Design" />
          </Form.Item>
          <Form.Item name="city" label="City">
            <Input placeholder="City" />
          </Form.Item>
          <Form.Item name="linkedin_url" label="LinkedIn URL">
            <Input placeholder="https://linkedin.com/in/…" />
          </Form.Item>
          <Space style={{ justifyContent: "flex-end", width: "100%" }}>
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={createPerson.isPending || updatePerson.isPending}
            >
              {editing ? "Save changes" : "Add person"}
            </Button>
          </Space>
        </Form>
      </Drawer>

      <RecordDrawer target={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
