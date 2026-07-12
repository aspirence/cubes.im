"use client";

import { useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Divider,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  MinusCircleOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";

import {
  useTaskTemplates,
  useProjectTemplates,
  useCreateTaskTemplate,
  useUpdateTaskTemplate,
  useDeleteTaskTemplate,
  useDeleteProjectTemplate,
  useCreateProjectFromTemplate,
} from "@/features/templates/use-templates";
import { ProjectTemplateBuilderModal } from "@/features/templates/project-template-builder-modal";
import {
  useStatusTemplates,
  useCreateStatusTemplate,
  useUpdateStatusTemplate,
  useDeleteStatusTemplate,
  readStatusTemplateStatuses,
  type StatusTemplate,
  type StatusTemplateStatus,
} from "@/features/templates/use-status-templates";
import { useIsTeamAdmin } from "@/features/team-members/use-team-members";
import { useApplyTemplateViews } from "@/features/projects/use-project-views";
import type { Database } from "@/types/database";

/* -------------------------------------------------------------------------- */
/* JSONB shapes (authored to match the DB contract; the columns are `Json`).  */
/* -------------------------------------------------------------------------- */

type TaskTemplateRow = Database["public"]["Tables"]["task_templates"]["Row"] & {
  deliverable_type?: string | null;
};
type ProjectTemplateRow =
  Database["public"]["Tables"]["project_templates"]["Row"];

interface TemplateTask {
  name: string;
  priority?: string;
  description?: string;
}

interface TemplateStep {
  name: string;
  priority?: string;
}

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const { Title, Text } = Typography;

/** Best-effort parse of a JSONB `tasks` array into the editor's shape. */
function readTemplateTasks(value: unknown): TemplateTask[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .map((t) => ({
      name: typeof t.name === "string" ? t.name : "",
      priority: typeof t.priority === "string" ? t.priority : undefined,
      description:
        typeof t.description === "string" ? t.description : undefined,
    }));
}

/** Best-effort parse of a JSONB `steps` array (subtask steps). */
function readTemplateSteps(value: unknown): TemplateStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .map((t) => ({
      name: typeof t.name === "string" ? t.name : "",
      priority: typeof t.priority === "string" ? t.priority : undefined,
    }));
}

/* -------------------------------------------------------------------------- */

export default function TemplatesSettingsPage() {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <TaskTemplatesSection />
      <ProjectTemplatesSection />
      <StatusTemplatesSection />
    </Space>
  );
}

/* -------------------------------------------------------------------------- */
/* Task templates                                                             */
/* -------------------------------------------------------------------------- */

interface TaskTemplateFormValues {
  name: string;
  description?: string;
  priority?: string;
  deliverableType?: string;
  steps: TemplateStep[];
  tasks: TemplateTask[];
}

function TaskTemplatesSection() {
  const { message } = App.useApp();
  const { data: templates, isLoading } = useTaskTemplates();
  const createTemplate = useCreateTaskTemplate();
  const updateTemplate = useUpdateTaskTemplate();
  const deleteTemplate = useDeleteTaskTemplate();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TaskTemplateRow | null>(null);
  const [form] = Form.useForm<TaskTemplateFormValues>();

  useEffect(() => {
    if (modalOpen) {
      form.setFieldsValue({
        name: editing?.name ?? "",
        description: editing?.description ?? "",
        priority: editing?.priority ?? undefined,
        deliverableType: editing?.deliverable_type ?? undefined,
        steps: editing ? readTemplateSteps(editing.steps) : [{ name: "" }],
        tasks: editing ? readTemplateTasks(editing.tasks) : [],
      });
    }
  }, [modalOpen, editing, form]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (record: TaskTemplateRow) => {
    setEditing(record);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    form.resetFields();
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const tasks: TemplateTask[] = (values.tasks ?? [])
      .map((t) => {
        const name = (t.name ?? "").trim();
        const out: TemplateTask = { name };
        if (t.priority) out.priority = t.priority;
        const description = (t.description ?? "").trim();
        if (description) out.description = description;
        return out;
      })
      .filter((t) => t.name.length > 0);

    const steps: TemplateStep[] = (values.steps ?? [])
      .map((s) => {
        const name = (s.name ?? "").trim();
        const out: TemplateStep = { name };
        if (s.priority) out.priority = s.priority;
        return out;
      })
      .filter((s) => s.name.length > 0);

    const payload = {
      name: values.name.trim(),
      description: (values.description ?? "").trim() || undefined,
      priority: values.priority || undefined,
      deliverableType: values.deliverableType ?? null,
      steps,
      tasks,
    };
    try {
      if (editing) {
        await updateTemplate.mutateAsync({ id: editing.id, ...payload });
        message.success("Task template updated.");
      } else {
        await createTemplate.mutateAsync(payload);
        message.success("Task template created.");
      }
      closeModal();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to save template.",
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTemplate.mutateAsync(id);
      message.success("Task template deleted.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to delete template.",
      );
    }
  };

  const columns: ColumnsType<TaskTemplateRow> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: "Steps",
      key: "steps",
      width: 90,
      render: (_, record) => readTemplateSteps(record.steps).length,
    },
    {
      title: "Actions",
      key: "actions",
      width: 120,
      align: "right",
      render: (_, record) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
            aria-label="Edit task template"
          />
          <Popconfirm
            title="Delete this template?"
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label="Delete task template"
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Task templates
          </Title>
          <Text type="secondary">
            Task blueprints — prefill fields + subtask steps, picked when creating
            a task. (The bulk list still applies to a project.)
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add template
        </Button>
      </div>

      <Table<TaskTemplateRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={templates ?? []}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />

      <Modal
        title={editing ? "Edit task template" : "Add task template"}
        open={modalOpen}
        onOk={handleSubmit}
        confirmLoading={createTemplate.isPending || updateTemplate.isPending}
        okText={editing ? "Save" : "Create"}
        onCancel={closeModal}
        destroyOnHidden
        width={640}
      >
        <Form<TaskTemplateFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: "Please enter a name." }]}
          >
            <Input placeholder="e.g. Bug report" autoFocus />
          </Form.Item>
          <Form.Item label="Task description (prefills the new task)" name="description">
            <Input.TextArea
              placeholder="Optional — prefills the created task's description"
              rows={2}
              maxLength={2000}
            />
          </Form.Item>
          <Form.Item label="Default priority" name="priority">
            <Select
              allowClear
              placeholder="None"
              options={PRIORITY_OPTIONS}
              style={{ maxWidth: 200 }}
            />
          </Form.Item>
          <Form.Item
            label="Deliverable"
            name="deliverableType"
            tooltip="Tasks created from this template get this deliverable — e.g. a Video review deliverable."
          >
            <Select
              allowClear
              placeholder="None"
              style={{ maxWidth: 200 }}
              options={[
                { value: "video", label: "🎬 Video review" },
                { value: "text", label: "📝 Text" },
              ]}
            />
          </Form.Item>

          <Divider style={{ margin: "8px 0 12px" }}>Subtask steps</Divider>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Each step becomes a subtask when a task is created from this template.
          </Text>
          <Form.List name="steps">
            {(fields, { add, remove }) => (
              <div style={{ marginTop: 10 }}>
                {fields.map((field) => (
                  <Space
                    key={field.key}
                    align="baseline"
                    style={{ display: "flex", marginBottom: 8, flexWrap: "wrap" }}
                  >
                    <Form.Item
                      name={[field.name, "name"]}
                      style={{ marginBottom: 0, flex: 1 }}
                      rules={[{ required: true, message: "Step name required." }]}
                    >
                      <Input placeholder="Subtask step" style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "priority"]}
                      style={{ marginBottom: 0 }}
                    >
                      <Select
                        placeholder="Priority"
                        allowClear
                        options={PRIORITY_OPTIONS}
                        style={{ width: 130 }}
                      />
                    </Form.Item>
                    <MinusCircleOutlined
                      onClick={() => remove(field.name)}
                      aria-label="Remove step"
                    />
                  </Space>
                ))}
                <Button
                  type="dashed"
                  onClick={() => add({ name: "" })}
                  icon={<PlusOutlined />}
                  block
                >
                  Add step
                </Button>
              </div>
            )}
          </Form.List>

          <Divider style={{ margin: "16px 0 12px" }}>
            Bulk tasks (apply-to-project)
          </Divider>

          <Form.List name="tasks">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space
                    key={field.key}
                    align="baseline"
                    style={{ display: "flex", marginBottom: 8, flexWrap: "wrap" }}
                  >
                    <Form.Item
                      name={[field.name, "name"]}
                      style={{ marginBottom: 0, flex: 1 }}
                      rules={[
                        { required: true, message: "Task name required." },
                      ]}
                    >
                      <Input placeholder="Task name" style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "priority"]}
                      style={{ marginBottom: 0 }}
                    >
                      <Select
                        placeholder="Priority"
                        allowClear
                        options={PRIORITY_OPTIONS}
                        style={{ width: 130 }}
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
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Project templates                                                          */
/* -------------------------------------------------------------------------- */

function ProjectTemplatesSection() {
  const { message } = App.useApp();
  const router = useRouter();

  const { data: templates, isLoading } = useProjectTemplates();
  const deleteTemplate = useDeleteProjectTemplate();
  const createProject = useCreateProjectFromTemplate();
  const applyTemplateViews = useApplyTemplateViews();

  const [modalOpen, setModalOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createTarget, setCreateTarget] = useState<ProjectTemplateRow | null>(
    null,
  );
  const [projectName, setProjectName] = useState("");

  const handleDelete = async (id: string) => {
    try {
      await deleteTemplate.mutateAsync(id);
      message.success("Project template deleted.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to delete template.",
      );
    }
  };

  const openCreateProject = (record: ProjectTemplateRow) => {
    setCreateTarget(record);
    setProjectName(record.name);
    setCreateOpen(true);
  };

  const closeCreateProject = () => {
    setCreateOpen(false);
    setCreateTarget(null);
    setProjectName("");
  };

  const handleCreateProject = async () => {
    if (!createTarget) return;
    const name = projectName.trim();
    if (!name) {
      message.error("Please enter a project name.");
      return;
    }
    try {
      const projectId = await createProject.mutateAsync({
        templateId: createTarget.id,
        name,
      });
      // Apply the template's Default views — the RPC only builds phases/statuses/
      // tasks, so without this the project would fall back to the seeded List+Board
      // (this "Create project" surface previously dropped the template's views).
      const views = (createTarget.template as { views?: string[] } | null)
        ?.views;
      if (projectId && Array.isArray(views) && views.length > 0) {
        await applyTemplateViews.mutateAsync({ projectId, viewKeys: views });
      }
      message.success("Project created from template.");
      closeCreateProject();
      if (projectId) router.push(`/projects/${projectId}`);
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to create project.",
      );
    }
  };

  const columns: ColumnsType<ProjectTemplateRow> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: "Actions",
      key: "actions",
      width: 240,
      align: "right",
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<RocketOutlined />}
            onClick={() => openCreateProject(record)}
          >
            Create project
          </Button>
          <Popconfirm
            title="Delete this template?"
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label="Delete project template"
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Project templates
          </Title>
          <Text type="secondary">
            Blueprints with phases, statuses, and starter tasks for new
            projects.
          </Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
        >
          Add template
        </Button>
      </div>

      <Table<ProjectTemplateRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={templates ?? []}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No project templates yet"
            />
          ),
        }}
      />

      {/* Create project template (shared builder) ------------------- */}
      <ProjectTemplateBuilderModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />

      {/* Create project from template ----------------------------------- */}
      <Modal
        title="Create project from template"
        open={createOpen}
        onOk={handleCreateProject}
        confirmLoading={createProject.isPending}
        okText="Create project"
        onCancel={closeCreateProject}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {createTarget ? (
            <Text type="secondary">
              Based on <Tag>{createTarget.name}</Tag>
            </Text>
          ) : null}
          <div>
            <Text>Project name</Text>
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onPressEnter={handleCreateProject}
              placeholder="New project name"
              style={{ marginTop: 4 }}
              autoFocus
            />
          </div>
        </Space>
      </Modal>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Status templates                                                           */
/* -------------------------------------------------------------------------- */

const STATUS_TPL_CATEGORY_OPTIONS = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "Doing" },
  { value: "done", label: "Done" },
];

const STATUS_TPL_CATEGORY_COLOR: Record<string, string | undefined> = {
  todo: undefined,
  doing: "processing",
  done: "success",
};

interface StatusTemplateFormValues {
  name: string;
  statuses: StatusTemplateStatus[];
}

function StatusTemplatesSection() {
  const { message } = App.useApp();
  const isAdmin = useIsTeamAdmin();

  const { data: templates, isLoading } = useStatusTemplates();
  const createTemplate = useCreateStatusTemplate();
  const updateTemplate = useUpdateStatusTemplate();
  const deleteTemplate = useDeleteStatusTemplate();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StatusTemplate | null>(null);
  const [form] = Form.useForm<StatusTemplateFormValues>();

  useEffect(() => {
    if (modalOpen) {
      form.setFieldsValue({
        name: editing?.name ?? "",
        statuses: editing
          ? readStatusTemplateStatuses(editing.statuses)
          : [{ name: "", category: "todo" }],
      });
    }
  }, [modalOpen, editing, form]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (record: StatusTemplate) => {
    setEditing(record);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    // validateFields rejects on invalid input (errors render inline) — bail so
    // the rejection isn't left unhandled.
    let values: StatusTemplateFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const statuses = (values.statuses ?? [])
      .map((s) => ({
        name: (s.name ?? "").trim(),
        category: s.category ?? "todo",
      }))
      .filter((s) => s.name.length > 0);
    if (statuses.length === 0) {
      message.warning("Add at least one status.");
      return;
    }
    try {
      if (editing) {
        await updateTemplate.mutateAsync({
          id: editing.id,
          name: values.name.trim(),
          statuses,
        });
        message.success("Status template updated.");
      } else {
        await createTemplate.mutateAsync({
          name: values.name.trim(),
          statuses,
        });
        message.success("Status template created.");
      }
      closeModal();
    } catch (err) {
      message.error(
        err instanceof Error && err.message === "forbidden"
          ? "Only team admins can manage status templates."
          : err instanceof Error
            ? err.message
            : "Failed to save status template.",
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTemplate.mutateAsync(id);
      message.success("Status template deleted.");
    } catch (err) {
      message.error(
        err instanceof Error && err.message === "forbidden"
          ? "Only team admins can manage status templates."
          : err instanceof Error
            ? err.message
            : "Failed to delete status template.",
      );
    }
  };

  const columns: ColumnsType<StatusTemplate> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: "Statuses",
      key: "statuses",
      render: (_, record) => {
        const statuses = readStatusTemplateStatuses(record.statuses);
        return (
          <Space size={4} wrap>
            {statuses.map((s, i) => (
              <Tag
                key={`${s.name}-${i}`}
                color={STATUS_TPL_CATEGORY_COLOR[s.category]}
                style={{ marginInlineEnd: 0 }}
              >
                {s.name}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: "Actions",
      key: "actions",
      width: 140,
      align: "right",
      render: (_, record) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            disabled={!isAdmin}
            onClick={() => openEdit(record)}
            aria-label="Edit status template"
          />
          <Popconfirm
            title="Delete this status template?"
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record.id)}
            disabled={!isAdmin}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              disabled={!isAdmin}
              aria-label="Delete status template"
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Status templates
          </Title>
          <Text type="secondary">
            Reusable status sets (managed by admins) — pick one in the project
            template builder to prefill its statuses.
          </Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!isAdmin}
          onClick={openCreate}
        >
          Add status template
        </Button>
      </div>

      <Table<StatusTemplate>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={templates ?? []}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No status templates yet"
            />
          ),
        }}
      />

      {/* Create/edit status template ------------------------------------ */}
      <Modal
        title={editing ? "Edit status template" : "Add status template"}
        open={modalOpen}
        onOk={handleSubmit}
        confirmLoading={createTemplate.isPending || updateTemplate.isPending}
        okText={editing ? "Save" : "Create"}
        onCancel={closeModal}
        destroyOnHidden
        width={560}
      >
        <Form<StatusTemplateFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: "Please enter a name." }]}
          >
            <Input placeholder='e.g. "Software Dev", "Sales Pipeline"' autoFocus />
          </Form.Item>

          <Divider style={{ margin: "8px 0 12px" }}>Statuses</Divider>
          <Form.List name="statuses">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space
                    key={field.key}
                    align="baseline"
                    style={{ display: "flex", marginBottom: 8, flexWrap: "wrap" }}
                  >
                    <Form.Item
                      name={[field.name, "name"]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="Status name" style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "category"]}
                      style={{ marginBottom: 0 }}
                    >
                      <Select
                        options={STATUS_TPL_CATEGORY_OPTIONS}
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
                  onClick={() => add({ name: "", category: "todo" })}
                  icon={<PlusOutlined />}
                  block
                >
                  Add status
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </Card>
  );
}
