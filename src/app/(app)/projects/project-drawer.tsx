"use client";

import { useEffect, useMemo } from "react";
import {
  App,
  Button,
  ColorPicker,
  DatePicker,
  Drawer,
  Form,
  Input,
  Select,
  Space,
} from "antd";
import type { Color } from "antd/es/color-picker";
import dayjs, { type Dayjs } from "dayjs";
import {
  useCreateProject,
  useUpdateProject,
  useProjectStatuses,
  useProjectHealths,
} from "@/features/projects/use-projects";
import { useProjectFolders } from "@/features/projects/use-project-folders";
import { useProjectCategories } from "@/features/settings/use-categories";
import { useClients } from "@/features/settings/use-clients";
import {
  useProjectTemplates,
  useCreateProjectFromTemplate,
} from "@/features/templates/use-templates";
import { useApplyTemplateViews } from "@/features/projects/use-project-views";
import { useRouter } from "next/navigation";
import type { ProjectRow } from "./types";

const DEFAULT_COLOR = "#70a6f3";

interface ProjectFormValues {
  name: string;
  key?: string;
  color_code?: string | Color;
  client_id?: string | null;
  category_id?: string | null;
  status_id?: string | null;
  health_id?: string | null;
  folder_id?: string | null;
  dates?: [Dayjs | null, Dayjs | null] | null;
  notes?: string;
  template_id?: string | null;
}

export interface ProjectDrawerProps {
  open: boolean;
  /** When set, the drawer edits this project; otherwise it creates a new one. */
  project: ProjectRow | null;
  onClose: () => void;
}

/** Normalises whatever ColorPicker hands back into a `#rrggbb` string. */
function toHex(value: string | Color | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return value.toHexString();
}

export function ProjectDrawer({ open, project, onClose }: ProjectDrawerProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ProjectFormValues>();

  const router = useRouter();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const createFromTemplate = useCreateProjectFromTemplate();
  const applyTemplateViews = useApplyTemplateViews();
  const { data: projectTemplates } = useProjectTemplates();

  const { data: clients, isLoading: clientsLoading } = useClients();
  const { data: categories, isLoading: categoriesLoading } =
    useProjectCategories();
  const { data: statuses, isLoading: statusesLoading } = useProjectStatuses();
  const { data: healths, isLoading: healthsLoading } = useProjectHealths();
  const { data: folders, isLoading: foldersLoading } = useProjectFolders();

  const isEditing = Boolean(project);

  useEffect(() => {
    if (!open) return;
    if (project) {
      const dates: ProjectFormValues["dates"] =
        project.start_date || project.end_date
          ? [
              project.start_date ? dayjs(project.start_date) : null,
              project.end_date ? dayjs(project.end_date) : null,
            ]
          : null;
      const values: ProjectFormValues = {
        name: project.name,
        key: project.key ?? undefined,
        color_code: project.color_code ?? DEFAULT_COLOR,
        client_id: project.client_id ?? undefined,
        category_id: project.category_id ?? undefined,
        status_id: project.status_id ?? undefined,
        health_id: project.health_id ?? undefined,
        folder_id: project.folder_id ?? undefined,
        dates,
        notes: project.notes ?? undefined,
      };
      form.setFieldsValue(values as Parameters<typeof form.setFieldsValue>[0]);
    } else {
      form.resetFields();
      form.setFieldsValue({ color_code: DEFAULT_COLOR });
    }
  }, [open, project, form]);

  const clientOptions = useMemo(
    () => (clients ?? []).map((c) => ({ value: c.id, label: c.name })),
    [clients],
  );
  const categoryOptions = useMemo(
    () => (categories ?? []).map((c) => ({ value: c.id, label: c.name })),
    [categories],
  );
  const statusOptions = useMemo(
    () => (statuses ?? []).map((s) => ({ value: s.id, label: s.name })),
    [statuses],
  );
  const healthOptions = useMemo(
    () => (healths ?? []).map((h) => ({ value: h.id, label: h.name })),
    [healths],
  );
  const folderOptions = useMemo(
    () => (folders ?? []).map((f) => ({ value: f.id, label: f.name })),
    [folders],
  );

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const color = toHex(values.color_code) ?? DEFAULT_COLOR;
    const [start, end] = values.dates ?? [null, null];

    // Fields that are NOT inputs to the create_project RPC — applied via an
    // update right after creation (or directly on edit).
    const extraFields = {
      key: values.key?.trim() || undefined,
      status_id: values.status_id ?? null,
      health_id: values.health_id ?? null,
      folder_id: values.folder_id ?? null,
      start_date: start ? start.toISOString() : null,
      end_date: end ? end.toISOString() : null,
      notes: values.notes?.trim() || null,
    };

    try {
      if (project) {
        await updateProject.mutateAsync({
          id: project.id,
          name: values.name.trim(),
          color_code: color,
          client_id: values.client_id ?? null,
          category_id: values.category_id ?? null,
          ...extraFields,
        });
        message.success("Project updated.");
      } else if (values.template_id) {
        // Start from a project template: it creates the phases/statuses/tasks;
        // then apply the form's meta (color/client/category) + extra fields.
        const newId = await createFromTemplate.mutateAsync({
          templateId: values.template_id,
          name: values.name.trim(),
        });
        if (newId) {
          await updateProject.mutateAsync({
            id: newId,
            color_code: color,
            client_id: values.client_id ?? null,
            category_id: values.category_id ?? null,
            ...extraFields,
          });
          // Apply the template's default views (if it specifies any).
          const tpl = (projectTemplates ?? []).find(
            (t) => t.id === values.template_id,
          );
          const views = (tpl?.template as { views?: string[] } | null)?.views;
          if (Array.isArray(views) && views.length > 0) {
            await applyTemplateViews.mutateAsync({
              projectId: newId,
              viewKeys: views,
            });
          }
        }
        message.success("Project created from template.");
        onClose();
        form.resetFields();
        if (newId) router.push(`/projects/${newId}`);
        return;
      } else {
        const newId = await createProject.mutateAsync({
          name: values.name.trim(),
          colorCode: color,
          clientId: values.client_id ?? null,
          categoryId: values.category_id ?? null,
        });
        // create_project only sets name/color/client/category + status default.
        // Apply the remaining fields with a follow-up update when any were set.
        const hasExtras =
          extraFields.key !== undefined ||
          extraFields.status_id !== null ||
          extraFields.health_id !== null ||
          extraFields.folder_id !== null ||
          extraFields.start_date !== null ||
          extraFields.end_date !== null ||
          extraFields.notes !== null;
        if (hasExtras && newId) {
          await updateProject.mutateAsync({ id: newId, ...extraFields });
        }
        message.success("Project created.");
      }
      onClose();
      form.resetFields();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to save project.",
      );
    }
  };

  const saving = createProject.isPending || updateProject.isPending;

  return (
    <Drawer
      title={isEditing ? "Edit project" : "Create project"}
      width={480}
      open={open}
      onClose={onClose}
      destroyOnHidden
      maskClosable={!saving}
      extra={
        <Space>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="primary" loading={saving} onClick={handleSubmit}>
            {isEditing ? "Save" : "Create"}
          </Button>
        </Space>
      }
    >
      <Form<ProjectFormValues>
        form={form}
        layout="vertical"
        requiredMark="optional"
      >
        <Form.Item
          label="Name"
          name="name"
          rules={[
            { required: true, message: "Please enter a project name." },
            { max: 100, message: "Name must be 100 characters or fewer." },
          ]}
        >
          <Input placeholder="Project name" autoFocus />
        </Form.Item>

        {!isEditing ? (
          <Form.Item
            label="Start from template"
            name="template_id"
            tooltip="Creates phases, statuses, and starter tasks from a project template"
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Blank project"
              options={(projectTemplates ?? []).map((t) => ({
                value: t.id,
                label: t.name,
              }))}
            />
          </Form.Item>
        ) : null}

        <Space size="middle" style={{ display: "flex" }} align="start">
          <Form.Item label="Key" name="key" tooltip="Optional short code">
            <Input placeholder="Auto" style={{ width: 120 }} />
          </Form.Item>
          <Form.Item label="Color" name="color_code">
            <ColorPicker format="hex" />
          </Form.Item>
        </Space>

        <Form.Item label="Client" name="client_id">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Select a client"
            loading={clientsLoading}
            options={clientOptions}
          />
        </Form.Item>

        <Form.Item label="Category" name="category_id">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Select a category"
            loading={categoriesLoading}
            options={categoryOptions}
          />
        </Form.Item>

        <Space
          size="middle"
          wrap
          style={{ display: "flex", width: "100%" }}
          align="start"
        >
          <Form.Item label="Status" name="status_id" style={{ flex: 1 }}>
            <Select
              allowClear
              placeholder="Status"
              loading={statusesLoading}
              options={statusOptions}
              style={{ minWidth: 180 }}
            />
          </Form.Item>
          <Form.Item label="Health" name="health_id" style={{ flex: 1 }}>
            <Select
              allowClear
              placeholder="Health"
              loading={healthsLoading}
              options={healthOptions}
              style={{ minWidth: 180 }}
            />
          </Form.Item>
        </Space>

        <Form.Item label="Start / End dates" name="dates">
          <DatePicker.RangePicker
            allowEmpty={[true, true]}
            style={{ width: "100%" }}
          />
        </Form.Item>

        <Form.Item label="Folder" name="folder_id">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="No folder"
            loading={foldersLoading}
            options={folderOptions}
          />
        </Form.Item>

        <Form.Item
          label="Notes"
          name="notes"
          rules={[
            { max: 500, message: "Notes must be 500 characters or fewer." },
          ]}
        >
          <Input.TextArea rows={3} placeholder="Optional notes" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
