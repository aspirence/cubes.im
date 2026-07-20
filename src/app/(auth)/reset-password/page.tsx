"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Form, Input, Typography, App } from "antd";
import { useAuth } from "@/features/auth/use-auth";

const { Title, Text } = Typography;

interface ResetValues {
  password: string;
  confirm: string;
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const { updatePassword, user, loading } = useAuth();

  const [submitting, setSubmitting] = useState(false);

  const onFinish = async (values: ResetValues) => {
    setSubmitting(true);
    const { error } = await updatePassword(values.password);
    setSubmitting(false);
    if (error) {
      message.error(error);
      return;
    }
    message.success("Password updated. Please sign in.");
    router.replace("/login");
  };

  // Setting a password needs the recovery session /auth/callback established.
  // Landing here without one means the link expired, was already used, or was
  // opened directly — say so instead of failing on submit with "session missing".
  if (!loading && !user) {
    return (
      <>
        <Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
          This reset link isn&apos;t valid
        </Title>
        <Text type="secondary" style={{ display: "block", marginBottom: 24 }}>
          It may have expired or already been used. Request a fresh one and open
          the newest email.
        </Text>
        <Button type="primary" block onClick={() => router.replace("/forgot-password")}>
          Send a new reset link
        </Button>
      </>
    );
  }

  return (
    <>
      <Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
        Choose a new password
      </Title>
      <Text type="secondary" style={{ display: "block", marginBottom: 24 }}>
        Enter a new password for your account.
      </Text>

      <Form<ResetValues>
        layout="vertical"
        requiredMark={false}
        onFinish={onFinish}
        disabled={submitting}
      >
        <Form.Item
          label="New password"
          name="password"
          rules={[
            { required: true, message: "Please enter a password." },
            { min: 6, message: "Password must be at least 6 characters." },
          ]}
          hasFeedback
        >
          <Input.Password
            placeholder="At least 6 characters"
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.Item
          label="Confirm password"
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
                return Promise.reject(new Error("Passwords do not match."));
              },
            }),
          ]}
        >
          <Input.Password
            placeholder="Re-enter password"
            autoComplete="new-password"
          />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={submitting}>
          Update password
        </Button>
      </Form>

      <div style={{ textAlign: "center", marginTop: 24 }}>
        <Link href="/login">Back to sign in</Link>
      </div>
    </>
  );
}
