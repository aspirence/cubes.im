"use client";

import { useMemo, useState } from "react";
import { App, Button, Input, Modal, Select, Tag, Typography } from "antd";
import { useTasks } from "@/features/tasks/use-tasks";
import { useTeamFiles, humanSize } from "@/features/app-files/use-files";
import { useProjectComments } from "@/features/projects/use-project-comments";
import { useTaskPriorities } from "@/features/tasks/use-task-statuses";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useUpdateTask } from "@/features/tasks/use-tasks";
import { richTextToPlain } from "@/features/editor/rich-text";
import { MIcon, useC } from "./ui";
import {
  useInviteClientContact,
  useAcceptClientRequest,
  useDeclineClientRequest,
  useRequestClientApproval,
  useShareWithClient,
  useShareableContentItems,
  useShareableSheets,
  nextApprovalVersion,
  portalSignInUrl,
  type ShareCandidate,
} from "./use-client-app";
import {
  ROLE_META,
  SHARE_KIND_META,
  contactDisplayName,
  isValidEmail,
  normalizeEmail,
  type ClientApprovalRow,
  type ClientApprovalSubject,
  type ClientContactRow,
  type ClientRequestRow,
  type ClientRole,
  type ClientShareKind,
  type ClientShareRow,
} from "./types";

const { Text } = Typography;
const { TextArea } = Input;

/* ───────────────────────────── invite ───────────────────────────── */

/**
 * Invite a client contact by email.
 *
 * The contact row and the project grant are written first and the email is
 * attempted second, on purpose: the invitation exists whether or not mail is
 * configured, and this modal says which of those happened. It never reports
 * "Invitation sent" on the strength of an HTTP 200 — the dispatcher answers
 * `skipped` when no sender is set up, and the agency would otherwise sit
 * waiting for a client who was never written to.
 */
export function InviteContactModal({
  open,
  onClose,
  projectId,
  clientId,
}: {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  clientId?: string | null;
}) {
  const C = useC();
  const { message } = App.useApp();
  const invite = useInviteClientContact();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<ClientRole>("approver");
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  /** The contact's own single-use sign-in link, when no email went out. */
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // Cleared on the way out rather than on the way in: an effect that resets
  // state when `open` flips is a cascading render, and this modal is always
  // mounted (AntD only destroys the body).
  const close = () => {
    setEmail("");
    setName("");
    setRole("approver");
    setLinkNotice(null);
    setInviteLink(null);
    onClose();
  };

  const submit = async () => {
    if (!isValidEmail(email)) {
      message.error("Enter a valid email address.");
      return;
    }
    try {
      const result = await invite.mutateAsync({
        email: normalizeEmail(email),
        name,
        role,
        clientId: clientId ?? null,
        projectId,
      });
      if (result.mail.status === "sent") {
        message.success(`Invitation emailed to ${normalizeEmail(email)}.`);
        close();
        return;
      }
      // Added, but nobody has been told — so the modal stays open with the
      // link, which is the only thing that gets the client in today.
      setInviteLink(result.mail.link ?? null);
      setLinkNotice(
        result.mail.reason ??
          "This workspace has no email sender configured, so nothing was sent.",
      );
      message.warning("Contact added, but no email went out.");
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "Could not add that contact.",
      );
    }
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      title="Invite a client contact"
      okText="Add and send link"
      onOk={submit}
      confirmLoading={invite.isPending}
      destroyOnHidden
    >
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        <div>
          <Text style={{ fontSize: 12.5, color: C.textSecondary }}>Email</Text>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="priya@brand.com"
            autoComplete="off"
          />
        </div>
        <div>
          <Text style={{ fontSize: 12.5, color: C.textSecondary }}>Name (optional)</Text>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya" />
        </div>
        <div>
          <Text style={{ fontSize: 12.5, color: C.textSecondary }}>Role</Text>
          <Select
            value={role}
            onChange={setRole}
            style={{ width: "100%" }}
            options={(Object.keys(ROLE_META) as ClientRole[]).map((key) => ({
              value: key,
              label: ROLE_META[key].label,
            }))}
          />
          <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 4 }}>
            {ROLE_META[role].blurb}
          </div>
        </div>
        {projectId ? (
          <div style={{ fontSize: 12, color: C.textTertiary }}>
            They get access to this project only. Nothing inside it is visible until you
            share it.
          </div>
        ) : (
          <div style={{ fontSize: 12, color: C.textTertiary }}>
            Added to the workspace. Open a project&apos;s Client tab to give them access
            to it.
          </div>
        )}
        {linkNotice ? (
          <div
            style={{
              background: `${C.gold}12`,
              border: `1px solid ${C.gold}33`,
              borderRadius: 10,
              padding: "10px 12px",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
              No email was sent
            </div>
            <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 3 }}>
              {linkNotice}{" "}
              {inviteLink
                ? "Send them this single-use link — it expires in 15 minutes:"
                : "Send them this address and they can request their own link:"}
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginTop: 8,
              }}
            >
              <Input readOnly value={inviteLink ?? portalSignInUrl()} size="small" />
              <Button
                size="small"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(inviteLink ?? portalSignInUrl())
                    .then(() => message.success("Link copied."))
                    .catch(() => message.error("Could not copy."));
                }}
              >
                Copy
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* ───────────────────────────── sharing ───────────────────────────── */

const SHARE_KIND_ORDER: ClientShareKind[] = ["task", "file", "sheet", "update"];

/**
 * Adds one item to what the client can see. One kind, one item, one click —
 * sharing a whole project is exactly the shortcut this screen refuses to offer.
 */
export function ShareItemModal({
  open,
  onClose,
  projectId,
  alreadyShared,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  alreadyShared: ClientShareRow[];
}) {
  const C = useC();
  const { message } = App.useApp();
  const share = useShareWithClient();
  const [kind, setKind] = useState<ClientShareKind>("task");
  const [refId, setRefId] = useState<string | undefined>();

  const { data: tasks } = useTasks(projectId);
  const { data: files } = useTeamFiles();
  const { data: comments } = useProjectComments(projectId);
  const sheets = useShareableSheets(projectId);

  const close = () => {
    setKind("task");
    setRefId(undefined);
    onClose();
  };

  const candidates: ShareCandidate[] = useMemo(() => {
    if (kind === "task") {
      return (tasks ?? []).map((task) => ({
        id: task.id,
        title: task.name,
        detail: task.status?.name ?? null,
      }));
    }
    if (kind === "file") {
      return (files ?? [])
        .filter((file) => file.project?.id === projectId || file.project == null)
        .map((file) => ({
          id: file.id,
          title: file.name,
          detail: humanSize(file.size_bytes),
        }));
    }
    if (kind === "update") {
      return (comments ?? []).map((comment) => ({
        id: comment.id,
        title: richTextToPlain(comment.content).slice(0, 90) || "Update",
        detail: comment.author?.name ?? null,
      }));
    }
    return sheets.data?.rows ?? [];
  }, [kind, tasks, files, comments, sheets.data, projectId]);

  const sharedIds = useMemo(
    () =>
      new Set(
        alreadyShared.filter((row) => row.kind === kind).map((row) => row.ref_id),
      ),
    [alreadyShared, kind],
  );

  const notReady = kind === "sheet" && sheets.data?.notReady;

  const chosenSheetSource =
    kind === "sheet" ? candidates.find((c) => c.id === refId)?.source ?? null : null;

  const submit = async () => {
    const chosen = candidates.find((c) => c.id === refId);
    if (!chosen) {
      message.error("Pick something to share.");
      return;
    }
    try {
      await share.mutateAsync({
        projectId,
        kind,
        refId: chosen.id,
        title: chosen.title.slice(0, 200),
      });
      message.success(`${SHARE_KIND_META[kind].label} shared with the client.`);
      close();
    } catch {
      message.error("Could not share that.");
    }
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      title="Share with the client"
      okText="Share"
      onOk={submit}
      confirmLoading={share.isPending}
      destroyOnHidden
    >
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {SHARE_KIND_ORDER.map((key) => {
            const meta = SHARE_KIND_META[key];
            const active = kind === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setKind(key);
                  setRefId(undefined);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 11px",
                  borderRadius: 999,
                  cursor: "pointer",
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: `1px solid ${active ? meta.tone : C.hair}`,
                  background: active ? `${meta.tone}14` : C.panel,
                  color: active ? meta.tone : C.textSecondary,
                }}
              >
                <MIcon name={meta.icon} size={14} color={active ? meta.tone : C.textTertiary} />
                {meta.plural}
              </button>
            );
          })}
        </div>

        {notReady ? (
          <div style={{ fontSize: 12.5, color: C.textTertiary }}>
            That app is not installed in this workspace yet, so there is nothing of this
            kind to share.
          </div>
        ) : (
          <Select
            showSearch
            value={refId}
            onChange={setRefId}
            style={{ width: "100%" }}
            placeholder={`Pick a ${SHARE_KIND_META[kind].label.toLowerCase()}`}
            optionFilterProp="label"
            options={candidates.map((candidate) => ({
              value: candidate.id,
              label: candidate.title,
              disabled: sharedIds.has(candidate.id),
            }))}
            notFoundContent="Nothing here yet"
          />
        )}

        {/* A sheet is the one kind whose row in the portal may or may not open.
            Saying which BEFORE it is shared beats a client asking why the link
            does nothing. */}
        {kind === "sheet" && chosenSheetSource ? (
          <div style={{ fontSize: 12.5, color: C.textTertiary }}>
            {chosenSheetSource === "custom"
              ? "The client can open this one and read it, column by column. They cannot edit it."
              : "This sheet is a live view of your own workspace data, so the client will see its name and nothing else. Send them an export instead."}
          </div>
        ) : null}

        <div style={{ fontSize: 12, color: C.textTertiary }}>
          Only what you add here is visible to the client. Everything else on this project
          stays internal.
        </div>
      </div>
    </Modal>
  );
}

/* ──────────────────────────── approvals ──────────────────────────── */

const APPROVAL_KINDS: { value: ClientApprovalSubject; label: string }[] = [
  { value: "task", label: "A task" },
  { value: "content_item", label: "A content item" },
  { value: "file", label: "A file" },
];

/** Asks the client to sign off on something, at a stated version. */
export function RequestApprovalModal({
  open,
  onClose,
  projectId,
  approvals,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  approvals: ClientApprovalRow[];
}) {
  const C = useC();
  const { message } = App.useApp();
  const request = useRequestClientApproval();
  const [subjectKind, setSubjectKind] = useState<ClientApprovalSubject>("content_item");
  const [subjectId, setSubjectId] = useState<string | undefined>();
  const [note, setNote] = useState("");

  const { data: tasks } = useTasks(projectId);
  const { data: files } = useTeamFiles();
  const contentItems = useShareableContentItems(projectId);

  const close = () => {
    setSubjectKind("content_item");
    setSubjectId(undefined);
    setNote("");
    onClose();
  };

  const candidates: ShareCandidate[] = useMemo(() => {
    if (subjectKind === "task") {
      return (tasks ?? []).map((task) => ({
        id: task.id,
        title: task.name,
        detail: task.status?.name ?? null,
      }));
    }
    if (subjectKind === "file") {
      return (files ?? [])
        .filter((file) => file.project?.id === projectId || file.project == null)
        .map((file) => ({ id: file.id, title: file.name, detail: humanSize(file.size_bytes) }));
    }
    return contentItems.data?.rows ?? [];
  }, [subjectKind, tasks, files, contentItems.data, projectId]);

  const chosen = candidates.find((c) => c.id === subjectId);
  const version = subjectId
    ? nextApprovalVersion(approvals, subjectKind, subjectId)
    : 1;

  const submit = async () => {
    if (!chosen) {
      message.error("Pick what needs approving.");
      return;
    }
    try {
      const result = await request.mutateAsync({
        projectId,
        subjectKind,
        subjectId: chosen.id,
        title: chosen.title.slice(0, 200),
        note: note.trim() || null,
      });
      // Per recipient, never rounded up: "asked" is only true for an address
      // the dispatcher actually wrote to.
      const sent = result.notified.filter((n) => n.status === "sent").length;
      if (result.notified.length === 0) {
        message.warning(
          "Recorded, but nobody was emailed — no contact on this project may approve yet.",
        );
      } else if (sent === 0) {
        message.warning("Recorded, but no email went out. Send them the portal link.");
      } else {
        message.success(`Sent for approval to ${sent} contact${sent === 1 ? "" : "s"}.`);
      }
      close();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "Could not send that for approval.",
      );
    }
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      title="Ask the client to approve"
      okText={`Send as v${version}`}
      onOk={submit}
      confirmLoading={request.isPending}
      destroyOnHidden
    >
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        <Select
          value={subjectKind}
          onChange={(value) => {
            setSubjectKind(value);
            setSubjectId(undefined);
          }}
          options={APPROVAL_KINDS}
          style={{ width: "100%" }}
        />
        {subjectKind === "content_item" && contentItems.data?.notReady ? (
          <div style={{ fontSize: 12.5, color: C.textTertiary }}>
            Content Studio is not installed in this workspace.
          </div>
        ) : (
          <Select
            showSearch
            value={subjectId}
            onChange={setSubjectId}
            optionFilterProp="label"
            placeholder="Pick the item"
            style={{ width: "100%" }}
            options={candidates.map((c) => ({ value: c.id, label: c.title }))}
            notFoundContent="Nothing here yet"
          />
        )}
        <div>
          <Text style={{ fontSize: 12.5, color: C.textSecondary }}>
            Note for the client (optional)
          </Text>
          <TextArea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="What changed since the last round?"
            maxLength={2000}
          />
        </div>
        {subjectId ? (
          <div style={{ fontSize: 12, color: C.textTertiary }}>
            This goes out as version {version}. Each round is its own version, so the
            record shows what was approved and when.
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* ────────────────────── accepting a request ────────────────────── */

/**
 * Accept → a real task on the board.
 *
 * The task is created by /api/client/requests/[id]/accept through the ordinary
 * `create_task` RPC, so the project's own task-creation rules apply — there is
 * no private door into the tasks table, and the client's own words are copied
 * into the description by that route.
 *
 * What this modal adds is the part a person decides: who picks it up, how
 * urgent it is, what to name the task if "Diwali offer??" is not it, and the
 * line the client reads back. The task NAME is changed after the fact rather
 * than by editing the request, because the request is the client's record of
 * what they asked for and the agency does not get to rewrite it.
 *
 * Accepting stays deliberate — that gate is what keeps "can we just…" from
 * becoming unbilled work.
 */
export function AcceptRequestModal({
  open,
  onClose,
  request,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  request: ClientRequestRow | null;
  contact: ClientContactRow | null;
}) {
  const C = useC();
  const { message } = App.useApp();
  const accept = useAcceptClientRequest();
  const updateTask = useUpdateTask();
  const { data: priorities } = useTaskPriorities();
  const { data: members } = useTeamMembers();

  // Seeded once, from the request this modal was opened for. The caller keys
  // this component by request id, so a different request remounts it rather
  // than needing an effect to re-seed the fields.
  const [title, setTitle] = useState(() => request?.title ?? "");
  const [reply, setReply] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [priorityId, setPriorityId] = useState<string | undefined>();

  const submit = async () => {
    if (!request) return;
    const taskName = title.trim();
    if (taskName.length < 3) {
      message.error("The task needs a name.");
      return;
    }
    try {
      const { taskId } = await accept.mutateAsync({
        id: request.id,
        projectId: request.project_id,
        priorityId: priorityId ?? null,
        assignees,
        note: reply.trim() || null,
      });
      if (taskName !== request.title) {
        try {
          await updateTask.mutateAsync({ id: taskId, name: taskName });
        } catch {
          // The task exists and the request is linked; only the rename failed.
          message.warning("Accepted, but the task kept the client's wording.");
        }
      }
      message.success("Accepted — it is on the board.");
      onClose();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "Could not accept that request.",
      );
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Accept request → create task"
      okText="Create task"
      onOk={submit}
      confirmLoading={accept.isPending}
      destroyOnHidden
    >
      <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
        {contact ? (
          <div style={{ fontSize: 12.5, color: C.textTertiary }}>
            Raised by {contactDisplayName(contact)} ({contact.email})
          </div>
        ) : null}
        <div>
          <Text style={{ fontSize: 12.5, color: C.textSecondary }}>Task name</Text>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>
        {request?.details ? (
          <div>
            <Text style={{ fontSize: 12.5, color: C.textSecondary }}>
              What they asked for (copied into the task)
            </Text>
            <div
              style={{
                fontSize: 13,
                color: C.text,
                background: C.panelSoft,
                border: `1px solid ${C.hair}`,
                borderRadius: 10,
                padding: "9px 11px",
                whiteSpace: "pre-wrap",
                maxHeight: 160,
                overflowY: "auto",
              }}
            >
              {request.details}
            </div>
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <Text style={{ fontSize: 12.5, color: C.textSecondary }}>Assign to</Text>
            <Select
              mode="multiple"
              value={assignees}
              onChange={setAssignees}
              style={{ width: "100%" }}
              placeholder="Nobody yet"
              optionFilterProp="label"
              options={(members ?? [])
                .filter((m) => m.user != null)
                .map((m) => ({
                  value: m.id,
                  label: m.user?.name ?? m.user?.email ?? "Member",
                }))}
            />
          </div>
          <div>
            <Text style={{ fontSize: 12.5, color: C.textSecondary }}>Priority</Text>
            <Select
              value={priorityId}
              onChange={setPriorityId}
              allowClear
              style={{ width: "100%" }}
              placeholder={request?.priority ?? "Normal"}
              options={(priorities ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
        </div>
        <div>
          <Text style={{ fontSize: 12.5, color: C.textSecondary }}>
            Reply to the client (optional)
          </Text>
          <TextArea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="On it — first draft with you Thursday."
          />
        </div>
      </div>
    </Modal>
  );
}

/** Declining, with the reason the client will read. */
export function DeclineRequestModal({
  open,
  onClose,
  request,
}: {
  open: boolean;
  onClose: () => void;
  request: ClientRequestRow | null;
}) {
  const C = useC();
  const { message } = App.useApp();
  const decline = useDeclineClientRequest();
  const [reason, setReason] = useState("");

  const submit = async () => {
    if (!request) return;
    if (reason.trim().length < 4) {
      message.error("Give the client a reason — a bare 'no' is why they go back to WhatsApp.");
      return;
    }
    try {
      await decline.mutateAsync({ id: request.id, note: reason.trim() });
      message.success("Declined, with your reason.");
      onClose();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "Could not record that.",
      );
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Decline this request"
      okText="Decline"
      okButtonProps={{ danger: true }}
      onOk={submit}
      confirmLoading={decline.isPending}
      destroyOnHidden
    >
      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
        {request ? <Tag style={{ width: "fit-content" }}>{request.title}</Tag> : null}
        <TextArea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Out of this month's scope — happy to quote it as an add-on."
        />
        <div style={{ fontSize: 12, color: C.textTertiary }}>
          The client sees this on their request. Say what it would take, not just no.
        </div>
      </div>
    </Modal>
  );
}
