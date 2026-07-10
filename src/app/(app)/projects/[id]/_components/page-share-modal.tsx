"use client";

import { useMemo, useState } from "react";
import { App, Modal, Radio, Typography, theme } from "antd";
import { MemberSelect } from "@/features/team-members/member-select";
import { useProjectMembers } from "@/features/projects/use-project-members";
import {
  usePageShares,
  useSetPageShares,
  useUpdatePage,
  type Page,
} from "@/features/app-docs/use-docs";

const { Text, Paragraph } = Typography;

function MIcon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1 }}>
      {name}
    </span>
  );
}

/**
 * Per-page sharing: choose "Shared" (whole project) or "Private", and when
 * private, grant specific members access. The author and project admins always
 * have access and are not listed. Backed by app_docs_page_shares (admin/author
 * only) + the page's is_private flag.
 */
export function PageShareModal({
  projectId,
  page,
  open,
  onClose,
}: {
  projectId: string;
  page: Page | null;
  open: boolean;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { data: members } = useProjectMembers(projectId);
  const { data: shares } = usePageShares(open && page ? page.id : undefined);
  const setShares = useSetPageShares();
  const updatePage = useUpdatePage();

  const [isPrivate, setIsPrivate] = useState(false);
  const [ids, setIds] = useState<string[]>([]);

  // Seed once per open, after the current share list has loaded.
  const seedKey = open && page && shares !== undefined ? page.id : null;
  const [seededKey, setSeededKey] = useState<string | null>(null);
  if (seedKey && seededKey !== seedKey) {
    setSeededKey(seedKey);
    setIsPrivate(Boolean(page?.is_private));
    setIds(shares ?? []);
  }
  if (!open && seededKey !== null) setSeededKey(null);

  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .map((m) => m.team_member?.user)
        .filter(
          (u): u is { id: string; name: string; email: string; avatar_url: string | null } =>
            Boolean(u) && u!.id !== page?.created_by,
        )
        .map((u) => ({
          value: u.id,
          label: u.name,
          avatarUrl: u.avatar_url,
          email: u.email,
        })),
    [members, page?.created_by],
  );

  const save = async () => {
    if (!page) return;
    try {
      if (isPrivate !== page.is_private) {
        await updatePage.mutateAsync({
          id: page.id,
          docId: page.doc_id,
          is_private: isPrivate,
        });
      }
      if (isPrivate) {
        await setShares.mutateAsync({
          pageId: page.id,
          userIds: ids,
          existing: shares ?? [],
        });
      }
      message.success("Sharing updated.");
      onClose();
    } catch {
      message.error("Only the page's author or a project admin can change sharing.");
    }
  };

  return (
    <Modal
      title="Share page"
      open={open}
      onCancel={onClose}
      okText="Done"
      confirmLoading={updatePage.isPending || setShares.isPending}
      onOk={() => void save()}
      destroyOnHidden
    >
      <Radio.Group
        value={isPrivate ? "private" : "shared"}
        onChange={(e) => setIsPrivate(e.target.value === "private")}
        style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}
      >
        <Radio value="shared">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <MIcon name="group" />
            <span>
              <b>Shared</b>{" "}
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                — everyone in the project
              </Text>
            </span>
          </span>
        </Radio>
        <Radio value="private">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <MIcon name="lock" />
            <span>
              <b>Private</b>{" "}
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                — only you, project admins, and people you pick
              </Text>
            </span>
          </span>
        </Radio>
      </Radio.Group>

      {isPrivate ? (
        <div style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 12.5, color: token.colorTextSecondary }}>
            Shared with
          </Text>
          <MemberSelect
            value={ids}
            onChange={setIds}
            options={memberOptions}
            placeholder="Add people who can see this page…"
            style={{ marginTop: 6 }}
          />
          <Paragraph type="secondary" style={{ fontSize: 12, margin: "8px 0 0" }}>
            You and project admins always have access.
          </Paragraph>
        </div>
      ) : null}
    </Modal>
  );
}
