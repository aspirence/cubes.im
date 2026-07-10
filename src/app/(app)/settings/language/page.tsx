"use client";

import { useEffect, useState } from "react";
import { App, Button, Card, Form, Select, Typography } from "antd";
import { useAuth } from "@/features/auth/use-auth";
import { useUpdateLanguage } from "@/features/profile/use-profile";
import type { Database } from "@/types/database";

type LanguageType = Database["public"]["Enums"]["language_type"];

const LANGUAGE_OPTIONS: { value: LanguageType; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "alb", label: "Shqip (Albanian)" },
  { value: "de", label: "Deutsch" },
  { value: "zh_cn", label: "中文 (简体)" },
  { value: "ko", label: "한국어" },
];

interface LanguageValues {
  language: LanguageType;
}

export default function LanguageSettingsPage() {
  const { message } = App.useApp();
  const { profile } = useAuth();
  const updateLanguage = useUpdateLanguage();
  const [form] = Form.useForm<LanguageValues>();
  const [value, setValue] = useState<LanguageType>("en");

  useEffect(() => {
    const lang = (profile?.language ?? "en") as LanguageType;
    form.setFieldsValue({ language: lang });
    setValue(lang);
  }, [profile, form]);

  const onFinish = async (values: LanguageValues) => {
    try {
      await updateLanguage.mutateAsync(values.language);
      message.success("Language updated.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update language.",
      );
    }
  };

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Language &amp; Region
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Choose the language used across Cubes.
      </Typography.Paragraph>

      <Form<LanguageValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={onFinish}
        style={{ maxWidth: 360 }}
      >
        <Form.Item label="Language" name="language">
          <Select
            options={LANGUAGE_OPTIONS}
            value={value}
            onChange={(v) => setValue(v)}
          />
        </Form.Item>

        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={updateLanguage.isPending}
          >
            Save
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}
