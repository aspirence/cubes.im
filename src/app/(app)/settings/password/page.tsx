"use client";

import { App, Button, Card, Form, Input, Typography } from "antd";
import { useUpdatePassword } from "@/features/profile/use-profile";

interface PasswordValues {
  password: string;
  confirm: string;
}

export default function PasswordSettingsPage() {
  const { message } = App.useApp();
  const updatePassword = useUpdatePassword();
  const [form] = Form.useForm<PasswordValues>();

  const onFinish = async (values: PasswordValues) => {
    try {
      await updatePassword.mutateAsync({ password: values.password });
      message.success("Password updated.");
      form.resetFields();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update password.",
      );
    }
  };

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Password
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Set a new password for your account.
      </Typography.Paragraph>

      <Form<PasswordValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={onFinish}
        style={{ maxWidth: 480 }}
      >
        <Form.Item
          label="New password"
          name="password"
          rules={[
            { required: true, message: "Please enter a new password." },
            { min: 6, message: "Password must be at least 6 characters." },
          ]}
          hasFeedback
        >
          <Input.Password
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.Item
          label="Confirm new password"
          name="confirm"
          dependencies={["password"]}
          hasFeedback
          rules={[
            { required: true, message: "Please confirm your password." },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("password") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(
                  new Error("The two passwords do not match."),
                );
              },
            }),
          ]}
        >
          <Input.Password
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={updatePassword.isPending}
          >
            Update password
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}
