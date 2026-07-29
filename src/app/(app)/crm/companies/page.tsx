"use client";

import { useMemo, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  useCreateCrmCompany,
  useCrmCompanies,
  useDestroyCrmCompany,
  useSetCrmCompanyDeleted,
  useUpdateCrmCompany,
} from "@/features/app-crm/use-crm-companies";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useClients } from "@/features/settings/use-clients";
import {
  CRM_CURRENCIES,
  crmMoney,
  type CrmCompany,
  type CrmTargetRef,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";

type CompanyFormValues = {
  name: string;
  domain?: string;
  linkedin_url?: string;
  annual_revenue?: number | null;
  currency_code?: string;
  employees?: number | null;
  icp?: boolean;
  account_owner_id?: string | null;
  client_id?: string | null;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  address_country?: string;
};

export default function CrmCompaniesPage() {
  const { message } = App.useApp();
  const { data: companies, isLoading } = useCrmCompanies();
  const { data: people } = useCrmPeople();
  const { data: members } = useTeamMembers();
  const { data: clients } = useClients();
  const createCompany = useCreateCrmCompany();
  const updateCompany = useUpdateCrmCompany();
  const setDeleted = useSetCrmCompanyDeleted();
  const destroyCompany = useDestroyCrmCompany();

  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmCompany | null>(null);
  const [viewTarget, setViewTarget] = useState<CrmTargetRef | null>(null);
  const [form] = Form.useForm<CompanyFormValues>();

  const peopleCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of people ?? []) {
      if (p.company_id && !p.deleted_at) {
        counts.set(p.company_id, (counts.get(p.company_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [people]);

  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) if (m.user) map.set(m.user.id, m.user.name);
    return (id: string | null) => (id && map.get(id)) || "—";
  }, [members]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (companies ?? [])
      .filter((c) => (showDeleted ? Boolean(c.deleted_at) : !c.deleted_at))
      .filter((c) => {
        if (!needle) return true;
        return [c.name, c.domain ?? "", c.address_city ?? "", c.address_country ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
  }, [companies, search, showDeleted]);

  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.active && m.user)
        .map((m) => ({ value: m.user!.id, label: m.user!.name })),
    [members],
  );

  const clientOptions = useMemo(
    () => (clients ?? []).map((c) => ({ value: c.id, label: c.name })),
    [clients],
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setFormOpen(true);
  };

  const openEdit = (company: CrmCompany) => {
    setEditing(company);
    form.setFieldsValue({
      name: company.name,
      domain: company.domain ?? undefined,
      linkedin_url: company.linkedin_url ?? undefined,
      annual_revenue: company.annual_revenue,
      currency_code: company.currency_code,
      employees: company.employees,
      icp: company.icp,
      account_owner_id: company.account_owner_id,
      client_id: company.client_id,
      address_street: company.address_street ?? undefined,
      address_city: company.address_city ?? undefined,
      address_state: company.address_state ?? undefined,
      address_zip: company.address_zip ?? undefined,
      address_country: company.address_country ?? undefined,
    });
    setFormOpen(true);
  };

  const handleSubmit = async (values: CompanyFormValues) => {
    const patch = {
      name: values.name.trim(),
      domain: values.domain?.trim() || null,
      linkedin_url: values.linkedin_url?.trim() || null,
      annual_revenue: values.annual_revenue ?? null,
      currency_code: values.currency_code || "USD",
      employees: values.employees ?? null,
      icp: Boolean(values.icp),
      account_owner_id: values.account_owner_id ?? null,
      client_id: values.client_id ?? null,
      address_street: values.address_street?.trim() || null,
      address_city: values.address_city?.trim() || null,
      address_state: values.address_state?.trim() || null,
      address_zip: values.address_zip?.trim() || null,
      address_country: values.address_country?.trim() || null,
    };
    try {
      if (editing) {
        await updateCompany.mutateAsync({ id: editing.id, patch });
        message.success("Company updated.");
      } else {
        await createCompany.mutateAsync(patch);
        message.success("Company added.");
      }
      setFormOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Failed to save company."));
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
          Companies
        </Typography.Title>
        <Space wrap>
          <Input
            allowClear
            prefix={<MIcon name="search" size={16} />}
            placeholder="Search companies…"
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
            New company
          </Button>
        </Space>
      </Space>

      <Table
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={rows}
        pagination={{ pageSize: 25, hideOnSinglePage: true }}
        onRow={(c) => ({
          onClick: () => setViewTarget({ type: "company", id: c.id }),
          style: { cursor: "pointer" },
        })}
        columns={[
          {
            title: "Name",
            key: "name",
            render: (_, c) => (
              <Space>
                <Avatar size={26} shape="square">
                  {c.name.charAt(0).toUpperCase()}
                </Avatar>
                <span style={{ fontWeight: 500 }}>{c.name}</span>
                {c.icp ? <Tag color="green">ICP</Tag> : null}
              </Space>
            ),
            sorter: (a, b) => a.name.localeCompare(b.name),
          },
          {
            title: "Domain",
            dataIndex: "domain",
            render: (v: string | null) => v || "—",
          },
          {
            title: "People",
            key: "people",
            render: (_, c) => peopleCount.get(c.id) ?? 0,
            sorter: (a, b) =>
              (peopleCount.get(a.id) ?? 0) - (peopleCount.get(b.id) ?? 0),
          },
          {
            title: "Account owner",
            key: "owner",
            render: (_, c) => memberName(c.account_owner_id),
          },
          {
            title: "Annual revenue",
            key: "revenue",
            render: (_, c) =>
              c.annual_revenue === null
                ? "—"
                : crmMoney(c.annual_revenue, c.currency_code),
            sorter: (a, b) => (a.annual_revenue ?? 0) - (b.annual_revenue ?? 0),
          },
          {
            title: "Employees",
            dataIndex: "employees",
            render: (v: number | null) => v ?? "—",
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
            render: (_, c) => (
              <Space onClick={(e) => e.stopPropagation()}>
                {c.deleted_at ? (
                  <>
                    <Button
                      size="small"
                      onClick={async () => {
                        try {
                          await setDeleted.mutateAsync({
                            id: c.id,
                            deleted: false,
                          });
                          message.success("Company restored.");
                        } catch (err) {
                          message.error(errMsg(err, "Failed to restore."));
                        }
                      }}
                    >
                      Restore
                    </Button>
                    <Popconfirm
                      title="Permanently delete this company?"
                      description="This cannot be undone. Its people and deals stay, unlinked."
                      onConfirm={async () => {
                        try {
                          await destroyCompany.mutateAsync(c.id);
                          message.success("Company permanently deleted.");
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
                      onClick={() => openEdit(c)}
                    />
                    <Popconfirm
                      title="Delete this company?"
                      description="It moves to Deleted and can be restored."
                      onConfirm={async () => {
                        try {
                          await setDeleted.mutateAsync({
                            id: c.id,
                            deleted: true,
                          });
                          message.success("Company deleted.");
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
        title={editing ? "Edit company" : "New company"}
        width={460}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: "Company name is required" }]}
          >
            <Input placeholder="Company name" />
          </Form.Item>
          <Form.Item name="domain" label="Domain">
            <Input placeholder="acme.com" />
          </Form.Item>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item
              name="annual_revenue"
              label="Annual revenue"
              style={{ flex: 1, marginRight: 8 }}
            >
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                placeholder="1000000"
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
          <Form.Item name="employees" label="Employees">
            <InputNumber style={{ width: "100%" }} min={0} placeholder="25" />
          </Form.Item>
          <Form.Item
            name="icp"
            label="Ideal customer profile"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="account_owner_id" label="Account owner">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={memberOptions}
              placeholder="Team member who owns this account"
            />
          </Form.Item>
          <Form.Item
            name="client_id"
            label="Linked client"
            tooltip="Ties this account to a core Cubes client (projects, portal)."
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={clientOptions}
              placeholder="Optional"
            />
          </Form.Item>
          <Form.Item name="linkedin_url" label="LinkedIn URL">
            <Input placeholder="https://linkedin.com/company/…" />
          </Form.Item>
          <Form.Item name="address_street" label="Street">
            <Input />
          </Form.Item>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item
              name="address_city"
              label="City"
              style={{ flex: 1, marginRight: 8 }}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="address_state"
              label="State"
              style={{ flex: 1 }}
            >
              <Input />
            </Form.Item>
          </Space.Compact>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item
              name="address_zip"
              label="ZIP"
              style={{ flex: 1, marginRight: 8 }}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="address_country"
              label="Country"
              style={{ flex: 1 }}
            >
              <Input />
            </Form.Item>
          </Space.Compact>
          <Space style={{ justifyContent: "flex-end", width: "100%" }}>
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={createCompany.isPending || updateCompany.isPending}
            >
              {editing ? "Save changes" : "Add company"}
            </Button>
          </Space>
        </Form>
      </Drawer>

      <RecordDrawer target={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
