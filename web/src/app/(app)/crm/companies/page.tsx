"use client";

import { Suspense, useMemo, useState } from "react";
import {
  App,
  Button,
  Drawer,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Switch,
  Tooltip,
  theme,
  type TableColumnsType,
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
import { useProjects } from "@/features/projects/use-projects";
import {
  CRM_CURRENCIES,
  crmMoney,
  type CrmCompany,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";
import { useRecordDeepLink } from "../_lib/record-deep-link";
import {
  NO_PROJECT,
  useCrmScope,
  useResetOnScopeChange,
  useScopeMismatchNotice,
} from "../_lib/crm-scope";
import { ScopedEmptyState } from "../_components/crm-scope-bar";
import { CrmToggle } from "../_components/crm-toggle";
import { FormSection } from "../_components/form-section";
import { BulkBar, useBulkRun } from "../_components/bulk-bar";
import {
  CrmTable,
  CrmTableCard,
  DateCell,
  DateCreatedFilter,
  EmptyCell,
  FilterButton,
  ManageColumns,
  TableSearch,
  TagPill,
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
import { useProjectMoveItem, useRecordMenu } from "../_components/record-menu";
import {
  CRM_DRAWER_BODY_STYLE,
  CRM_DRAWER_FORM_STYLE,
  CRM_DRAWER_WIDTH,
  CrmDrawerFields,
  CrmDrawerFooter,
} from "../_components/drawer-footer";
import {
  CrmPageHeader,
  EmptyState,
  ErrorState,
  EntityAvatar,
  EntityCell,
  RowActions,
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
  project_id?: string | null;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  address_country?: string;
};

/** The key for "no owner" in the owner filter and the bulk Set owner menu. */
const NO_OWNER = "__none__";

/**
 * The columns "Manage columns" can hide and reorder, in their default order —
 * every data column, the company name included. The row actions are never a
 * choice, so a row can always be acted on.
 */
const COLUMN_CHOICES: ColumnChoice[] = [
  { key: "name", title: "Company" },
  { key: "people", title: "People" },
  { key: "owner", title: "Account owner" },
  { key: "revenue", title: "Annual revenue" },
  { key: "employees", title: "Employees" },
  { key: "icp", title: "ICP" },
  { key: "created", title: "Date created" },
  { key: "updated", title: "Last update" },
];

/** The company column's share of `scroll.x` (it takes whatever is left). */
const NAME_COLUMN_MIN = 200;
/** The selection checkbox column. */
const SELECTION_COLUMN = 48;

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
  const { message, modal } = App.useApp();
  const {
    data: companies,
    isLoading,
    isError,
    error,
    refetch,
  } = useCrmCompanies();
  const { data: people } = useCrmPeople();
  const { data: members } = useTeamMembers();
  const { data: clients } = useClients();
  const createCompany = useCreateCrmCompany();
  const updateCompany = useUpdateCrmCompany();
  const setDeleted = useSetCrmCompanyDeleted();
  const destroyCompany = useDestroyCrmCompany();
  const { projectId, project, isNoProject, projects, inScope } = useCrmScope();
  const notify = useScopeMismatchNotice();
  const recordMenu = useRecordMenu();
  const projectMoveItem = useProjectMoveItem();

  const [search, setSearch] = useState("");
  // The filters behave like the search: plain view state that survives a
  // scope flip and leaves the selection alone (it is kept across filtering).
  const [createdPreset, setCreatedPreset] = useState<CreatedPreset>("any");
  const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const columnLayout = useColumnLayout("companies", COLUMN_CHOICES);
  const [showDeleted, setShowDeleted] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  // Selections survive filtering (preserveSelectedRowKeys), so a scope flip
  // has to drop them itself or a bulk action could hit hidden rows.
  useResetOnScopeChange(() => setSelected([]));
  const bulk = useBulkRun(() => setSelected([]));
  /**
   * Drops one company that just left this list (moved, deleted, restored,
   * destroyed) from the selection, for the same reason: the bulk bar would
   * still count it and the next bulk action would write to a row nobody sees.
   */
  const deselect = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((k) => k !== id) : s));
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmCompany | null>(null);
  /** Seeded from `?m=` so a reminder notification opens this record. */
  const [viewTarget, setViewTarget, closeViewTarget] =
    useRecordDeepLink("company");
  const [confirmRow, setConfirmRow] = useState<string | null>(null);
  const [form] = Form.useForm<CompanyFormValues>();

  // Team-wide on purpose: a company's people count is every contact linked
  // to it, whatever project each one is filed under.
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

  /** The created-date window the filter keeps, or null for any time. */
  const createdSpan = useMemo(
    () => createdWindow(createdPreset, createdRange),
    [createdPreset, createdRange],
  );

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const owners = new Set(ownerFilter);
    return (companies ?? [])
      .filter((c) => (showDeleted ? Boolean(c.deleted_at) : !c.deleted_at))
      // A company is filed under a project (or none), like deals and people;
      // only the current project's accounts are listed.
      .filter((c) => inScope(c.project_id))
      .filter((c) => {
        if (!needle) return true;
        return [c.name, c.domain ?? "", c.address_city ?? "", c.address_country ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .filter((c) => inCreatedWindow(createdSpan, c.created_at))
      .filter((c) => {
        if (owners.size === 0) return true;
        // An owner id that matches no team member reads as unowned in the
        // owner column and sort, so it files under "No owner" here too —
        // those are exactly the accounts a bulk Set owner is for.
        const owner = c.account_owner_id;
        return owners.has(owner && memberName(owner) !== "—" ? owner : NO_OWNER);
      });
  }, [
    companies,
    search,
    showDeleted,
    inScope,
    createdSpan,
    ownerFilter,
    memberName,
  ]);

  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.active && m.user)
        .map((m) => ({ value: m.user!.id, label: m.user!.name })),
    [members],
  );

  /**
   * The owner filter's choices: the active team, plus any former member who
   * still owns an account here, A–Z, then "No owner".
   */
  const ownerFilterOptions = useMemo(() => {
    const byId = new Map(memberOptions.map((m) => [m.value, m.label] as const));
    for (const c of companies ?? []) {
      const id = c.account_owner_id;
      if (!id || byId.has(id)) continue;
      const name = memberName(id);
      if (name !== "—") byId.set(id, name);
    }
    return [
      ...[...byId]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      { value: NO_OWNER, label: "No owner" },
    ];
  }, [memberOptions, companies, memberName]);

  const clientOptions = useMemo(
    () => (clients ?? []).map((c) => ({ value: c.id, label: c.name })),
    [clients],
  );

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
      project_id: company.project_id ?? undefined,
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
      project_id: values.project_id ?? null,
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
        // Moved to another project (or none)? The row just left this list —
        // say so, with a way to go and look. Only on a real move.
        if ((editing.project_id ?? null) !== patch.project_id) {
          if (!inScope(patch.project_id)) deselect(editing.id);
          notify({
            recordProjectId: patch.project_id,
            noun: "Company",
            verb: "moved to",
          });
        }
      } else {
        await createCompany.mutateAsync(patch);
        message.success("Company added.");
        // Saved to a project other than the current one? It is not in this
        // list — say so, with a way to go and look.
        notify({ recordProjectId: patch.project_id, noun: "Company" });
      }
      setFormOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Failed to save company."));
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
      await updateCompany.mutateAsync({ id, patch: { project_id: target } });
      moved += 1;
    });
    if (moved > 0) {
      notify({
        recordProjectId: target,
        noun: moved === 1 ? "1 company" : `${moved} companies`,
        verb: "moved to",
      });
    }
  };

  /** Soft delete: the company moves to Deleted and can be restored. */
  const deleteCompany = async (id: string) => {
    try {
      await setDeleted.mutateAsync({ id, deleted: true });
      deselect(id);
      message.success("Company deleted.");
    } catch (err) {
      message.error(errMsg(err, "Failed to delete."));
    }
  };

  const restoreCompany = async (id: string) => {
    try {
      await setDeleted.mutateAsync({ id, deleted: false });
      deselect(id);
      message.success("Company restored.");
    } catch (err) {
      message.error(errMsg(err, "Failed to restore."));
    }
  };

  const destroyCompanyForever = async (id: string) => {
    try {
      await destroyCompany.mutateAsync(id);
      deselect(id);
      message.success("Company permanently deleted.");
    } catch (err) {
      message.error(errMsg(err, "Failed to delete."));
    }
  };

  const setOwner = async (id: string, ownerId: string | null) => {
    try {
      await updateCompany.mutateAsync({
        id,
        patch: { account_owner_id: ownerId },
      });
      message.success(
        ownerId ? `Owner: ${memberName(ownerId)}.` : "Owner cleared.",
      );
    } catch (err) {
      message.error(errMsg(err, "Couldn't set the owner."));
    }
  };

  const setIcp = async (id: string, icp: boolean) => {
    try {
      await updateCompany.mutateAsync({ id, patch: { icp } });
      message.success(icp ? "Marked as ICP." : "ICP removed.");
    } catch (err) {
      message.error(errMsg(err, "Couldn't update ICP."));
    }
  };

  /**
   * The right-click menu of a company row: the shared record items (open,
   * edit, new task / note / reminder, website, copy) with this page's own —
   * project, account owner, ICP — and delete, each the same write as the row
   * buttons, the bulk bar and the edit drawer. A deleted company offers only
   * Open, Copy, Restore and Delete forever.
   */
  const companyMenu = (c: CrmCompany): CrmMenuItem[] => {
    const target = { type: "company" as const, id: c.id };
    const onOpen = () => setViewTarget(target);

    if (c.deleted_at) {
      return recordMenu.build({
        target,
        name: c.name,
        onOpen,
        canCreate: false,
        danger: [
          {
            key: "restore",
            label: "Restore",
            icon: "restore_from_trash",
            onSelect: () => void restoreCompany(c.id),
          },
          {
            key: "destroy",
            label: "Delete forever…",
            icon: "delete_forever",
            danger: true,
            onSelect: () =>
              modal.confirm({
                title: `Permanently delete ${c.name}?`,
                content: "This cannot be undone. Its people and deals stay, unlinked.",
                okText: "Delete forever",
                okButtonProps: { danger: true },
                onOk: () => destroyCompanyForever(c.id),
              }),
          },
        ],
      });
    }

    const owner = c.account_owner_id;
    const ownerName = memberName(owner);
    // An owner id that matches no team member reads as unowned, as in the
    // owner column and filter.
    const unowned = ownerName === "—";

    return recordMenu.build({
      target,
      name: c.name,
      onOpen,
      onEdit: () => openEdit(c),
      website: c.domain,
      manage: [
        ...(projects.length > 0
          ? [
              projectMoveItem({
                current: c.project_id,
                noun: "Company",
                onMove: async (projectId) => {
                  await updateCompany.mutateAsync({
                    id: c.id,
                    patch: { project_id: projectId },
                  });
                  if (!inScope(projectId)) deselect(c.id);
                },
              }),
            ]
          : []),
        {
          key: "owner",
          label: "Set account owner",
          icon: "person",
          extra: unowned ? "No owner" : ownerName,
          children: [
            ...memberOptions.map((m) => ({
              key: m.value,
              label: m.label,
              checked: m.value === owner,
              onSelect:
                m.value === owner ? undefined : () => void setOwner(c.id, m.value),
            })),
            { type: "divider" as const },
            {
              key: NO_OWNER,
              label: "No owner",
              icon: "person_off",
              checked: unowned,
              onSelect: owner === null ? undefined : () => void setOwner(c.id, null),
            },
          ],
        },
        c.icp
          ? {
              key: "icp",
              label: "Remove ICP",
              icon: "star_border",
              onSelect: () => void setIcp(c.id, false),
            }
          : {
              key: "icp",
              label: "Mark as ICP",
              icon: "star",
              onSelect: () => void setIcp(c.id, true),
            },
      ],
      danger: [
        {
          key: "delete",
          label: "Delete…",
          icon: "delete",
          danger: true,
          onSelect: () =>
            modal.confirm({
              title: `Delete ${c.name}?`,
              content: "It moves to Deleted and can be restored.",
              okText: "Delete",
              okButtonProps: { danger: true },
              onOk: () => deleteCompany(c.id),
            }),
        },
      ],
    });
  };

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

  const filtersOn = createdSpan !== null || ownerFilter.length > 0;
  const clearCreated = () => {
    setCreatedPreset("any");
    setCreatedRange(null);
  };
  const clearFilters = () => {
    clearCreated();
    setOwnerFilter([]);
  };
  const showOwnerFilter =
    ownerFilterOptions.length > 1 || ownerFilter.length > 0;

  // A failed fetch must never fall through to "No companies yet" — an empty
  // account is a very different message from a query that didn't come back.
  const query = search.trim();
  const emptyText = isError ? (
    <ErrorState
      compact
      title="Couldn't load companies"
      error={error}
      onRetry={() => void refetch()}
    />
  ) : query || filtersOn ? (
    <EmptyState
      compact
      icon="search_off"
      title={
        query
          ? "No companies match your search"
          : "No companies match these filters"
      }
      description={
        query
          ? `Nothing found for “${query}”${filtersOn ? " with the current filters" : ""}. Try a company name, domain, city, or country.`
          : "Nothing here matches the date and owner filters. Clear them to see every company."
      }
      action={
        <Button
          onClick={() => {
            setSearch("");
            clearFilters();
          }}
        >
          {query && filtersOn
            ? "Clear search and filters"
            : query
              ? "Clear search"
              : "Clear filters"}
        </Button>
      }
    />
  ) : showDeleted ? (
    <EmptyState
      compact
      icon="restore_from_trash"
      title="Nothing in Deleted"
      description="Companies you delete land here first, so you can restore them before they are permanently removed."
    />
  ) : project ? (
    <ScopedEmptyState compact nouns="companies" onCreate={openCreate} />
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

  /** The owner's name for sorting; unowned accounts sort together. */
  const ownerSortKey = (c: CrmCompany) => {
    const name = memberName(c.account_owner_id);
    return name === "—" ? "" : name;
  };

  const columns: TableColumnsType<CrmCompany> = [
    {
      title: "Company",
      key: "name",
      render: (_, c) => (
        <EntityCell
          kind="company"
          name={c.name}
          subtitle={c.domain || undefined}
          muted={Boolean(c.deleted_at)}
        />
      ),
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: "People",
      key: "people",
      width: 84,
      align: "right",
      render: (_, c) => numberCell(peopleCount.get(c.id) ?? 0),
      sorter: (a, b) =>
        (peopleCount.get(a.id) ?? 0) - (peopleCount.get(b.id) ?? 0),
    },
    {
      title: "Account owner",
      key: "owner",
      width: 168,
      render: (_, c) => {
        const name = memberName(c.account_owner_id);
        if (name === "—") return <EmptyCell />;
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
      sorter: (a, b) => ownerSortKey(a).localeCompare(ownerSortKey(b)),
    },
    {
      title: "Annual revenue",
      key: "revenue",
      width: 140,
      align: "right",
      render: (_, c) =>
        c.annual_revenue === null
          ? <EmptyCell />
          : numberCell(crmMoney(c.annual_revenue, c.currency_code)),
      sorter: (a, b) => (a.annual_revenue ?? 0) - (b.annual_revenue ?? 0),
    },
    {
      title: "Employees",
      key: "employees",
      dataIndex: "employees",
      width: 108,
      align: "right",
      render: (v: number | null) =>
        v === null || v === undefined ? <EmptyCell /> : numberCell(v.toLocaleString()),
      sorter: (a, b) => (a.employees ?? 0) - (b.employees ?? 0),
    },
    {
      title: "ICP",
      key: "icp",
      width: 80,
      render: (_, c) => (c.icp ? <TagPill label="ICP" tone="success" /> : <EmptyCell />),
      sorter: (a, b) => Number(a.icp) - Number(b.icp),
    },
    {
      title: "Date created",
      key: "created",
      dataIndex: "created_at",
      width: 124,
      render: (v: string) => <DateCell value={v} />,
      sorter: (a, b) => a.created_at.localeCompare(b.created_at),
    },
    {
      title: "Last update",
      key: "updated",
      dataIndex: "updated_at",
      width: 116,
      render: (v: string) => <UpdatedCell value={v} />,
      sorter: (a, b) => a.updated_at.localeCompare(b.updated_at),
    },
    {
      title: "",
      key: "actions",
      width: 88,
      align: "right",
      fixed: "right",
      render: (_, c) => (
        <RowActions open={confirmRow === c.id}>
          {c.deleted_at ? (
            <>
              <Tooltip title="Restore">
                <Button
                  type="text"
                  size="small"
                  icon={<MIcon name="restore_from_trash" size={17} />}
                  onClick={() => void restoreCompany(c.id)}
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
                onConfirm={() => destroyCompanyForever(c.id)}
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
                onConfirm={() => deleteCompany(c.id)}
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

  // The user's order, hidden columns dropped; the actions column stays last.
  const visibleColumns = columnLayout.arrange(columns);
  // The company column has no width (it takes what is left), so while it
  // shows it counts as its minimum; below this the table scrolls instead of
  // squeezing names.
  const scrollX = visibleColumns.reduce(
    (sum, c) => sum + (typeof c.width === "number" ? c.width : NAME_COLUMN_MIN),
    SELECTION_COLUMN,
  );

  return (
    <div style={crmPageStyle()}>
      <CrmPageHeader
        title="Companies"
        count={isLoading || isError ? null : rows.length}
        subtitle={
          isNoProject
            ? "Accounts not filed under any project. Select some and use Set project to file them."
            : project
              ? `The accounts filed under ${project.name} — their people, revenue and owner.`
              : "The accounts your team sells to — their people, revenue and owner."
        }
        right={
          <Button
            type="primary"
            icon={<MIcon name="add" size={16} />}
            onClick={openCreate}
          >
            New company
          </Button>
        }
      />

      <CrmTableCard
        toolbar={
          <>
            <TableSearch
              value={search}
              onChange={setSearch}
              placeholder="Search companies…"
            />
            <DateCreatedFilter
              preset={createdPreset}
              range={createdRange}
              onChange={(preset, range) => {
                setCreatedPreset(preset);
                setCreatedRange(range);
              }}
            />
            {showOwnerFilter ? (
              <FilterButton
                icon="person"
                label="Account owner"
                activeCount={ownerFilter.length}
                onClear={() => setOwnerFilter([])}
              >
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  maxTagCount="responsive"
                  placeholder="Any owner"
                  value={ownerFilter}
                  onChange={setOwnerFilter}
                  options={ownerFilterOptions}
                  style={{ width: "100%" }}
                />
              </FilterButton>
            ) : null}
            <ToolbarSpacer />
            <CrmToggle
              checked={showDeleted}
              onChange={setShowDeleted}
              label="Deleted"
            />
            <ManageColumns layout={columnLayout} />
            <ViewSwitch
              value="companies"
              options={[
                { value: "people", label: "People", href: "/crm/people" },
                { value: "companies", label: "Companies", href: "/crm/companies" },
              ]}
            />
          </>
        }
      >
        <CrmTable<CrmCompany>
          rowKey="id"
          loading={isLoading}
          dataSource={rows}
          columns={visibleColumns}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys as string[]),
            preserveSelectedRowKeys: true,
          }}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          scroll={{ x: scrollX }}
          locale={{
            emptyText: isLoading ? <div style={{ height: 120 }} /> : emptyText,
          }}
          onRow={(c) => ({
            onClick: () => setViewTarget({ type: "company", id: c.id }),
          })}
          rowContextMenu={companyMenu}
        />

        <BulkBar count={selected.length} onClear={() => setSelected([])}>
          <Dropdown
            disabled={bulk.busy || memberOptions.length === 0}
            menu={{
              items: [
                ...memberOptions.map((m) => ({
                  key: m.value,
                  label: m.label,
                })),
                { type: "divider" as const },
                { key: NO_OWNER, label: "No owner" },
              ],
              onClick: ({ key }) =>
                void bulk.run(selected, "Owner set", (id) =>
                  updateCompany.mutateAsync({
                    id,
                    patch: {
                      account_owner_id: key === NO_OWNER ? null : key,
                    },
                  }),
                ),
            }}
          >
            <Button size="small" icon={<MIcon name="person" size={15} />}>
              Set owner
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

          {/* Qualifying a screenful of accounts at once is the reason ICP is a
              flag rather than a note. */}
          <Button
            size="small"
            disabled={bulk.busy}
            icon={<MIcon name="star" size={15} />}
            onClick={() =>
              void bulk.run(selected, "Marked ICP", (id) =>
                updateCompany.mutateAsync({ id, patch: { icp: true } }),
              )
            }
          >
            Mark ICP
          </Button>
          <Button
            size="small"
            disabled={bulk.busy}
            icon={<MIcon name="star_border" size={15} />}
            onClick={() =>
              void bulk.run(selected, "Cleared ICP", (id) =>
                updateCompany.mutateAsync({ id, patch: { icp: false } }),
              )
            }
          >
            Clear ICP
          </Button>

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
              title={`Delete ${selected.length} compan${selected.length === 1 ? "y" : "ies"}?`}
              description="They move to Deleted and can be restored. People and deals stay, unlinked."
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
      </CrmTableCard>

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
              {projectOptions.length > 0 ? (
                <Form.Item
                  name="project_id"
                  label="Project"
                  tooltip="The project this account is filed under in the CRM."
                >
                  <ProjectSelect options={projectOptions} />
                </Form.Item>
              ) : null}
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
