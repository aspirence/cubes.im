"use client";

import { useState } from "react";
import {
  App,
  Button,
  Empty,
  List,
  Popconfirm,
  Space,
  Tag,
  Typography,
  Upload,
} from "antd";
import type { UploadProps } from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  FileOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import {
  useEmployeeDocuments,
  useUploadEmployeeDocument,
  useDeleteEmployeeDocument,
  getHrDocumentSignedUrl,
} from "@/features/hr/use-hr";
import type { HrDocumentRow } from "../../../_lib/types";

function errorMessage(error: unknown, fallback: string): string {
  const msg = error instanceof Error ? error.message : "";
  if (/forbidden|permission|not allowed|policy|rls/i.test(msg)) {
    return "HR admins only.";
  }
  return msg || fallback;
}

export function DocumentsTab({
  employeeId,
  canEdit,
}: {
  employeeId: string;
  canEdit: boolean;
}) {
  const { message } = App.useApp();
  const { data: documents, isLoading } = useEmployeeDocuments(employeeId);
  const uploadDoc = useUploadEmployeeDocument();
  const deleteDoc = useDeleteEmployeeDocument();

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const beforeUpload: NonNullable<UploadProps["beforeUpload"]> = (file) => {
    void (async () => {
      try {
        await uploadDoc.mutateAsync({ employeeId, file });
        message.success("Document uploaded.");
      } catch (err) {
        message.error(errorMessage(err, "Failed to upload document."));
      }
    })();
    // Prevent antd's default XHR upload — we handle it via the mutation.
    return Upload.LIST_IGNORE;
  };

  const handleDownload = async (doc: HrDocumentRow) => {
    setDownloadingId(doc.id);
    try {
      const url = await getHrDocumentSignedUrl(doc.storage_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      message.error(errorMessage(err, "Failed to generate download link."));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (doc: HrDocumentRow) => {
    try {
      await deleteDoc.mutateAsync(doc);
      message.success("Document deleted.");
    } catch (err) {
      message.error(errorMessage(err, "Failed to delete document."));
    }
  };

  return (
    <div>
      {canEdit ? (
        <div style={{ marginBottom: 16 }}>
          <Upload
            beforeUpload={beforeUpload}
            showUploadList={false}
            multiple={false}
          >
            <Button
              icon={<UploadOutlined />}
              type="primary"
              loading={uploadDoc.isPending}
            >
              Upload document
            </Button>
          </Upload>
        </div>
      ) : null}

      <List<HrDocumentRow>
        loading={isLoading}
        dataSource={documents ?? []}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No documents"
            />
          ),
        }}
        renderItem={(doc) => (
          <List.Item
            actions={[
              <Button
                key="download"
                type="text"
                icon={<DownloadOutlined />}
                loading={downloadingId === doc.id}
                onClick={() => handleDownload(doc)}
                aria-label="Download document"
              />,
              ...(canEdit
                ? [
                    <Popconfirm
                      key="delete"
                      title="Delete this document?"
                      okText="Delete"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => handleDelete(doc)}
                    >
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label="Delete document"
                      />
                    </Popconfirm>,
                  ]
                : []),
            ]}
          >
            <List.Item.Meta
              avatar={<FileOutlined style={{ fontSize: 20 }} />}
              title={
                <Space>
                  <Typography.Text>{doc.name}</Typography.Text>
                  {doc.doc_type ? <Tag>{doc.doc_type}</Tag> : null}
                </Space>
              }
              description={
                doc.created_at
                  ? `Added ${dayjs(doc.created_at).format("MMM D, YYYY")}`
                  : null
              }
            />
          </List.Item>
        )}
      />
    </div>
  );
}
