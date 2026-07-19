"use client";

import { useEffect } from "react";
import {
  App,
  Button,
  Divider,
  Form,
  Input,
  Modal,
  Select,
  Space,
} from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import {
  useCreateProjectTemplate,
  type ProjectTemplate,
  type ProjectTemplateDocument,
} from "@/features/templates/use-templates";
import {
  useStatusTemplates,
  readStatusTemplateStatuses,
} from "@/features/templates/use-status-templates";
import { ADDABLE_VIEWS } from "@/lib/projects/views";

const DEFAULT_PHASE_COLOR = "#3b7ddd";

const STATUS_CATEGORY_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

interface PhaseField {
  name: string;
  color: string;
}
interface StatusField {
  name: string;
  category: string;
}
interface TaskField {
  name: string;
  status?: string;
  priority?: string;
}

interface ProjectTemplateFormValues {
  name: string;
  views?: string[];
  phases: PhaseField[];
  statuses: StatusField[];
  tasks: TaskField[];
}

export interface ProjectTemplateBuilderModalProps {
  open: boolean;
  onClose: () => void;
  /** Fired after a template is created, with the freshly-inserted row. */
  onCreated?: (template: ProjectTemplate) => void;
}

/**
 * Reusable "Add project template" builder: name + Default views + phases,
 * statuses, and starter tasks, persisted as a project template's JSONB document.
 * Used both in Settings → Templates and inline from the New-project modal so
 * there is a single source of truth for authoring a project template.
 */
export function ProjectTemplateBuilderModal({
  open,
  onClose,
  onCreated,
}: ProjectTemplateBuilderModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ProjectTemplateFormValues>();
  const createTemplate = useCreateProjectTemplate();
  const { data: statusTemplates } = useStatusTemplates();

  /** Prefills the Statuses list from a status template (copies the values —
   *  no live link; clearing the picker doesn't touch already-filled rows). */
  const applyStatusTemplate = (id: string | undefined) => {
    if (!id) return;
    const tpl = (statusTemplates ?? []).find((t) => t.id === id);
    if (!tpl) return;
    const statuses = readStatusTemplateStatuses(tpl.statuses);
    if (statuses.length === 0) return;
    form.setFieldsValue({ statuses });
  };

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        name: "",
        views: ["list", "board"],
        phases: [{ name: "", color: DEFAULT_PHASE_COLOR }],
        statuses: [{ name: "", category: "not_started" }],
        tasks: [{ name: "" }],
      });
    }
  }, [open, form]);

  const close = () => {
    form.resetFields();
    onClose();
  };

  const handleSubmit = async () => {
    // validateFields rejects on invalid input (the field errors render inline);
    // bail here so the rejection isn't left unhandled.
    let values: ProjectTemplateFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const template: ProjectTemplateDocument = {
      phases: (values.phases ?? [])
        .map((p) => ({
          name: (p.name ?? "").trim(),
          color: p.color ?? DEFAULT_PHASE_COLOR,
        }))
        .filter((p) => p.name.length > 0),
      statuses: (values.statuses ?? [])
        .map((s) => ({
          name: (s.name ?? "").trim(),
          category: s.category ?? "not_started",
        }))
        .filter((s) => s.name.length > 0),
      tasks: (values.tasks ?? [])
        .map((t) => ({
          name: (t.name ?? "").trim(),
          status: t.status ?? "",
          priority: t.priority ?? "",
        }))
        .filter((t) => t.name.length > 0),
      views: values.views ?? [],
    };

    try {
      const created = await createTemplate.mutateAsync({
        name: values.name.trim(),
        template,
      });
      message.success("Project template created.");
      onCreated?.(created);
      close();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to save template.",
      );
    }
  };

  return (
    <Modal
      title="Add project template"
      open={open}
      onOk={handleSubmit}
      confirmLoading={createTemplate.isPending}
      okText="Create"
      onCancel={close}
      destroyOnHidden
      width={720}
    >
      <Form<ProjectTemplateFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
      >
        <Form.Item
          label="Name"
          name="name"
          rules={[{ required: true, message: "Please enter a name." }]}
        >
          <Input placeholder="Template name" autoFocus />
        </Form.Item>

        <Form.Item
          label="Default views"
          name="views"
          tooltip="Views added to a project created from this template"
        >
          <Select
            mode="multiple"
            allowClear
            placeholder="e.g. List, Board, Calendar"
            options={ADDABLE_VIEWS.filter((v) => v.available).map((v) => ({
              value: v.key,
              label: v.title,
            }))}
          />
        </Form.Item>

        <Divider style={{ margin: "8px 0 12px" }}>Phases</Divider>
        <Form.List name="phases">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Space
                  key={field.key}
                  align="baseline"
                  style={{ display: "flex", marginBottom: 8 }}
                >
                  <Form.Item
                    name={[field.name, "name"]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder="Phase name" style={{ width: 280 }} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "color"]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input
                      type="color"
                      style={{ width: 48, padding: 2 }}
                      aria-label="Phase color"
                    />
                  </Form.Item>
                  <MinusCircleOutlined
                    onClick={() => remove(field.name)}
                    aria-label="Remove phase"
                  />
                </Space>
              ))}
              <Button
                type="dashed"
                onClick={() => add({ name: "", color: DEFAULT_PHASE_COLOR })}
                icon={<PlusOutlined />}
                block
              >
                Add phase
              </Button>
            </>
          )}
        </Form.List>

        <Divider style={{ margin: "16px 0 12px" }}>Statuses</Divider>
        {(statusTemplates ?? []).length > 0 ? (
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Start from a status template (optional)"
            style={{ width: "100%", marginBottom: 12 }}
            onChange={applyStatusTemplate}
            options={(statusTemplates ?? []).map((t) => ({
              value: t.id,
              label: `${t.name} · ${readStatusTemplateStatuses(t.statuses).length} statuses`,
            }))}
          />
        ) : null}
        <Form.List name="statuses">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Space
                  key={field.key}
                  align="baseline"
                  style={{ display: "flex", marginBottom: 8 }}
                >
                  <Form.Item
                    name={[field.name, "name"]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder="Status name" style={{ width: 280 }} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "category"]}
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      options={STATUS_CATEGORY_OPTIONS}
                      style={{ width: 130 }}
                      placeholder="Category"
                    />
                  </Form.Item>
                  <MinusCircleOutlined
                    onClick={() => remove(field.name)}
                    aria-label="Remove status"
                  />
                </Space>
              ))}
              <Button
                type="dashed"
                onClick={() => add({ name: "", category: "not_started" })}
                icon={<PlusOutlined />}
                block
              >
                Add status
              </Button>
            </>
          )}
        </Form.List>

        <Divider style={{ margin: "16px 0 12px" }}>Tasks</Divider>
        <Form.List name="tasks">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Space
                  key={field.key}
                  align="baseline"
                  style={{ display: "flex", marginBottom: 8 }}
                >
                  <Form.Item
                    name={[field.name, "name"]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder="Task name" style={{ width: 220 }} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "status"]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder="Status" style={{ width: 130 }} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "priority"]}
                    style={{ marginBottom: 0 }}
                  >
                    <Select
                      placeholder="Priority"
                      allowClear
                      options={PRIORITY_OPTIONS}
                      style={{ width: 120 }}
                    />
                  </Form.Item>
                  <MinusCircleOutlined
                    onClick={() => remove(field.name)}
                    aria-label="Remove task"
                  />
                </Space>
              ))}
              <Button
                type="dashed"
                onClick={() => add({ name: "" })}
                icon={<PlusOutlined />}
                block
              >
                Add task
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}
