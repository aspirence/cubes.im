"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Input, Modal, Space, Typography } from "antd";
import { ExclamationCircleFilled } from "@ant-design/icons";
import { useAuth } from "@/features/auth/use-auth";

const CONFIRM_PHRASE = "DELETE";

export default function AccountSettingsPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const { signOut } = useAuth();

  const [modalOpen, setModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const closeModal = () => {
    if (deleting) return;
    setModalOpen(false);
    setConfirmText("");
  };

  const handleDelete = async () => {
    if (confirmText !== CONFIRM_PHRASE || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Failed to delete account.");
      }
      message.success("Your account has been deleted.");
      await signOut();
      router.replace("/login");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to delete account.",
      );
      setDeleting(false);
    }
  };

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Account
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Manage your account.
      </Typography.Paragraph>

      <Card
        size="small"
        style={{ borderColor: "#ffccc7", maxWidth: 560 }}
        styles={{ header: { borderColor: "#ffccc7" } }}
        title={
          <Space>
            <ExclamationCircleFilled style={{ color: "#cf1322" }} />
            <Typography.Text strong>Danger zone</Typography.Text>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Permanently delete your account and all associated data. This action
          cannot be undone.
        </Typography.Paragraph>
        <Button danger type="primary" onClick={() => setModalOpen(true)}>
          Delete account
        </Button>
      </Card>

      <Modal
        title="Delete account"
        open={modalOpen}
        onCancel={closeModal}
        okText="Delete account"
        okButtonProps={{
          danger: true,
          disabled: confirmText !== CONFIRM_PHRASE,
          loading: deleting,
        }}
        cancelButtonProps={{ disabled: deleting }}
        onOk={handleDelete}
        maskClosable={!deleting}
        closable={!deleting}
        destroyOnHidden
      >
        <Typography.Paragraph>
          This will permanently delete your account and all of your data. This
          action cannot be undone.
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          Type <Typography.Text strong>{CONFIRM_PHRASE}</Typography.Text> to
          confirm.
        </Typography.Paragraph>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
          disabled={deleting}
          onPressEnter={handleDelete}
          autoFocus
          aria-label="Type DELETE to confirm"
        />
      </Modal>
    </Card>
  );
}
