"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Form, Input, Result, Typography, App } from "antd";
import { useAuth } from "@/features/auth/use-auth";
import { AuthHeading, AUTH_DARK_BUTTON } from "../_components/auth-heading";

const { Text } = Typography;

interface SignupValues {
  name: string;
  email: string;
  password: string;
}

export default function SignupPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const { signUp } = useAuth();

  const [submitting, setSubmitting] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);

  const onFinish = async (values: SignupValues) => {
    setSubmitting(true);
    const { error, needsEmailConfirmation } = await signUp({
      name: values.name.trim(),
      email: values.email,
      password: values.password,
    });
    setSubmitting(false);

    if (error) {
      message.error(error);
      return;
    }

    if (needsEmailConfirmation) {
      // Email confirmation is enabled: show a "check your email" state.
      setConfirmEmail(values.email);
      return;
    }

    // Dev / confirmation disabled: user is signed in immediately.
    message.success("Account created.");
    router.replace("/home");
  };

  if (confirmEmail) {
    return (
      <Result
        status="success"
        title="Check your email"
        subTitle={
          <>
            We sent a confirmation link to <strong>{confirmEmail}</strong>.
            Click it to activate your account, then sign in.
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
      <AuthHeading
        title="Create an account"
        subtitle="Access your tasks, projects and client work anytime, anywhere — and keep everything flowing in one place."
      />

      <Form<SignupValues>
        layout="vertical"
        requiredMark={false}
        onFinish={onFinish}
        disabled={submitting}
      >
        <Form.Item
          label="Full name"
          name="name"
          rules={[{ required: true, message: "Please enter your name." }]}
        >
          <Input placeholder="Jane Doe" autoComplete="name" />
        </Form.Item>

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

        <Form.Item
          label="Password"
          name="password"
          rules={[
            { required: true, message: "Please enter a password." },
            { min: 6, message: "Password must be at least 6 characters." },
          ]}
        >
          <Input.Password
            placeholder="At least 6 characters"
            autoComplete="new-password"
          />
        </Form.Item>

        <Button
          type="primary"
          htmlType="submit"
          block
          size="large"
          loading={submitting}
          style={{ ...AUTH_DARK_BUTTON, marginTop: 8 }}
        >
          Create account
        </Button>
      </Form>

      <div style={{ textAlign: "center", marginTop: 14 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          By signing up you agree to the <Link href="/terms">Terms of Service</Link>{" "}
          and <Link href="/privacy">Privacy Policy</Link>.
        </Text>
      </div>

      <div style={{ textAlign: "center", marginTop: 16, fontSize: 13.5 }}>
        <Text type="secondary" style={{ fontSize: 13.5 }}>
          Already have an account?{" "}
        </Text>
        <Link href="/login" style={{ fontWeight: 600, color: "#4f5bd5" }}>
          Sign in
        </Link>
      </div>
    </>
  );
}
