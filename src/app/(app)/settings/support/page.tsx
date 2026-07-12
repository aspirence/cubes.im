"use client";

import { useState } from "react";
import {
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  List,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { SendOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import {
  useSupportRequests,
  useCreateSupportRequest,
} from "@/features/support/use-support";

const { Title, Text } = Typography;

interface SupportFormValues {
  subject: string;
  message: string;
}

/**
 * A support-request row as rendered on this page. Mirrors the shape exported by
 * Agent A's `useSupportRequests` (a `support_requests` row). Typed structurally
 * so the page stays decoupled from the hook's exact export.
 */
interface SupportRequest {
  id: string;
  subject: string;
  message: string;
  status: string;
  created_at: string;
}

/** Map a request status to an antd Tag colour. */
function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "open":
      return "blue";
    case "in_progress":
    case "in progress":
      return "gold";
    case "resolved":
    case "closed":
      return "green";
    default:
      return "default";
  }
}

/** Humanise a status string (e.g. `in_progress` -> `In progress`). */
function statusLabel(status: string): string {
  const spaced = status.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export default function SupportSettingsPage() {
  const { message } = App.useApp();
  const { data: requestsRaw, isLoading } = useSupportRequests();
  const createRequest = useCreateSupportRequest();

  const [form] = Form.useForm<SupportFormValues>();

  const requests = (requestsRaw ?? []) as unknown as SupportRequest[];

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      await createRequest.mutateAsync({
        subject: values.subject.trim(),
        message: values.message.trim(),
      });
      message.success("Support request submitted.");
      form.resetFields();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to submit request.",
      );
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <div style={{ marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>
            Contact support
          </Title>
          <Text type="secondary">
            Send us a question or report an issue and we’ll get back to you.
          </Text>
        </div>

        <Form<SupportFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={handleSubmit}
        >
          <Form.Item
            label="Subject"
            name="subject"
            rules={[
              { required: true, message: "Please enter a subject." },
              { max: 120, message: "Subject must be 120 characters or fewer." },
            ]}
          >
            <Input placeholder="Brief summary of your request" />
          </Form.Item>

          <Form.Item
            label="Message"
            name="message"
            rules={[{ required: true, message: "Please enter a message." }]}
          >
            <Input.TextArea
              placeholder="Describe your question or issue in detail…"
              autoSize={{ minRows: 4, maxRows: 10 }}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SendOutlined />}
              loading={createRequest.isPending}
            >
              Submit request
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card>
        <Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
          Your requests
        </Title>

        {isLoading ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : requests.length > 0 ? (
          <List
            itemLayout="vertical"
            dataSource={requests}
            renderItem={(req) => (
              <List.Item key={req.id} style={{ paddingInline: 0 }}>
                <List.Item.Meta
                  title={
                    <Space size={8} wrap align="center">
                      <Text strong>{req.subject}</Text>
                      <Tag color={statusColor(req.status)}>
                        {statusLabel(req.status)}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(req.created_at).format("MMM D, YYYY h:mm A")}
                      </Text>
                    </Space>
                  }
                  description={
                    <Text
                      type="secondary"
                      style={{ whiteSpace: "pre-wrap", fontSize: 13 }}
                    >
                      {req.message}
                    </Text>
                  }
                />
              </List.Item>
            )}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="You haven’t submitted any requests yet"
            style={{ margin: "12px 0" }}
          />
        )}
      </Card>
    </Space>
  );
}
