"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Form, Input, Typography, App } from "antd";
import { useAuth } from "@/features/auth/use-auth";
import { AuthHeading, AUTH_DARK_BUTTON } from "../_components/auth-heading";

const { Text } = Typography;

interface LoginValues {
  email: string;
  password: string;
}

export default function LoginPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const { signIn } = useAuth();

  const [submitting, setSubmitting] = useState(false);

  const onFinish = async (values: LoginValues) => {
    setSubmitting(true);
    const { error } = await signIn(values.email, values.password);
    setSubmitting(false);
    if (error) {
      message.error(error);
      return;
    }
    message.success("Signed in.");
    router.replace("/home");
  };

  return (
    <>
      <AuthHeading
        title="Welcome back"
        subtitle="Access your tasks, projects and client work anytime, anywhere — and keep everything flowing in one place."
      />

      <Form<LoginValues>
        layout="vertical"
        requiredMark={false}
        onFinish={onFinish}
        disabled={submitting}
      >
        <Form.Item
          label="Your email"
          name="email"
          rules={[
            { required: true, message: "Please enter your email." },
            { type: "email", message: "Please enter a valid email." },
          ]}
          style={{ marginBottom: 16 }}
        >
          <Input
            size="large"
            placeholder="name@cubes.im"
            type="email"
            autoComplete="email"
          />
        </Form.Item>

        <Form.Item
          label="Password"
          name="password"
          rules={[{ required: true, message: "Please enter your password." }]}
          style={{ marginBottom: 10 }}
        >
          <Input.Password
            size="large"
            placeholder="••••••••••••"
            autoComplete="current-password"
          />
        </Form.Item>

        <div style={{ textAlign: "right", marginBottom: 22 }}>
          <Link href="/forgot-password" style={{ fontSize: 13, color: "#8b90a0" }}>
            Forgot password?
          </Link>
        </div>

        <Button
          type="primary"
          htmlType="submit"
          block
          size="large"
          loading={submitting}
          style={AUTH_DARK_BUTTON}
        >
          Sign in
        </Button>
      </Form>

      <div style={{ textAlign: "center", marginTop: 26, fontSize: 13.5 }}>
        <Text type="secondary" style={{ fontSize: 13.5 }}>
          Don&apos;t have an account?{" "}
        </Text>
        <Link href="/signup" style={{ fontWeight: 600, color: "#4f5bd5" }}>
          Register
        </Link>
      </div>
    </>
  );
}
