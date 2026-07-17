"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  theme,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { jsPDF } from "jspdf";
import { useUserOrg } from "@/features/admin/use-admin";
import {
  buildGeneratedDocumentFileName,
  formatHrDocumentType,
  HR_DOCUMENT_TYPE_OPTIONS,
  renderLetterDocument,
} from "@/features/hr/letters";
import { useHrAccess, useHrEmployees } from "@/features/hr/use-hr";
import { initials } from "../_lib/labels";
import {
  useCreateLetterTemplate,
  useDeleteGeneratedDocument,
  useDeleteLetterTemplate,
  useGenerateDocument,
  useGeneratedDocuments,
  useInstallDefaultLetterTemplates,
  useLetterTemplates,
  useUpdateLetterTemplate,
  type HrGeneratedDocumentWithEmployee,
  type HrLetterDocumentType,
  type HrLetterTemplateRow,
} from "@/features/hr/use-letters";

const { Title, Text } = Typography;

type TemplateFormValues = {
  name: string;
  document_type: HrLetterDocumentType;
  title_template: string;
  body_template: string;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
};

type PreviewState = {
  title: string;
  documentType: string;
  createdAt: string;
  employeeName: string;
  mergedText: string;
  mergedHtml: string;
  fileName: string;
};

type HrDocumentsWorkspaceProps = {
  title?: string;
  description?: string;
  selectedEmployeeId?: string;
  hideEmployeeSelector?: boolean;
  defaultDocumentType?: HrLetterDocumentType;
};

function MIcon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/** Glyph + tint per document type — drives template/document identity chips. */
const DOC_TYPE_META: Record<string, { icon: string; tint: string }> = {
  offer_letter: { icon: "mail", tint: "#4a4ad0" },
  appointment_letter: { icon: "badge", tint: "#0b7285" },
  experience_letter: { icon: "workspace_premium", tint: "#2b8a3e" },
  relieving_letter: { icon: "waving_hand", tint: "#d9480f" },
  salary_certificate: { icon: "payments", tint: "#5f3dc4" },
  nda: { icon: "lock", tint: "#862e9c" },
  internship_letter: { icon: "school", tint: "#1c7ed6" },
  warning_letter: { icon: "warning", tint: "#c0453c" },
  custom: { icon: "description", tint: "#6a6d78" },
};

function docTypeMeta(type: string | null | undefined) {
  return DOC_TYPE_META[type ?? "custom"] ?? DOC_TYPE_META.custom;
}

function errorMessage(error: unknown, fallback: string): string {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (/forbidden|permission|policy|not allowed|rls/i.test(msg)) {
    return "HR admins only.";
  }
  return msg || fallback;
}

function downloadGeneratedDocumentPdf(
  title: string,
  employeeName: string,
  companyName: string,
  documentType: string,
  content: string,
  fileName: string,
) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const lineHeight = 16;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensurePage = (neededHeight: number) => {
    if (y + neededHeight <= pageHeight - margin) return;
    doc.addPage();
    y = margin;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, margin, y);
  y += 24;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(companyName || "Cubes", margin, y);
  y += 16;
  doc.text(`Employee: ${employeeName}`, margin, y);
  y += 16;
  doc.text(`Type: ${formatHrDocumentType(documentType)}`, margin, y);
  y += 20;

  doc.setDrawColor(215);
  doc.line(margin, y, pageWidth - margin, y);
  y += 24;

  for (const block of content.split(/\n{2,}/)) {
    const lines = doc.splitTextToSize(block, maxWidth);
    ensurePage(lines.length * lineHeight + 16);
    for (const line of lines) {
      doc.text(line, margin, y);
      y += lineHeight;
    }
    y += 8;
  }

  doc.save(fileName);
}

function TemplateEditor({
  open,
  template,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  template: HrLetterTemplateRow | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: TemplateFormValues) => Promise<void>;
}) {
  const [form] = Form.useForm<TemplateFormValues>();

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(
      template
        ? {
            name: template.name,
            document_type: template.document_type as HrLetterDocumentType,
            title_template: template.title_template,
            body_template: template.body_template,
            is_active: template.is_active,
            is_default: template.is_default,
            sort_order: template.sort_order,
          }
        : {
            name: "",
            document_type: "offer_letter",
            title_template: "",
            body_template: "",
            is_active: true,
            is_default: false,
            sort_order: 100,
          },
    );
  }, [form, open, template]);

  return (
    <Drawer
      title={template ? "Edit template" : "New template"}
      width={720}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="primary"
            loading={submitting}
            onClick={async () => {
              const values = await form.validateFields();
              await onSubmit(values);
            }}
          >
            Save
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Template tokens"
        description="{{employee.full_name}}, {{designation.title}}, {{department.name}}, {{manager.full_name}}, {{employee.date_of_joining}}, {{employee.work_location}}, {{generated.date_long}}, {{org.name}}"
      />
      <Form<TemplateFormValues>
        layout="vertical"
        requiredMark={false}
        form={form}
      >
        <Row gutter={16}>
          <Col xs={24} md={14}>
            <Form.Item
              name="name"
              label="Template name"
              rules={[{ required: true, message: "Enter a template name" }]}
            >
              <Input placeholder="Default offer letter" />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item
              name="document_type"
              label="Document type"
              rules={[{ required: true, message: "Select a document type" }]}
            >
              <Select options={HR_DOCUMENT_TYPE_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="title_template"
          label="Document title"
          rules={[{ required: true, message: "Enter a document title template" }]}
        >
          <Input placeholder="Offer letter - {{employee.full_name}}" />
        </Form.Item>

        <Form.Item
          name="body_template"
          label="Body template"
          rules={[{ required: true, message: "Enter a body template" }]}
        >
          <Input.TextArea
            rows={14}
            placeholder="Dear {{employee.full_name}}, ..."
          />
        </Form.Item>

        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="sort_order" label="Sort order">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="is_active" label="Active" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="is_default" label="Starter" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Drawer>
  );
}

function PreviewDrawer({
  preview,
  companyName,
  onClose,
}: {
  preview: PreviewState | null;
  companyName: string;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  return (
    <Drawer
      title={preview?.title ?? "Preview"}
      width={760}
      open={Boolean(preview)}
      onClose={onClose}
      destroyOnHidden
      extra={
        preview ? (
          <Button
            icon={<DownloadOutlined />}
            onClick={() =>
              downloadGeneratedDocumentPdf(
                preview.title,
                preview.employeeName,
                companyName,
                preview.documentType,
                preview.mergedText,
                preview.fileName,
              )
            }
          >
            Download PDF
          </Button>
        ) : null
      }
    >
      {preview ? (
        <div>
          <Space size={[8, 8]} wrap style={{ marginBottom: 16 }}>
            <Tag color="blue">{formatHrDocumentType(preview.documentType)}</Tag>
            <Tag>{preview.employeeName}</Tag>
            <Tag>{dayjs(preview.createdAt).format("MMM D, YYYY h:mm A")}</Tag>
          </Space>
          <div
            style={{
              background: token.colorBgContainer,
              border: `1px solid ${token.colorSplit}`,
              borderRadius: 12,
              padding: 20,
              lineHeight: 1.7,
            }}
            dangerouslySetInnerHTML={{ __html: preview.mergedHtml }}
          />
        </div>
      ) : null}
    </Drawer>
  );
}

export function HrDocumentsWorkspace({
  title = "Documents & letters",
  description = "Build reusable templates, generate employee letters, and export PDF documents from one place.",
  selectedEmployeeId,
  hideEmployeeSelector = false,
  defaultDocumentType,
}: HrDocumentsWorkspaceProps) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const { isHrAdmin, isLoading: accessLoading } = useHrAccess();
  const { data: userOrg } = useUserOrg();
  const { data: employees, isLoading: employeesLoading } = useHrEmployees();
  const [localEmployeeId, setLocalEmployeeId] = useState<string | undefined>(
    selectedEmployeeId,
  );
  const [documentType, setDocumentType] = useState<
    HrLetterDocumentType | undefined
  >(defaultDocumentType);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<HrLetterTemplateRow | null>(
    null,
  );
  const [preview, setPreview] = useState<PreviewState | null>(null);

  // Keep the local pick in step with the host page's selection while our own
  // selector is hidden, so un-hiding it later starts from the right employee.
  // Render-time sync (not an effect): setState-in-effect double-renders.
  const [syncedSel, setSyncedSel] = useState(selectedEmployeeId);
  if (hideEmployeeSelector && syncedSel !== selectedEmployeeId) {
    setSyncedSel(selectedEmployeeId);
    setLocalEmployeeId(selectedEmployeeId);
  }

  const effectiveEmployeeId = hideEmployeeSelector
    ? selectedEmployeeId
    : localEmployeeId;
  const employeeList = useMemo(() => employees ?? [], [employees]);

  const selectedEmployee = useMemo(() => {
    const base = employeeList.find(
      (employee) => employee.id === effectiveEmployeeId,
    );
    if (!base) return null;
    const managerName = employeeList.find(
      (employee) => employee.id === base.manager_id,
    )?.full_name;
    return {
      ...base,
      manager: base.manager
        ? base.manager
        : base.manager_id && managerName
          ? { id: base.manager_id, full_name: managerName }
          : null,
    };
  }, [effectiveEmployeeId, employeeList]);

  const employeeOptions = useMemo(
    () =>
      employeeList.map((employee) => ({
        value: employee.id,
        label: employee.full_name,
      })),
    [employeeList],
  );

  const {
    data: templates,
    isLoading: templatesLoading,
    isError: templatesError,
    error: templatesErrorValue,
  } = useLetterTemplates(documentType, isHrAdmin);
  const {
    data: generatedDocuments,
    isLoading: documentsLoading,
  } = useGeneratedDocuments({
    employeeId: effectiveEmployeeId,
    documentType,
    enabled: isHrAdmin,
  });

  const createTemplate = useCreateLetterTemplate();
  const updateTemplate = useUpdateLetterTemplate();
  const deleteTemplate = useDeleteLetterTemplate();
  const installDefaults = useInstallDefaultLetterTemplates();
  const generateDocument = useGenerateDocument();
  const deleteGeneratedDocument = useDeleteGeneratedDocument();

  const openNewTemplate = () => {
    setEditingTemplate(null);
    setEditorOpen(true);
  };

  const handleTemplateSubmit = async (values: TemplateFormValues) => {
    try {
      if (editingTemplate) {
        await updateTemplate.mutateAsync({
          id: editingTemplate.id,
          patch: values,
        });
        message.success("Template updated.");
      } else {
        await createTemplate.mutateAsync(values);
        message.success("Template created.");
      }
      setEditorOpen(false);
      setEditingTemplate(null);
    } catch (error) {
      message.error(errorMessage(error, "Failed to save template."));
    }
  };

  const handleGenerate = async (template: HrLetterTemplateRow) => {
    if (!selectedEmployee) {
      message.warning("Select an employee first.");
      return;
    }
    try {
      const rendered = renderLetterDocument(
        template,
        selectedEmployee,
        userOrg?.org.organization_name ?? "",
      );
      const document = await generateDocument.mutateAsync({
        template,
        employee: selectedEmployee,
        organizationName: userOrg?.org.organization_name ?? "",
      });
      message.success("Document generated.");
      setPreview({
        title: document.title,
        documentType: document.document_type,
        createdAt: document.created_at,
        employeeName: selectedEmployee.full_name,
        mergedText: document.merged_text,
        mergedHtml: document.merged_html || rendered.mergedHtml,
        fileName: buildGeneratedDocumentFileName(document),
      });
    } catch (error) {
      message.error(errorMessage(error, "Failed to generate document."));
    }
  };

  const openGeneratedPreview = (document: HrGeneratedDocumentWithEmployee) => {
    setPreview({
      title: document.title,
      documentType: document.document_type,
      createdAt: document.created_at,
      employeeName: document.employee?.full_name ?? "Employee",
      mergedText: document.merged_text,
      mergedHtml: document.merged_html,
      fileName: buildGeneratedDocumentFileName(document),
    });
  };

  const companyName = userOrg?.org.organization_name ?? "Cubes";

  if (accessLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
        <Spin />
      </div>
    );
  }

  if (!isHrAdmin) {
    return (
      <Alert
        type="warning"
        showIcon
        message="HR admins only"
        description="Document templates and letter generation are available after HR admin access is granted."
      />
    );
  }

  return (
    <>
      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          <div>
            <Title level={4} style={{ margin: 0 }}>
              {title}
            </Title>
            <Text type="secondary">{description}</Text>
          </div>
          <Space wrap>
            {!hideEmployeeSelector ? (
              <Select
                allowClear
                showSearch
                placeholder="Select an employee"
                style={{ minWidth: 260 }}
                loading={employeesLoading}
                value={effectiveEmployeeId}
                options={employeeOptions}
                onChange={(value) => setLocalEmployeeId(value)}
                optionFilterProp="label"
              />
            ) : null}
            <Select
              allowClear
              placeholder="All document types"
              style={{ minWidth: 220 }}
              value={documentType}
              options={HR_DOCUMENT_TYPE_OPTIONS}
              onChange={(value) => setDocumentType(value)}
            />
            <Button icon={<PlusOutlined />} onClick={openNewTemplate}>
              New template
            </Button>
          </Space>
        </div>

        {selectedEmployee ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              padding: "12px 14px",
              marginBottom: 20,
              borderRadius: 12,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorFillQuaternary,
            }}
          >
            <span
              style={{
                width: 42,
                height: 42,
                borderRadius: 999,
                flex: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontWeight: 700,
                color: "#4a4ad0",
                background: token.colorPrimaryBg,
              }}
            >
              {initials(selectedEmployee.full_name)}
            </span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: token.colorText }}>
                {selectedEmployee.full_name}
              </div>
              <div style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
                {[selectedEmployee.designation?.title, selectedEmployee.department?.name]
                  .filter(Boolean)
                  .join(" · ") || "—"}
                {" · "}letters merge their profile, manager and org details automatically
              </div>
            </div>
            {selectedEmployee.date_of_joining ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 12.5,
                  color: token.colorTextSecondary,
                }}
              >
                <MIcon name="calendar_month" size={15} color={token.colorTextTertiary} />
                Joined {dayjs(selectedEmployee.date_of_joining).format("MMM D, YYYY")}
              </span>
            ) : null}
          </div>
        ) : (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 20 }}
            message="Select an employee to generate letters"
            description={
              hideEmployeeSelector
                ? "Use the employee selector above to generate offer letters, contracts, and onboarding documents."
                : "Templates can be managed without an employee selection, but generation requires one active employee context."
            }
          />
        )}

        {/* Template library + generated documents only make sense inside an
            employee context — without one, generation is impossible and the
            panels would just be dead chrome. */}
        {effectiveEmployeeId ? (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={11}>
            <Card
              title="Template library"
              extra={
                <Space>
                  <Button
                    onClick={async () => {
                      try {
                        await installDefaults.mutateAsync();
                        message.success("Starter templates installed.");
                      } catch (error) {
                        message.error(
                          errorMessage(error, "Failed to install starter templates."),
                        );
                      }
                    }}
                    loading={installDefaults.isPending}
                  >
                    Install starter templates
                  </Button>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={openNewTemplate}
                  >
                    Add template
                  </Button>
                </Space>
              }
            >
              {templatesError ? (
                <Alert
                  type="error"
                  showIcon
                  message="Failed to load templates"
                  description={errorMessage(templatesErrorValue, "Please try again.")}
                />
              ) : (
                <List<HrLetterTemplateRow>
                  loading={templatesLoading}
                  dataSource={templates ?? []}
                  locale={{
                    emptyText: (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="No templates yet"
                      >
                        <Space>
                          <Button
                            onClick={async () => {
                              try {
                                await installDefaults.mutateAsync();
                                message.success("Starter templates installed.");
                              } catch (error) {
                                message.error(
                                  errorMessage(
                                    error,
                                    "Failed to install starter templates.",
                                  ),
                                );
                              }
                            }}
                            loading={installDefaults.isPending}
                          >
                            Install starter templates
                          </Button>
                          <Button type="primary" onClick={openNewTemplate}>
                            Create custom template
                          </Button>
                        </Space>
                      </Empty>
                    ),
                  }}
                  renderItem={(template) => (
                    <List.Item
                      actions={[
                        <Button
                          key="generate"
                          type="primary"
                          icon={<FileTextOutlined />}
                          onClick={() => handleGenerate(template)}
                          loading={
                            generateDocument.isPending &&
                            generateDocument.variables?.template.id === template.id
                          }
                          disabled={!selectedEmployee}
                        >
                          Generate
                        </Button>,
                        <Button
                          key="edit"
                          icon={<EditOutlined />}
                          onClick={() => {
                            setEditingTemplate(template);
                            setEditorOpen(true);
                          }}
                        >
                          Edit
                        </Button>,
                        <Popconfirm
                          key="delete"
                          title="Delete this template?"
                          okText="Delete"
                          okButtonProps={{ danger: true }}
                          onConfirm={async () => {
                            try {
                              await deleteTemplate.mutateAsync(template.id);
                              message.success("Template deleted.");
                            } catch (error) {
                              message.error(
                                errorMessage(error, "Failed to delete template."),
                              );
                            }
                          }}
                        >
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            loading={
                              deleteTemplate.isPending &&
                              deleteTemplate.variables === template.id
                            }
                          />
                        </Popconfirm>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={
                          <span
                            style={{
                              width: 38,
                              height: 38,
                              borderRadius: 11,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: `color-mix(in srgb, ${docTypeMeta(template.document_type).tint} 11%, transparent)`,
                            }}
                          >
                            <MIcon
                              name={docTypeMeta(template.document_type).icon}
                              size={19}
                              color={docTypeMeta(template.document_type).tint}
                            />
                          </span>
                        }
                        title={
                          <Space size={[8, 8]} wrap>
                            <span style={{ fontWeight: 600 }}>{template.name}</span>
                            <Tag
                              style={{ margin: 0 }}
                              color={template.is_default ? "geekblue" : undefined}
                            >
                              {formatHrDocumentType(template.document_type)}
                            </Tag>
                            {!template.is_active ? <Tag style={{ margin: 0 }}>Inactive</Tag> : null}
                          </Space>
                        }
                        description={
                          <div>
                            <div style={{ marginBottom: 6, fontSize: 12.5 }}>
                              {template.title_template}
                            </div>
                            {/* The template body reads as a document — set it on
                                paper, not as a grey blob of UI text. */}
                            <div
                              style={{
                                padding: "8px 11px",
                                borderRadius: 9,
                                background: token.colorFillQuaternary,
                                border: `1px solid ${token.colorSplit}`,
                                fontSize: 12,
                                lineHeight: 1.55,
                                color: token.colorTextTertiary,
                                display: "-webkit-box",
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}
                            >
                              {template.body_template.slice(0, 260)}
                              {template.body_template.length > 260 ? "…" : ""}
                            </div>
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>

          <Col xs={24} xl={13}>
            <Card
              title="Generated documents"
              extra={
                <Text type="secondary">
                  {generatedDocuments?.length ?? 0} item
                  {(generatedDocuments?.length ?? 0) === 1 ? "" : "s"}
                </Text>
              }
            >
              <List<HrGeneratedDocumentWithEmployee>
                loading={documentsLoading}
                dataSource={generatedDocuments ?? []}
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="No documents generated yet"
                    />
                  ),
                }}
                renderItem={(document) => (
                  <List.Item
                    actions={[
                      <Button
                        key="preview"
                        icon={<EyeOutlined />}
                        onClick={() => openGeneratedPreview(document)}
                      >
                        Preview
                      </Button>,
                      <Button
                        key="download"
                        icon={<DownloadOutlined />}
                        onClick={() =>
                          downloadGeneratedDocumentPdf(
                            document.title,
                            document.employee?.full_name ?? "Employee",
                            companyName,
                            document.document_type,
                            document.merged_text,
                            buildGeneratedDocumentFileName(document),
                          )
                        }
                      >
                        PDF
                      </Button>,
                      <Popconfirm
                        key="delete"
                        title="Delete this generated document?"
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onConfirm={async () => {
                          try {
                            await deleteGeneratedDocument.mutateAsync(document.id);
                            message.success("Generated document deleted.");
                            if (preview?.title === document.title) setPreview(null);
                          } catch (error) {
                            message.error(
                              errorMessage(error, "Failed to delete document."),
                            );
                          }
                        }}
                      >
                        <Button
                          danger
                          icon={<DeleteOutlined />}
                          loading={
                            deleteGeneratedDocument.isPending &&
                            deleteGeneratedDocument.variables === document.id
                          }
                        />
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={
                        <span
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 11,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: `color-mix(in srgb, ${docTypeMeta(document.document_type).tint} 11%, transparent)`,
                          }}
                        >
                          <MIcon
                            name={docTypeMeta(document.document_type).icon}
                            size={19}
                            color={docTypeMeta(document.document_type).tint}
                          />
                        </span>
                      }
                      title={
                        <Space size={[8, 8]} wrap>
                          <span style={{ fontWeight: 600 }}>{document.title}</span>
                          <Tag style={{ margin: 0 }} color="geekblue">
                            {formatHrDocumentType(document.document_type)}
                          </Tag>
                          {document.status === "generated" ? (
                            <Tag style={{ margin: 0 }} color="green">
                              Ready
                            </Tag>
                          ) : (
                            <Tag style={{ margin: 0 }}>{document.status}</Tag>
                          )}
                        </Space>
                      }
                      description={
                        <Space size={[6, 4]} wrap style={{ fontSize: 12.5 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: token.colorTextSecondary }}>
                            <MIcon name="person" size={14} color={token.colorTextTertiary} />
                            {document.employee?.full_name ?? "Employee"}
                          </span>
                          <Divider type="vertical" style={{ margin: 0 }} />
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: token.colorTextTertiary }}>
                            <MIcon name="schedule" size={14} color={token.colorTextQuaternary} />
                            {dayjs(document.created_at).format("MMM D, YYYY h:mm A")}
                          </span>
                          <Divider type="vertical" style={{ margin: 0 }} />
                          <span style={{ color: token.colorTextTertiary }}>
                            from {document.template_name}
                          </span>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>
        ) : null}
      </Card>

      <TemplateEditor
        open={editorOpen}
        template={editingTemplate}
        submitting={createTemplate.isPending || updateTemplate.isPending}
        onClose={() => {
          setEditorOpen(false);
          setEditingTemplate(null);
        }}
        onSubmit={handleTemplateSubmit}
      />
      <PreviewDrawer
        preview={preview}
        companyName={companyName}
        onClose={() => setPreview(null)}
      />
    </>
  );
}

