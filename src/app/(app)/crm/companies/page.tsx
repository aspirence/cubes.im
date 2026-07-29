"use client";

import { Suspense, useMemo, useState } from "react";
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Switch,
  Table,
  Tooltip,
  theme,
} from "antd";
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
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";
import { useRecordDeepLink } from "../_lib/record-deep-link";
import { CrmToggle } from "../_components/crm-toggle";
import { FormSection } from "../_components/form-section";
import {
  CRM_DRAWER_BODY_STYLE,
  CRM_DRAWER_FORM_STYLE,
  CRM_DRAWER_WIDTH,
  CrmDrawerFields,
  CrmDrawerFooter,
} from "../_components/drawer-footer";
import {
  CrmPageHeader,
  CrmSearch,
  CrmToolbar,
  EmptyState,
  EntityAvatar,
  EntityCell,
  Panel,
  RowActions,
  SoftChip,
  crmDate,
  crmPageStyle,
} from "../_lib/ui";

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
  // `useSearchParams` behind the ?m= deep link forces a client bailout — it
  // has to sit under Suspense or the production static pass errors out.
  return (
    <Suspense fallback={null}>
      <CrmCompaniesPageInner />
    </Suspense>
  );
}

function CrmCompaniesPageInner() {
  const { token } = theme.useToken();
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
  /** Seeded from `?m=` so a reminder notification opens this record. */
  const [viewTarget, setViewTarget, closeViewTarget] =
    useRecordDeepLink("company");
  const [confirmRow, setConfirmRow] = useState<string | null>(null);
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

  /** Quiet em dash for empty cells. */
  const dash = <span style={{ color: token.colorTextQuaternary }}>—</span>;

  const numberCell = (value: React.ReactNode) => (
    <span
      style={{
        color: token.colorTextSecondary,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}
    </span>
  );

  const emptyText = search.trim() ? (
    <EmptyState
      compact
      icon="search_off"
      title="No companies match your search"
      description={`Nothing found for “${search.trim()}”. Try a company name, domain, city, or country.`}
      action={<Button onClick={() => setSearch("")}>Clear search</Button>}
    />
  ) : showDeleted ? (
    <EmptyState
      compact
      icon="restore_from_trash"
      title="Nothing in Deleted"
      description="Companies you delete land here first, so you can restore them before they are permanently removed."
    />
  ) : (
    <EmptyState
      compact
      icon="domain"
      accent={token.colorPrimary}
      title="No companies yet"
      description="Add the accounts you sell to. Companies hold their people, deals, revenue, and account owner."
      action={
        <Button
          type="primary"
          icon={<MIcon name="add" size={16} />}
          onClick={openCreate}
        >
          Add your first company
        </Button>
      }
    />
  );

  return (
    <div style={crmPageStyle()}>
      <CrmPageHeader
        title="Companies"
        count={isLoading ? null : rows.length}
        subtitle="The accounts your team sells to — their people, revenue and owner."
      />

      <CrmToolbar>
        <CrmSearch
          value={search}
          onChange={setSearch}
          placeholder="Search companies…"
        />
        <CrmToggle
          checked={showDeleted}
          onChange={setShowDeleted}
          label="Deleted"
        />
        <Button
          type="primary"
          icon={<MIcon name="add" size={16} />}
          onClick={openCreate}
          style={{ marginLeft: "auto" }}
        >
          New company
        </Button>
      </CrmToolbar>

      <Panel padding={0}>
        <Table
          rowKey="id"
          size="middle"
          loading={isLoading}
          dataSource={rows}
          pagination={{
            pageSize: 25,
            hideOnSinglePage: true,
            style: { marginInline: 16 },
          }}
          scroll={{ x: 1000 }}
          locale={{
            emptyText: isLoading ? <div style={{ height: 120 }} /> : emptyText,
          }}
          onRow={(c) => ({
            onClick: () => setViewTarget({ type: "company", id: c.id }),
            style: { cursor: "pointer" },
          })}
          columns={[
            {
              title: "Company",
              key: "name",
              render: (_, c) => (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <EntityCell
                    kind="company"
                    name={c.name}
                    subtitle={c.domain || undefined}
                    muted={Boolean(c.deleted_at)}
                  />
                  {c.icp ? <SoftChip tone="success">ICP</SoftChip> : null}
                </div>
              ),
              sorter: (a, b) => a.name.localeCompare(b.name),
            },
            {
              title: "People",
              key: "people",
              width: 92,
              align: "right",
              render: (_, c) => numberCell(peopleCount.get(c.id) ?? 0),
              sorter: (a, b) =>
                (peopleCount.get(a.id) ?? 0) - (peopleCount.get(b.id) ?? 0),
            },
            {
              title: "Account owner",
              key: "owner",
              width: 190,
              render: (_, c) => {
                const name = memberName(c.account_owner_id);
                if (name === "—") return dash;
                return (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <EntityAvatar name={name} kind="person" size={22} />
                    <span
                      style={{
                        color: token.colorTextSecondary,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {name}
                    </span>
                  </div>
                );
              },
            },
            {
              title: "Annual revenue",
              key: "revenue",
              width: 150,
              align: "right",
              render: (_, c) =>
                c.annual_revenue === null
                  ? dash
                  : numberCell(crmMoney(c.annual_revenue, c.currency_code)),
              sorter: (a, b) => (a.annual_revenue ?? 0) - (b.annual_revenue ?? 0),
            },
            {
              title: "Employees",
              dataIndex: "employees",
              width: 118,
              align: "right",
              render: (v: number | null) =>
                v === null || v === undefined
                  ? dash
                  : numberCell(v.toLocaleString()),
            },
            {
              title: "Created",
              dataIndex: "created_at",
              width: 130,
              render: (v: string) => (
                <span style={{ color: token.colorTextTertiary }}>
                  {crmDate(v)}
                </span>
              ),
              sorter: (a, b) => a.created_at.localeCompare(b.created_at),
            },
            {
              title: "",
              key: "actions",
              width: 96,
              align: "right",
              render: (_, c) => (
                <RowActions open={confirmRow === c.id}>
                  {c.deleted_at ? (
                    <>
                      <Tooltip title="Restore">
                        <Button
                          type="text"
                          size="small"
                          icon={<MIcon name="restore_from_trash" size={17} />}
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
                        />
                      </Tooltip>
                      <Popconfirm
                        title="Permanently delete this company?"
                        description="This cannot be undone. Its people and deals stay, unlinked."
                        okText="Delete forever"
                        okButtonProps={{ danger: true }}
                        onOpenChange={(open) =>
                          setConfirmRow(open ? c.id : null)
                        }
                        onConfirm={async () => {
                          try {
                            await destroyCompany.mutateAsync(c.id);
                            message.success("Company permanently deleted.");
                          } catch (err) {
                            message.error(errMsg(err, "Failed to delete."));
                          }
                        }}
                      >
                        <Tooltip title="Delete forever">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<MIcon name="delete_forever" size={17} />}
                          />
                        </Tooltip>
                      </Popconfirm>
                    </>
                  ) : (
                    <>
                      <Tooltip title="Edit">
                        <Button
                          type="text"
                          size="small"
                          icon={<MIcon name="edit" size={16} />}
                          onClick={() => openEdit(c)}
                        />
                      </Tooltip>
                      <Popconfirm
                        title="Delete this company?"
                        description="It moves to Deleted and can be restored."
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onOpenChange={(open) =>
                          setConfirmRow(open ? c.id : null)
                        }
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
                        <Tooltip title="Delete">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<MIcon name="delete" size={16} />}
                          />
                        </Tooltip>
                      </Popconfirm>
                    </>
                  )}
                </RowActions>
              ),
            },
          ]}
        />
      </Panel>

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit company" : "New company"}
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
            <FormSection label="Identity" first>
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
              <Form.Item name="linkedin_url" label="LinkedIn URL">
                <Input placeholder="https://linkedin.com/company/…" />
              </Form.Item>
            </FormSection>

            <FormSection label="Business">
              <div style={{ display: "flex", gap: 12 }}>
                <Form.Item
                  name="annual_revenue"
                  label="Annual revenue"
                  style={{ flex: 1, minWidth: 0 }}
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
                  style={{ width: 110, flex: "none" }}
                >
                  <Select
                    options={CRM_CURRENCIES.map((c) => ({ value: c, label: c }))}
                  />
                </Form.Item>
              </div>
              <Form.Item name="employees" label="Employees">
                <InputNumber style={{ width: "100%" }} min={0} placeholder="25" />
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
              <Form.Item
                name="icp"
                label="Ideal customer profile"
                valuePropName="checked"
                extra="Flags this account as a fit for your ideal customer profile."
              >
                <Switch />
              </Form.Item>
            </FormSection>

            <FormSection label="Address">
              <Form.Item name="address_street" label="Street">
                <Input />
              </Form.Item>
              <div style={{ display: "flex", gap: 12 }}>
                <Form.Item
                  name="address_city"
                  label="City"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  name="address_state"
                  label="State"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Input />
                </Form.Item>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <Form.Item
                  name="address_zip"
                  label="ZIP"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  name="address_country"
                  label="Country"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Input />
                </Form.Item>
              </div>
            </FormSection>
          </CrmDrawerFields>

          <CrmDrawerFooter>
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={createCompany.isPending || updateCompany.isPending}
            >
              {editing ? "Save changes" : "Add company"}
            </Button>
          </CrmDrawerFooter>
        </Form>
      </Drawer>

      <RecordDrawer target={viewTarget} onClose={closeViewTarget} />
    </div>
  );
}
