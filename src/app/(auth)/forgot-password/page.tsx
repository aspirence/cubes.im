"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Form, Input, Result, Typography, App } from "antd";
import { useAuth } from "@/features/auth/use-auth";

const { Title, Text } = Typography;

interface ForgotValues {
  email: string;
}

export default function ForgotPasswordPage() {
  const { message } = App.useApp();
  const { resetPassword } = useAuth();

  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const onFinish = async (values: ForgotValues) => {
    setSubmitting(true);
    const { error } = await resetPassword(values.email);
    setSubmitting(false);
    if (error) {
      message.error(error);
      return;
    }
    setSentTo(values.email);
  };

  if (sentTo) {
    return (
      <Result
        status="success"
        title="Check your email"
        subTitle={
          <>
            If an account exists for <strong>{sentTo}</strong>, we sent a
            password reset link. Follow it to choose a new password.
          </>
        }
        extra={
          <Link href="/login">
            <Button type="primary">Back to sign in</Button>
          </Link>
        }
      />
    );
  }

  return (
    <>
      <Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>
        Reset your password
      </Title>
      <Text type="secondary" style={{ display: "block", marginBottom: 24 }}>
        Enter your email and we&apos;ll send you a reset link.
      </Text>

      <Form<ForgotValues>
        layout="vertical"
        requiredMark={false}
        onFinish={onFinish}
        disabled={submitting}
      >
        <Form.Item
          label="Email"
          name="email"
          rules={[
            { required: true, message: "Please enter your email." },
            { type: "email", message: "Please enter a valid email." },
          ]}
        >
          <Input placeholder="you@example.com" type="email" autoComplete="email" />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={submitting}>
          Send reset link
        </Button>
      </Form>

      <div style={{ textAlign: "center", marginTop: 24 }}>
        <Link href="/login">Back to sign in</Link>
      </div>
    </>
  );
}
