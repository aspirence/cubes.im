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
  Tooltip,
  theme,
  type TableColumnsType,
} from "antd";
import {
  useCreateCrmPerson,
  useCrmPeople,
  useDestroyCrmPerson,
  useSetCrmPersonDeleted,
  useUpdateCrmPerson,
} from "@/features/app-crm/use-crm-people";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useProjects } from "@/features/projects/use-projects";
import {
  crmPersonName,
  type CrmPersonWithCompany,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";
import { useProjectMoveItem, useRecordMenu } from "../_components/record-menu";
import { useRecordDeepLink } from "../_lib/record-deep-link";
import {
  NO_PROJECT,
  useCrmScope,
  useResetOnScopeChange,
  useScopeMismatchNotice,
} from "../_lib/crm-scope";
import { ScopedEmptyState } from "../_components/crm-scope-bar";
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
  CrmTable,
  CrmTableCard,
  DateCell,
  DateCreatedFilter,
  EmailChip,
  EmptyCell,
  FilterButton,
  ManageColumns,
  OrgCell,
  PhoneChip,
  TableSearch,
  ToolbarSpacer,
  UpdatedCell,
  ViewSwitch,
  createdWindow,
  inCreatedWindow,
  useColumnLayout,
  type ColumnChoice,
  type CreatedPreset,
  type CreatedRange,
  type CrmMenuItem,
} from "../_components/data-table";
import {
  CrmPageHeader,
  EmptyState,
  ErrorState,
  EntityCell,
  RowActions,
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
  project_id?: string | null;
};

/** The Company filter's value for people filed under no company. */
const NO_COMPANY = "__no_company__";

/**
 * The data columns (Manage columns: each can be hidden and dragged into
 * place), in their default order, with the widths the horizontal scroll is
 * sized from — Name's is its floor, the column itself stays fluid. Only the
 * row actions stay put. Everything shown adds up to ~1200px, inside the
 * widest CRM page (CRM_MAX_WIDTH, less the card border), so a desktop never
 * scrolls sideways and the pinned actions column never sits over a data
 * column there.
 */
const DATA_COLUMNS: { key: string; title: string; width: number }[] = [
  { key: "name", title: "Name", width: 200 },
  { key: "email", title: "Email", width: 200 },
  { key: "phone", title: "Phone", width: 140 },
  { key: "company", title: "Company", width: 160 },
  { key: "city", title: "City", width: 110 },
  { key: "created_at", title: "Date created", width: 125 },
  { key: "updated_at", title: "Last update", width: 120 },
];
const COLUMN_CHOICES: ColumnChoice[] = DATA_COLUMNS.map(({ key, title }) => ({
  key,
  title,
}));
const COLUMN_WIDTH: Record<string, number> = Object.fromEntries(
  DATA_COLUMNS.map((c) => [c.key, c.width]),
);
/** Checkbox column + the actions column. */
const FIXED_COLUMNS_WIDTH = 48 + 96;

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
  const { message, modal } = App.useApp();
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
  const { projectId, project, isNoProject, projects, inScope } = useCrmScope();
  const notify = useScopeMismatchNotice();
  const recordMenu = useRecordMenu();
  const projectMoveItem = useProjectMoveItem();

  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  // Filters behave like the search: they survive a scope flip and the Deleted
  // toggle, and a selection survives them (preserveSelectedRowKeys).
  const [createdPreset, setCreatedPreset] = useState<CreatedPreset>("any");
  const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  // Selections survive filtering (preserveSelectedRowKeys), so a scope flip
  // has to drop them itself or a bulk action could hit hidden rows.
  useResetOnScopeChange(() => setSelected([]));
  // For the same reason, a person that one write takes off this list
  // (deleted, restored, deleted forever, moved to another project) leaves
  // the selection too.
  const unselect = (id: string) =>
    setSelected((keys) =>
      keys.includes(id) ? keys.filter((k) => k !== id) : keys,
    );
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
    const created = createdWindow(createdPreset, createdRange);
    const companyIds = new Set(companyFilter);
    return (people ?? [])
      .filter((p) => (showDeleted ? Boolean(p.deleted_at) : !p.deleted_at))
      // A person is filed under a project (or none); only the current
      // project's contacts are listed. The Project field and the bulk
      // "Set project" move them.
      .filter((p) => inScope(p.project_id))
      .filter((p) => inCreatedWindow(created, p.created_at))
      .filter((p) =>
        companyIds.size === 0
          ? true
          : companyIds.has(p.company_id ?? NO_COMPANY),
      )
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
  }, [
    people,
    search,
    showDeleted,
    inScope,
    createdPreset,
    createdRange,
    companyFilter,
  ]);

  const companyOptions = useMemo(
    () =>
      (companies ?? [])
        .filter((c) => !c.deleted_at)
        .map((c) => ({ value: c.id, label: c.name })),
    [companies],
  );

  /**
   * The Company filter's choices: the live companies in the current project
   * scope, plus any company an in-scope person is filed under (it may sit in
   * another project, or be deleted) so every listed row can be reached, plus
   * any id still picked from an earlier scope so it shows a name, never an id.
   */
  const companyFilterOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const c of companies ?? []) {
      if (!c.deleted_at && inScope(c.project_id)) names.set(c.id, c.name);
    }
    for (const p of people ?? []) {
      if (p.company && inScope(p.project_id) && !names.has(p.company.id)) {
        names.set(p.company.id, p.company.name);
      }
    }
    for (const id of companyFilter) {
      if (id === NO_COMPANY || names.has(id)) continue;
      names.set(
        id,
        (companies ?? []).find((c) => c.id === id)?.name ?? "Unknown company",
      );
    }
    return [
      { value: NO_COMPANY, label: "No company" },
      ...[...names]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [companies, people, inScope, companyFilter]);

  const createdFilterOn =
    createdPreset === "custom" ? createdRange !== null : createdPreset !== "any";
  const filtersOn = createdFilterOn || companyFilter.length > 0;
  const clearFilters = () => {
    setCreatedPreset("any");
    setCreatedRange(null);
    setCompanyFilter([]);
  };

  const layout = useColumnLayout("people", COLUMN_CHOICES);

  const projectOptions = useProjectFieldOptions(
    projectId,
    editing?.project_id,
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    // Filed under the current project by default (none under "No project") —
    // a default, not a constraint: the Project field stays editable.
    form.setFieldsValue({ project_id: projectId ?? undefined });
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
      project_id: person.project_id ?? undefined,
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
      project_id: values.project_id ?? null,
    };
    try {
      if (editing) {
        await updatePerson.mutateAsync({ id: editing.id, patch });
        if (!inScope(patch.project_id)) unselect(editing.id);
        message.success("Person updated.");
        // Moved to another project (or none)? The row just left this list —
        // say so, with a way to go and look. Only on a real move: an edit
        // that keeps the project is never a mismatch worth a toast.
        if ((editing.project_id ?? null) !== patch.project_id) {
          notify({
            recordProjectId: patch.project_id,
            noun: "Person",
            verb: "moved to",
          });
        }
      } else {
        await createPerson.mutateAsync(patch);
        message.success("Person added.");
        // Saved to a project other than the current one? It is not in this
        // list — say so, with a way to go and look.
        notify({ recordProjectId: patch.project_id, noun: "Person" });
      }
      setFormOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Failed to save person."));
    }
  };

  /**
   * Bulk "Set project": files the selection under a project (or none). The
   * moved rows leave this list when the target is another project, so the
   * notice says where they went — counted from the writes that landed.
   */
  const moveSelectedToProject = async (key: string) => {
    const target = key === NO_PROJECT ? null : key;
    let moved = 0;
    await bulk.run(selected, "Project set", async (id) => {
      await updatePerson.mutateAsync({ id, patch: { project_id: target } });
      moved += 1;
    });
    if (moved > 0) {
      notify({
        recordProjectId: target,
        noun: moved === 1 ? "1 person" : `${moved} people`,
        verb: "moved to",
      });
    }
  };

  // One write each for the row's buttons and its right-click menu.
  const restorePerson = async (id: string) => {
    try {
      await setDeleted.mutateAsync({ id, deleted: false });
      unselect(id);
      message.success("Person restored.");
    } catch (err) {
      message.error(errMsg(err, "Failed to restore."));
    }
  };

  const deletePerson = async (id: string) => {
    try {
      await setDeleted.mutateAsync({ id, deleted: true });
      unselect(id);
      message.success("Person deleted.");
    } catch (err) {
      message.error(errMsg(err, "Failed to delete."));
    }
  };

  const destroyPersonForever = async (id: string) => {
    try {
      await destroyPerson.mutateAsync(id);
      unselect(id);
      message.success("Person permanently deleted.");
    } catch (err) {
      message.error(errMsg(err, "Failed to delete."));
    }
  };

  /**
   * The row menu's "Set company": the bulk Set company's write, for one
   * person. The list refetches before this settles, so the row already shows
   * the new company when the toast lands.
   */
  const setPersonCompany = async (
    id: string,
    company: { id: string; name: string } | null,
  ) => {
    try {
      await updatePerson.mutateAsync({
        id,
        patch: { company_id: company?.id ?? null },
      });
      message.success(
        company ? `Company set to ${company.name}.` : "Company cleared.",
      );
    } catch (err) {
      message.error(errMsg(err, "Couldn't set the company."));
    }
  };

  /** The live companies in the current project scope, A–Z (as fetched). */
  const scopedCompanies = useMemo(
    () =>
      (companies ?? [])
        .filter((c) => !c.deleted_at && inScope(c.project_id))
        .map((c) => ({ id: c.id, name: c.name })),
    [companies, inScope],
  );

  /**
   * "Set company ▸": the scope's companies with the person's own ticked —
   * listed even when it sits in another project or is deleted, so the menu
   * always shows where they are filed — then "No company".
   */
  const companyMenuItem = (p: CrmPersonWithCompany): CrmMenuItem => {
    const current = p.company;
    const list =
      current && !scopedCompanies.some((c) => c.id === current.id)
        ? [...scopedCompanies, current].sort((a, b) =>
            a.name.localeCompare(b.name),
          )
        : scopedCompanies;
    return {
      key: "company",
      label: "Set company",
      icon: "domain_add",
      extra: p.company_id ? current?.name : "No company",
      disabled: list.length === 0 && !p.company_id,
      children: [
        ...list.map((c) => ({
          key: c.id,
          label: c.name,
          checked: c.id === p.company_id,
          onSelect:
            c.id === p.company_id
              ? undefined
              : () => void setPersonCompany(p.id, c),
        })),
        { type: "divider" as const },
        {
          key: NO_COMPANY,
          label: "No company",
          icon: "domain_disabled",
          checked: p.company_id === null,
          onSelect:
            p.company_id === null
              ? undefined
              : () => void setPersonCompany(p.id, null),
        },
      ],
    };
  };

  /**
   * A row's right-click menu: Open · Edit… · Open company · Set company ▸ ·
   * Move to project ▸ · New task… · Add note… · Remind me ▸ · Send email ·
   * Call · Copy ▸ · Delete…. A deleted person gets Open · Copy ▸ · Restore ·
   * Delete forever… — nothing new is attached to a record in Deleted.
   * Deleting asks first, as the row's own Delete button does.
   */
  const personMenu = (p: CrmPersonWithCompany): CrmMenuItem[] => {
    const name = crmPersonName(p) || "Unnamed";
    const target = { type: "person" as const, id: p.id };
    const onOpen = () => setViewTarget(target);

    if (p.deleted_at) {
      return recordMenu.build({
        target,
        name,
        onOpen,
        canCreate: false,
        danger: [
          {
            key: "restore",
            label: "Restore",
            icon: "restore_from_trash",
            onSelect: () => void restorePerson(p.id),
          },
          {
            key: "destroy",
            label: "Delete forever…",
            icon: "delete_forever",
            danger: true,
            onSelect: () => {
              modal.confirm({
                title: `Permanently delete ${name}?`,
                content: "This cannot be undone.",
                okText: "Delete forever",
                okButtonProps: { danger: true },
                onOk: () => destroyPersonForever(p.id),
              });
            },
          },
        ],
      });
    }

    const company = p.company;
    return recordMenu.build({
      target,
      name,
      onOpen,
      onEdit: () => openEdit(p),
      email: p.email,
      phone: p.phone,
      manage: [
        ...(company
          ? [
              {
                key: "open-company",
                label: "Open company",
                icon: "domain",
                onSelect: () =>
                  setViewTarget({ type: "company", id: company.id }),
              },
            ]
          : []),
        companyMenuItem(p),
        projectMoveItem({
          current: p.project_id,
          noun: "Person",
          onMove: async (projectId) => {
            await updatePerson.mutateAsync({
              id: p.id,
              patch: { project_id: projectId },
            });
            if (!inScope(projectId)) unselect(p.id);
          },
        }),
      ],
      danger: [
        {
          key: "delete",
          label: "Delete…",
          icon: "delete",
          danger: true,
          onSelect: () => {
            modal.confirm({
              title: `Delete ${name}?`,
              content: "They move to Deleted and can be restored.",
              okText: "Delete",
              okButtonProps: { danger: true },
              onOk: () => deletePerson(p.id),
            });
          },
        },
      ],
    });
  };

  /** Muted secondary-column text with a quiet em dash for empty values. */
  const softText = (value: string | null | undefined) =>
    value ? (
      <span style={{ color: token.colorTextSecondary }}>{value}</span>
    ) : (
      <EmptyCell />
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
      description={
        filtersOn
          ? `Nothing found for “${search.trim()}” with the current filters. Try another search, or clear the filters.`
          : `Nothing found for “${search.trim()}”. Try a name, email, job title, city, or company.`
      }
      action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Button onClick={() => setSearch("")}>Clear search</Button>
          {filtersOn ? <Button onClick={clearFilters}>Clear filters</Button> : null}
        </div>
      }
    />
  ) : filtersOn ? (
    <EmptyState
      compact
      icon="filter_alt_off"
      title="No people match these filters"
      description="Nobody here was created in that window or is filed under those companies. Widen the dates or pick other companies."
      action={<Button onClick={clearFilters}>Clear filters</Button>}
    />
  ) : showDeleted ? (
    <EmptyState
      compact
      icon="restore_from_trash"
      title="Nothing in Deleted"
      description="People you delete land here first, so you can restore them before they are permanently removed."
    />
  ) : project ? (
    <ScopedEmptyState compact nouns="people" onCreate={openCreate} />
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

  const columns: TableColumnsType<CrmPersonWithCompany> = [
    {
      title: "Name",
      key: "name",
      render: (_, p) => {
        const name = crmPersonName(p) || "Unnamed";
        // The company has its own column; while that column is hidden it
        // rides along in the subtitle again so the row never loses it.
        const subtitle = [
          p.job_title,
          layout.isVisible("company") ? null : p.company?.name,
        ]
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
      key: "email",
      width: COLUMN_WIDTH.email,
      render: (v: string | null) => <EmailChip email={v} />,
    },
    {
      title: "Phone",
      dataIndex: "phone",
      key: "phone",
      width: COLUMN_WIDTH.phone,
      render: (v: string | null) => <PhoneChip phone={v} />,
    },
    {
      title: "Company",
      key: "company",
      width: COLUMN_WIDTH.company,
      render: (_, p) => {
        const company = p.company;
        return (
          <OrgCell
            name={company?.name}
            onClick={
              company
                ? () => setViewTarget({ type: "company", id: company.id })
                : undefined
            }
          />
        );
      },
      sorter: (a, b) =>
        (a.company?.name ?? "").localeCompare(b.company?.name ?? ""),
    },
    {
      title: "City",
      dataIndex: "city",
      key: "city",
      width: COLUMN_WIDTH.city,
      render: (v: string | null) => softText(v),
      sorter: (a, b) => (a.city ?? "").localeCompare(b.city ?? ""),
    },
    {
      title: "Date created",
      dataIndex: "created_at",
      key: "created_at",
      width: COLUMN_WIDTH.created_at,
      render: (v: string) => <DateCell value={v} />,
      sorter: (a, b) => a.created_at.localeCompare(b.created_at),
    },
    {
      title: "Last update",
      dataIndex: "updated_at",
      key: "updated_at",
      width: COLUMN_WIDTH.updated_at,
      render: (v: string) => <UpdatedCell value={v} />,
      sorter: (a, b) => a.updated_at.localeCompare(b.updated_at),
    },
    {
      title: "",
      key: "actions",
      width: 96,
      align: "right",
      fixed: "right",
      render: (_, p) => (
        <RowActions open={confirmRow === p.id}>
          {p.deleted_at ? (
            <>
              <Tooltip title="Restore">
                <Button
                  type="text"
                  size="small"
                  icon={<MIcon name="restore_from_trash" size={17} />}
                  onClick={() => void restorePerson(p.id)}
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
                onConfirm={() => destroyPersonForever(p.id)}
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
                onConfirm={() => deletePerson(p.id)}
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
  ];
  const visibleColumns = layout.arrange(columns);
  const scrollX =
    FIXED_COLUMNS_WIDTH +
    DATA_COLUMNS.filter((c) => layout.isVisible(c.key)).reduce(
      (sum, c) => sum + c.width,
      0,
    );

  return (
    <div style={crmPageStyle()}>
      <CrmPageHeader
        title="People"
        count={isLoading || isError ? null : rows.length}
        subtitle={
          isNoProject
            ? "Contacts not filed under any project. Select some and use Set project to file them."
            : project
              ? `The contacts filed under ${project.name}. Open a record to see its deals, tasks and notes.`
              : "Every contact in your team's CRM. Open a record to see its deals, tasks and notes."
        }
        right={
          <Button
            type="primary"
            icon={<MIcon name="add" size={16} />}
            onClick={openCreate}
          >
            New person
          </Button>
        }
      />

      <CrmTableCard
        toolbar={
          <>
            <TableSearch
              value={search}
              onChange={setSearch}
              placeholder="Search people…"
            />
            <DateCreatedFilter
              preset={createdPreset}
              range={createdRange}
              onChange={(preset, range) => {
                setCreatedPreset(preset);
                setCreatedRange(range);
              }}
            />
            <FilterButton
              icon="domain"
              label="Company"
              activeCount={companyFilter.length}
              onClear={() => setCompanyFilter([])}
            >
              <Select
                mode="multiple"
                allowClear
                showSearch
                optionFilterProp="label"
                maxTagCount="responsive"
                placeholder="Any company"
                value={companyFilter}
                onChange={setCompanyFilter}
                options={companyFilterOptions}
                style={{ width: "100%" }}
              />
            </FilterButton>
            <ToolbarSpacer />
            <CrmToggle
              checked={showDeleted}
              onChange={setShowDeleted}
              label="Deleted"
            />
            <ManageColumns layout={layout} />
            <ViewSwitch
              value="people"
              options={[
                { value: "people", label: "People", href: "/crm/people" },
                { value: "companies", label: "Companies", href: "/crm/companies" },
              ]}
            />
          </>
        }
        footer={
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

            <Dropdown
              disabled={bulk.busy || projects.length === 0}
              menu={{
                items: [
                  ...projects.map((p) => ({ key: p.id, label: p.name })),
                  { type: "divider" as const },
                  { key: NO_PROJECT, label: "No project" },
                ],
                onClick: ({ key }) => void moveSelectedToProject(key),
              }}
            >
              <Button size="small" icon={<MIcon name="folder_open" size={15} />}>
                Set project
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
        }
      >
        <CrmTable<CrmPersonWithCompany>
          rowKey="id"
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
          }}
          scroll={{ x: scrollX }}
          locale={{
            emptyText: isLoading ? <div style={{ height: 120 }} /> : emptyText,
          }}
          onRow={(p) => ({
            onClick: () => setViewTarget({ type: "person", id: p.id }),
            style: { cursor: "pointer" },
          })}
          rowContextMenu={personMenu}
          columns={visibleColumns}
        />
      </CrmTableCard>

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
              {projectOptions.length > 0 ? (
                <Form.Item
                  name="project_id"
                  label="Project"
                  tooltip="The project this contact is filed under in the CRM."
                >
                  <ProjectSelect options={projectOptions} />
                </Form.Item>
              ) : null}
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
      {/* The row menu's New task / Add note / Remind me dialogs. */}
      {recordMenu.dialogs}
    </div>
  );
}

interface ProjectOption {
  value: string;
  label: string;
  color: string | null;
}

/**
 * The Project field's options: the team's live projects A–Z, plus any id the
 * form may hold that is not among them (a project this user archived, or the
 * pinned one) so the field shows a name, never a raw id.
 */
function useProjectFieldOptions(
  ...extraIds: (string | null | undefined)[]
): ProjectOption[] {
  const { projects, project } = useCrmScope();
  const { data: allProjects } = useProjects();
  const extra = extraIds.filter((id): id is string => Boolean(id)).join(",");
  return useMemo(() => {
    const opts: ProjectOption[] = projects.map((p) => ({
      value: p.id,
      label: p.name,
      color: p.color,
    }));
    for (const id of extra ? extra.split(",") : []) {
      if (id === NO_PROJECT || opts.some((o) => o.value === id)) continue;
      const row = (allProjects ?? []).find((p) => p.id === id);
      opts.push({
        value: id,
        label: row
          ? row.is_archived
            ? `${row.name} (archived)`
            : row.name
          : project?.id === id
            ? project.name
            : "Another project",
        color: row
          ? (row.color_code ?? null)
          : project?.id === id
            ? project.color
            : null,
      });
    }
    return opts;
  }, [projects, project, allProjects, extra]);
}

/** Clearable: an empty value files the record under no project. */
function ProjectSelect({
  options,
  ...rest
}: {
  options: ProjectOption[];
  value?: string | null;
  onChange?: (value: string | null) => void;
}) {
  const { token } = theme.useToken();
  return (
    <Select
      {...rest}
      allowClear
      showSearch
      optionFilterProp="label"
      options={options}
      placeholder="No project"
      optionRender={(opt) => {
        const d = opt.data as unknown as ProjectOption;
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 3,
                background: d.color ?? token.colorTextQuaternary,
                flex: "none",
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {d.label}
            </span>
          </span>
        );
      }}
    />
  );
}
