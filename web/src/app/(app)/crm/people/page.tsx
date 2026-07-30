"use client";

import { Suspense, useMemo, useState } from "react";
import {
  App,
  Button,
  Drawer,
  Dropdown,
  Form,
  Input,
  Popconfirm,
  Select,
  Table,
  Tooltip,
  theme,
} from "antd";
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
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";
import { useRecordDeepLink } from "../_lib/record-deep-link";
import { CrmToggle } from "../_components/crm-toggle";
import { BulkBar, useBulkRun } from "../_components/bulk-bar";
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
  ErrorState,
  EntityCell,
  Panel,
  RowActions,
  crmDate,
  crmPageStyle,
} from "../_lib/ui";

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
  // `useSearchParams` behind the ?m= deep link forces a client bailout — it
  // has to sit under Suspense or the production static pass errors out.
  return (
    <Suspense fallback={null}>
      <CrmPeoplePageInner />
    </Suspense>
  );
}

function CrmPeoplePageInner() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const {
    data: people,
    isLoading,
    isError,
    error,
    refetch,
  } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const createPerson = useCreateCrmPerson();
  const updatePerson = useUpdateCrmPerson();
  const setDeleted = useSetCrmPersonDeleted();
  const destroyPerson = useDestroyCrmPerson();

  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const bulk = useBulkRun(() => setSelected([]));
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmPersonWithCompany | null>(null);
  /** Seeded from `?m=` so a reminder notification opens this record. */
  const [viewTarget, setViewTarget, closeViewTarget] =
    useRecordDeepLink("person");
  const [confirmRow, setConfirmRow] = useState<string | null>(null);
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

  /** Muted secondary-column text with a quiet em dash for empty values. */
  const softText = (value: string | null | undefined) =>
    value ? (
      <span style={{ color: token.colorTextSecondary }}>{value}</span>
    ) : (
      <span style={{ color: token.colorTextQuaternary }}>—</span>
    );

  // A failed fetch must never fall through to "No people yet" — that reads as
  // a confident empty account and invites re-creating records that exist.
  const emptyText = isError ? (
    <ErrorState
      compact
      title="Couldn't load people"
      error={error}
      onRetry={() => void refetch()}
    />
  ) : search.trim() ? (
    <EmptyState
      compact
      icon="search_off"
      title="No people match your search"
      description={`Nothing found for “${search.trim()}”. Try a name, email, job title, city, or company.`}
      action={<Button onClick={() => setSearch("")}>Clear search</Button>}
    />
  ) : showDeleted ? (
    <EmptyState
      compact
      icon="restore_from_trash"
      title="Nothing in Deleted"
      description="People you delete land here first, so you can restore them before they are permanently removed."
    />
  ) : (
    <EmptyState
      compact
      icon="group"
      accent={token.colorPrimary}
      title="No people yet"
      description="Add the contacts you work with. Each person keeps their own deals, tasks, notes, and timeline."
      action={
        <Button
          type="primary"
          icon={<MIcon name="add" size={16} />}
          onClick={openCreate}
        >
          Add your first person
        </Button>
      }
    />
  );

  return (
    <div style={crmPageStyle()}>
      <CrmPageHeader
        title="People"
        count={isLoading || isError ? null : rows.length}
        subtitle="Every contact in your team's CRM. Open a record to see its deals, tasks and notes."
      />

      <CrmToolbar>
        <CrmSearch
          value={search}
          onChange={setSearch}
          placeholder="Search people…"
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
          New person
        </Button>
      </CrmToolbar>

      <Panel padding={0}>
        <Table
          rowKey="id"
          size="middle"
          loading={isLoading}
          dataSource={rows}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys as string[]),
            preserveSelectedRowKeys: true,
          }}
          pagination={{
            pageSize: 25,
            hideOnSinglePage: true,
            style: { marginInline: 16 },
          }}
          scroll={{ x: 880 }}
          locale={{
            emptyText: isLoading ? <div style={{ height: 120 }} /> : emptyText,
          }}
          onRow={(p) => ({
            onClick: () => setViewTarget({ type: "person", id: p.id }),
            style: { cursor: "pointer" },
          })}
          columns={[
            {
              title: "Name",
              key: "name",
              render: (_, p) => {
                const name = crmPersonName(p) || "Unnamed";
                const subtitle = [p.job_title, p.company?.name]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <EntityCell
                    kind="person"
                    name={name}
                    subtitle={subtitle || undefined}
                    src={p.avatar_url}
                    muted={Boolean(p.deleted_at)}
                  />
                );
              },
              sorter: (a, b) => crmPersonName(a).localeCompare(crmPersonName(b)),
            },
            {
              title: "Email",
              dataIndex: "email",
              render: (v: string | null) => softText(v),
            },
            {
              title: "Phone",
              dataIndex: "phone",
              render: (v: string | null) => softText(v),
            },
            {
              title: "City",
              dataIndex: "city",
              render: (v: string | null) => softText(v),
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
              render: (_, p) => (
                <RowActions open={confirmRow === p.id}>
                  {p.deleted_at ? (
                    <>
                      <Tooltip title="Restore">
                        <Button
                          type="text"
                          size="small"
                          icon={<MIcon name="restore_from_trash" size={17} />}
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
                        />
                      </Tooltip>
                      <Popconfirm
                        title="Permanently delete this person?"
                        description="This cannot be undone."
                        okText="Delete forever"
                        okButtonProps={{ danger: true }}
                        onOpenChange={(open) =>
                          setConfirmRow(open ? p.id : null)
                        }
                        onConfirm={async () => {
                          try {
                            await destroyPerson.mutateAsync(p.id);
                            message.success("Person permanently deleted.");
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
                          onClick={() => openEdit(p)}
                        />
                      </Tooltip>
                      <Popconfirm
                        title="Delete this person?"
                        description="They move to Deleted and can be restored."
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onOpenChange={(open) =>
                          setConfirmRow(open ? p.id : null)
                        }
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

        <BulkBar count={selected.length} onClear={() => setSelected([])}>
          {/* Pasted leads arrive in runs for one account, so filing a screenful
              under a company is the move this list is actually used for. */}
          <Dropdown
            disabled={bulk.busy || companyOptions.length === 0}
            menu={{
              items: [
                ...companyOptions.map((c) => ({
                  key: c.value,
                  label: c.label,
                })),
                { type: "divider" as const },
                { key: "__none__", label: "No company" },
              ],
              onClick: ({ key }) =>
                void bulk.run(selected, "Company set", (id) =>
                  updatePerson.mutateAsync({
                    id,
                    patch: { company_id: key === "__none__" ? null : key },
                  }),
                ),
            }}
          >
            <Button size="small" icon={<MIcon name="domain" size={15} />}>
              Set company
            </Button>
          </Dropdown>

          {showDeleted ? (
            <Button
              size="small"
              disabled={bulk.busy}
              icon={<MIcon name="restore_from_trash" size={15} />}
              onClick={() =>
                void bulk.run(selected, "Restored", (id) =>
                  setDeleted.mutateAsync({ id, deleted: false }),
                )
              }
            >
              Restore
            </Button>
          ) : (
            <Popconfirm
              title={`Delete ${selected.length} ${selected.length === 1 ? "person" : "people"}?`}
              description="They move to Deleted and can be restored."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() =>
                void bulk.run(selected, "Deleted", (id) =>
                  setDeleted.mutateAsync({ id, deleted: true }),
                )
              }
            >
              <Button
                size="small"
                danger
                disabled={bulk.busy}
                icon={<MIcon name="delete" size={15} />}
              >
                Delete
              </Button>
            </Popconfirm>
          )}
        </BulkBar>
      </Panel>

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit person" : "New person"}
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
              <div style={{ display: "flex", gap: 12 }}>
                <Form.Item
                  name="first_name"
                  label="First name"
                  rules={[{ required: true, message: "First name is required" }]}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Input placeholder="First name" />
                </Form.Item>
                <Form.Item
                  name="last_name"
                  label="Last name"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Input placeholder="Last name" />
                </Form.Item>
              </div>
            </FormSection>

            <FormSection label="Contact">
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
              <Form.Item name="city" label="City">
                <Input placeholder="City" />
              </Form.Item>
              <Form.Item name="linkedin_url" label="LinkedIn URL">
                <Input placeholder="https://linkedin.com/in/…" />
              </Form.Item>
            </FormSection>

            <FormSection label="Work">
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
            </FormSection>
          </CrmDrawerFields>

          <CrmDrawerFooter>
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={createPerson.isPending || updatePerson.isPending}
            >
              {editing ? "Save changes" : "Add person"}
            </Button>
          </CrmDrawerFooter>
        </Form>
      </Drawer>

      <RecordDrawer target={viewTarget} onClose={closeViewTarget} />
    </div>
  );
}
