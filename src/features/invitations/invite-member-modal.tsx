"use client";

import { useEffect } from "react";
import { App, Form, Input, Modal, Select, theme } from "antd";
import {
  useInvitations,
  useInviteMember,
  type EmailInvitation,
} from "./use-invitations";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { MEMBER_TYPES } from "@/features/permissions/use-permissions";

interface InviteFormValues {
  name: string;
  email: string;
  member_type?: string;
}

/** Matches a plain single-address email, used to guess whether the search query
 *  the picker handed us is an email (prefill Email) or a name (prefill Name). */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface InviteMemberModalProps {
  open: boolean;
  onClose: () => void;
  /** The picker's current search text — prefills name or email. */
  initialQuery?: string;
  /** Fired after the invitation is created. */
  onInvited?: (invitation: EmailInvitation) => void;
}

/**
 * Reusable "invite a new member" dialog, opened from a member picker when the
 * person you want isn't on the team yet. Creates an email invitation (admin-only
 * via RLS); the invitee becomes assignable once they accept, so this does not —
 * and cannot — add them to the current selection immediately.
 */
export function InviteMemberModal({
  open,
  onClose,
  initialQuery,
  onInvited,
}: InviteMemberModalProps) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [form] = Form.useForm<InviteFormValues>();
  const inviteMember = useInviteMember();
  const { data: teamMembers } = useTeamMembers();
  const { data: invitations } = useInvitations();

  useEffect(() => {
    if (open) {
      const q = (initialQuery ?? "").trim();
      const isEmail = EMAIL_RE.test(q);
      form.setFieldsValue({
        name: isEmail ? "" : q,
        email: isEmail ? q : "",
        member_type: "member",
      });
    }
  }, [open, initialQuery, form]);

  const close = () => {
    form.resetFields();
    onClose();
  };

  const handleSubmit = async () => {
    // validateFields rejects on invalid input (the field errors render inline);
    // bail here so the rejection isn't left unhandled.
    let values: InviteFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const email = values.email.trim();

    // Already on the team? Don't create an inert invitation with a misleading
    // "assignable once they accept" toast — they're assignable right now.
    const existing = (teamMembers ?? []).find(
      (m) => m.user?.email?.toLowerCase() === email.toLowerCase(),
    );
    if (existing) {
      message.info(
        `${existing.user?.name ?? email} is already on the team — you can assign them directly.`,
      );
      return;
    }
    // Already invited? Skip the duplicate row.
    const pending = (invitations ?? []).find(
      (i) => i.email.toLowerCase() === email.toLowerCase(),
    );
    if (pending) {
      message.info(`${email} already has a pending invitation.`);
      return;
    }

    try {
      const invitation = await inviteMember.mutateAsync({
        email,
        name: values.name.trim(),
        memberType: values.member_type ?? "member",
      });
      message.success(
        `Invitation sent to ${email}. They'll be assignable once they accept.`,
      );
      onInvited?.(invitation);
      close();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to send invitation.",
      );
    }
  };

  return (
    <Modal
      title="Invite a new member"
      open={open}
      onOk={handleSubmit}
      confirmLoading={inviteMember.isPending}
      okText="Send invitation"
      onCancel={close}
      destroyOnHidden
    >
      <Form<InviteFormValues> form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          label="Name"
          name="name"
          rules={[{ required: true, message: "Please enter a name." }]}
        >
          <Input placeholder="Full name" autoFocus />
        </Form.Item>
        <Form.Item
          label="Email"
          name="email"
          rules={[
            { required: true, message: "Please enter an email." },
            { type: "email", message: "Please enter a valid email." },
          ]}
        >
          <Input placeholder="person@example.com" type="email" />
        </Form.Item>
        <Form.Item label="Role" name="member_type" initialValue="member">
          <Select
            options={MEMBER_TYPES.filter((t) => t.value !== "owner").map((t) => ({
              value: t.value,
              label: t.label,
              desc: t.hint,
              icon: t.icon,
              tone: t.tone,
            }))}
            optionRender={(opt) => (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "3px 0" }}>
                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 18, color: opt.data.tone, marginTop: 1 }}>
                  {opt.data.icon}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: token.colorText }}>{opt.data.label}</div>
                  <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{opt.data.desc}</div>
                </div>
              </div>
            )}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
