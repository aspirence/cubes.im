"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Modal, Select, Tooltip, Typography } from "antd";
import { useAppActivatedProjects } from "@/features/apps-platform/app-scope";
import {
  useInstallApp,
  useInstalledApps,
  useIsTeamAdmin,
} from "@/features/apps-platform/use-installed-apps";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useProjectComments } from "@/features/projects/use-project-comments";
import { richTextToPlain } from "@/features/editor/rich-text";
import {
  ContactAvatar,
  EmptyPanel,
  MIcon,
  Panel,
  StatePill,
  ViewTab,
  useC,
} from "./ui";
import {
  AcceptRequestModal,
  DeclineRequestModal,
  InviteContactModal,
  RequestApprovalModal,
  ShareItemModal,
} from "./client-modals";
import { PortalProject } from "./portal-project";
import { buildPreviewOverview, previewRequestsFor } from "./preview";
import {
  useClientApprovals,
  useClientContacts,
  useClientProjectAccess,
  useClientRequests,
  useClientShares,
  useDeleteClientApproval,
  useMarkRequestDone,
  useSendClientInvite,
  useSetClientProjectAccess,
  useShareableSheets,
  useUnshareFromClient,
  useUpdateClientContact,
  portalSignInUrl,
} from "./use-client-app";
import {
  APPROVAL_STATE_META,
  APPROVAL_SUBJECT_META,
  CONTACT_STATUS_META,
  DEFAULT_PORTAL_BRAND,
  REQUEST_STATUS_META,
  REQUEST_TYPES,
  ROLE_META,
  SHARE_KIND_META,
  contactDisplayName,
  describeLastSeen,
  initialsFor,
  sortApprovals,
  summarizeRequests,
  type ClientContactRow,
  type ClientRequestRow,
  type ClientRole,
  type ClientShareRow,
} from "./types";

const { Title, Paragraph } = Typography;

type ViewKey = "contacts" | "shared" | "requests" | "approvals";

/** Stable identity for "no rows yet", so memo dependencies stay stable. */
const EMPTY_ROWS: never[] = [];

/**
 * The agency's half of the Client app: who the client is, what they can see,
 * what they have asked for, and what they still have to sign off.
 *
 * One component serves both entry points, the way Content Studio does —
 * embedded as a project's Client tab (scoped to that project) or standalone at
 * /apps/client with a project rail. The client-facing screens live in
 * portal-*.tsx and are rendered here only through "Preview as client".
 */
export function ClientWorkspace({
  projectId,
  embedded = false,
}: {
  projectId?: string;
  embedded?: boolean;
}) {
  const C = useC();
  const router = useRouter();
  const { message, modal } = App.useApp();
  const { data: activeTeam } = useActiveTeam();
  const { data: installedApps } = useInstalledApps();
  const { data: isTeamAdmin } = useIsTeamAdmin();
  const installApp = useInstallApp();
  const { data: projects } = useAppActivatedProjects("client");

  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(projectId);
  const scopeProjectId = projectId ?? selectedProjectId;
  const [view, setView] = useState<ViewKey>("requests");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [acceptTarget, setAcceptTarget] = useState<ClientRequestRow | null>(null);
  const [declineTarget, setDeclineTarget] = useState<ClientRequestRow | null>(null);

  const contactsQuery = useClientContacts();
  const accessQuery = useClientProjectAccess(scopeProjectId);
  const sharesQuery = useClientShares(scopeProjectId);
  const requestsQuery = useClientRequests(scopeProjectId);
  const approvalsQuery = useClientApprovals(scopeProjectId);

  const updateContact = useUpdateClientContact();
  const setAccess = useSetClientProjectAccess();
  const unshare = useUnshareFromClient();
  const deleteApproval = useDeleteClientApproval();
  const markDone = useMarkRequestDone();
  const sendInvite = useSendClientInvite();

  const installRecord = installedApps?.find((entry) => entry.app_key === "client");
  const installed = Boolean(installRecord?.enabled);

  // One shared empty array rather than a fresh `[]` per render: these feed
  // useMemo dependency lists, and a new literal each time defeats every one.
  const contacts = contactsQuery.data?.rows ?? EMPTY_ROWS;
  const access = accessQuery.data?.rows ?? EMPTY_ROWS;
  const shares = sharesQuery.data?.rows ?? EMPTY_ROWS;
  const requests = requestsQuery.data?.rows ?? EMPTY_ROWS;
  const approvals = approvalsQuery.data?.rows ?? EMPTY_ROWS;

  // "Not ready" is the tables not existing yet, which is a different thing from
  // an empty workspace and must not be dressed up as one.
  const notReady = Boolean(
    contactsQuery.data?.notReady ||
      accessQuery.data?.notReady ||
      sharesQuery.data?.notReady ||
      requestsQuery.data?.notReady ||
      approvalsQuery.data?.notReady,
  );

  const contactById = useMemo(() => {
    const map = new Map<string, ClientContactRow>();
    for (const contact of contacts) map.set(contact.id, contact);
    return map;
  }, [contacts]);

  const projectById = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string | null }>();
    for (const project of projects ?? []) {
      map.set(project.id, {
        id: project.id,
        name: project.name,
        color: project.color_code ?? null,
      });
    }
    return map;
  }, [projects]);

  /** Contacts with an access row on the project in scope. */
  const scopedContacts = useMemo(() => {
    if (!scopeProjectId) return contacts;
    const allowed = new Set(
      access.filter((row) => row.project_id === scopeProjectId).map((row) => row.contact_id),
    );
    return contacts.filter((contact) => allowed.has(contact.id));
  }, [contacts, access, scopeProjectId]);

  const otherContacts = useMemo(() => {
    if (!scopeProjectId) return [];
    const shown = new Set(scopedContacts.map((c) => c.id));
    return contacts.filter((c) => !shown.has(c.id) && c.status !== "revoked");
  }, [contacts, scopedContacts, scopeProjectId]);

  const requestCounts = useMemo(() => summarizeRequests(requests), [requests]);
  const pendingApprovals = approvals.filter((a) => a.state === "pending");

  const previewContact = useMemo(
    () => scopedContacts.find((c) => c.status !== "revoked") ?? null,
    [scopedContacts],
  );

  // Two things a share row cannot say on its own: what an update actually
  // reads like (it is a project comment, and the client gets all of it), and
  // whether a sheet opens in the portal at all. Both are fetched only once the
  // preview is on screen — an empty project id leaves the queries disabled.
  const previewProjectId = previewOpen ? scopeProjectId : "";
  const { data: previewComments } = useProjectComments(previewProjectId || undefined);
  const previewSheets = useShareableSheets(previewProjectId || undefined);
  const previewDetailFor = useMemo(() => {
    const bodyByCommentId = new Map(
      (previewComments ?? []).map((comment) => [
        comment.id,
        richTextToPlain(comment.content),
      ]),
    );
    const sourceBySheetId = new Map(
      (previewSheets.data?.rows ?? []).map((row) => [row.id, row.source ?? null]),
    );
    return (share: ClientShareRow) => {
      if (share.kind === "update") {
        return { body: bodyByCommentId.get(share.ref_id) ?? null };
      }
      if (share.kind === "sheet") {
        // Same rule the portal's RPC applies: only a custom sheet keeps its
        // rows in the database, so only a custom sheet can be opened.
        const viewable = sourceBySheetId.get(share.ref_id) === "custom";
        return { sheet: { viewable, columns: 0, rows: null } };
      }
      return {};
    };
  }, [previewComments, previewSheets.data]);

  const handleInstall = async () => {
    try {
      await installApp.mutateAsync("client");
      message.success("Client app installed.");
    } catch {
      message.error("Could not install the Client app.");
    }
  };

  const handleResend = async (contact: ClientContactRow) => {
    let result;
    try {
      result = await sendInvite.mutateAsync({
        contactId: contact.id,
        projectId: scopeProjectId,
      });
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "Could not send a link.",
      );
      return;
    }
    if (result.status === "sent") {
      message.success(`New link emailed to ${contact.email}.`);
      return;
    }
    // Never claim a send that did not happen — hand over what does work.
    modal.info({
      title: "No email went out",
      content: (
        <div style={{ fontSize: 13.5 }}>
          <p style={{ marginTop: 0 }}>
            {result.reason ?? "This workspace has no email sender configured."}
          </p>
          <p style={{ marginBottom: 0, wordBreak: "break-all" }}>
            {result.link ? (
              <>
                Send {contact.email} this single-use link (15 minutes):{" "}
                <strong>{result.link}</strong>
              </>
            ) : (
              <>
                Send {contact.email} this address and they can ask for their own link:{" "}
                <strong>{portalSignInUrl()}</strong>
              </>
            )}
          </p>
        </div>
      ),
    });
  };

  const handleRevoke = (contact: ClientContactRow) => {
    const revoking = contact.status !== "revoked";
    modal.confirm({
      title: revoking ? `Revoke ${contactDisplayName(contact)}?` : "Restore access?",
      content: revoking
        ? "Their sessions end immediately and their links stop working. Nothing they already approved is affected."
        : "They will be able to sign in again with a new one-time link.",
      okText: revoking ? "Revoke" : "Restore",
      okButtonProps: revoking ? { danger: true } : undefined,
      onOk: async () => {
        try {
          const result = await updateContact.mutateAsync({
            id: contact.id,
            action: revoking ? "revoke" : "reinstate",
          });
          message.success(
            revoking
              ? // The route confirms the cascade rather than assuming it, so
                // say what actually happened to their open sessions.
                result.sessionsLeft === 0
                ? "Access revoked — every session ended."
                : "Access revoked."
              : "Access restored. Send them a new sign-in link.",
          );
        } catch (error) {
          message.error(
            error instanceof Error ? error.message : "Could not change that.",
          );
        }
      },
    });
  };

  if (!installed) {
    return (
      <InstallPrompt
        admin={Boolean(isTeamAdmin)}
        installing={installApp.isPending}
        onInstall={handleInstall}
        onManage={() => router.push("/apps?view=cubes")}
      />
    );
  }

  /* ──────────────────────────── views ──────────────────────────── */

  const contactsView = (
    <div style={{ display: "grid", gap: 14 }}>
      <Panel
        title={scopeProjectId ? "Contacts on this project" : "Client contacts"}
        subtitle={
          scopeProjectId
            ? "Only these people can open this project. Sharing is per project."
            : "Everyone your workspace has invited into a client area."
        }
        extra={
          <Button type="primary" size="small" onClick={() => setInviteOpen(true)}>
            Invite contact
          </Button>
        }
        padding={0}
      >
        {scopedContacts.length === 0 ? (
          <div style={{ padding: 14 }}>
            <EmptyPanel
              title="No client contacts yet"
              desc="Invite by email. They sign in with a one-time link — no password, no shared login."
            />
          </div>
        ) : (
          scopedContacts.map((contact, index) => {
            const role = ROLE_META[contact.role] ?? ROLE_META.viewer;
            const status = CONTACT_STATUS_META[contact.status] ?? CONTACT_STATUS_META.invited;
            const grant = access.find(
              (row) => row.contact_id === contact.id && row.project_id === scopeProjectId,
            );
            return (
              <div
                key={contact.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "11px 14px",
                  borderTop: index === 0 ? "none" : `1px solid ${C.hair}`,
                  flexWrap: "wrap",
                }}
              >
                <ContactAvatar
                  initials={initialsFor(contact.name ?? contact.email)}
                  tone={role.tone}
                />
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontWeight: 650, fontSize: 14, color: C.text }}>
                    {contactDisplayName(contact)}
                  </div>
                  <div style={{ fontSize: 12, color: C.textTertiary }}>
                    {contact.email} · {describeLastSeen(contact.last_seen_at)}
                  </div>
                </div>
                <StatePill label={status.label} tone={status.tone} icon={status.icon} />
                <Select
                  size="small"
                  value={contact.role}
                  style={{ width: 130 }}
                  onChange={async (value: ClientRole) => {
                    try {
                      await updateContact.mutateAsync({ id: contact.id, role: value });
                    } catch {
                      message.error("Could not change the role.");
                    }
                  }}
                  options={(Object.keys(ROLE_META) as ClientRole[]).map((key) => ({
                    value: key,
                    label: ROLE_META[key].label,
                  }))}
                />
                {scopeProjectId && grant ? (
                  <Tooltip
                    title={
                      grant.can_approve
                        ? "Can approve on this project"
                        : "View-only on this project — click to let them approve"
                    }
                  >
                    <Button
                      size="small"
                      type={grant.can_approve ? "primary" : "default"}
                      onClick={async () => {
                        try {
                          await setAccess.mutateAsync({
                            contactId: contact.id,
                            projectId: scopeProjectId,
                            grant: true,
                            canRequest: grant.can_request,
                            canApprove: !grant.can_approve,
                          });
                        } catch {
                          message.error("Could not change that.");
                        }
                      }}
                    >
                      <MIcon name="verified" size={15} />
                    </Button>
                  </Tooltip>
                ) : null}
                <Button size="small" onClick={() => void handleResend(contact)}>
                  Resend link
                </Button>
                <Button size="small" danger={contact.status !== "revoked"} onClick={() => handleRevoke(contact)}>
                  {contact.status === "revoked" ? "Restore" : "Revoke"}
                </Button>
              </div>
            );
          })
        )}
      </Panel>

      {scopeProjectId && otherContacts.length > 0 ? (
        <Panel
          title="Elsewhere in this workspace"
          subtitle="Contacts who exist but cannot see this project."
          padding={0}
        >
          {otherContacts.map((contact, index) => (
            <div
              key={contact.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "10px 14px",
                borderTop: index === 0 ? "none" : `1px solid ${C.hair}`,
              }}
            >
              <ContactAvatar
                initials={initialsFor(contact.name ?? contact.email)}
                tone={C.textTertiary}
                size={28}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: C.text }}>
                  {contactDisplayName(contact)}
                </div>
                <div style={{ fontSize: 12, color: C.textTertiary }}>{contact.email}</div>
              </div>
              <Button
                size="small"
                onClick={async () => {
                  try {
                    await setAccess.mutateAsync({
                      contactId: contact.id,
                      projectId: scopeProjectId,
                      grant: true,
                    });
                    message.success("Given access to this project.");
                  } catch {
                    message.error("Could not grant access.");
                  }
                }}
              >
                Give access
              </Button>
            </div>
          ))}
        </Panel>
      ) : null}
    </div>
  );

  const sharedView = (
    <Panel
      title="What the client can see"
      subtitle="Opt-in, one item at a time. Everything else on the project stays internal."
      extra={
        scopeProjectId ? (
          <Button type="primary" size="small" onClick={() => setShareOpen(true)}>
            Share something
          </Button>
        ) : null
      }
      padding={0}
    >
      {shares.length === 0 ? (
        <div style={{ padding: 14 }}>
          <EmptyPanel
            title="Nothing is shared yet"
            desc="A client with access still sees an empty project until you add something here."
          />
        </div>
      ) : (
        shares.map((share, index) => {
          const meta = SHARE_KIND_META[share.kind] ?? SHARE_KIND_META.update;
          const project = projectById.get(share.project_id);
          return (
            <div
              key={share.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "10px 14px",
                borderTop: index === 0 ? "none" : `1px solid ${C.hair}`,
              }}
            >
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: `${meta.tone}1a`,
                  color: meta.tone,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "none",
                }}
              >
                <MIcon name={meta.icon} size={16} color={meta.tone} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: C.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {share.title ?? "Shared item"}
                </div>
                <div style={{ fontSize: 12, color: C.textTertiary }}>
                  {meta.label}
                  {!scopeProjectId && project ? ` · ${project.name}` : ""}
                </div>
              </div>
              <Button
                size="small"
                onClick={async () => {
                  try {
                    await unshare.mutateAsync(share.id);
                    message.success("No longer shared.");
                  } catch {
                    message.error("Could not remove that.");
                  }
                }}
              >
                Remove
              </Button>
            </div>
          );
        })
      )}
    </Panel>
  );

  const requestsView = (
    <div style={{ display: "grid", gap: 12 }}>
      {requests.length === 0 ? (
        <EmptyPanel
          title="No requests yet"
          desc="When a client asks for something in their portal, it lands here — and only becomes work when you accept it."
        />
      ) : (
        requests.map((request) => {
          const meta = REQUEST_STATUS_META[request.status] ?? REQUEST_STATUS_META.new;
          const contact = request.contact_id ? contactById.get(request.contact_id) : null;
          const project = projectById.get(request.project_id);
          const type =
            REQUEST_TYPES.find((t) => t.value === request.request_type)?.label ??
            request.request_type;
          return (
            <Panel key={request.id}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
                    {request.title}
                  </div>
                  <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 2 }}>
                    {type}
                    {request.priority ? ` · ${request.priority} priority` : ""}
                    {contact ? ` · ${contactDisplayName(contact)}` : ""}
                    {!scopeProjectId && project ? ` · ${project.name}` : ""}
                  </div>
                  {request.details ? (
                    <div
                      style={{
                        fontSize: 13,
                        color: C.textSecondary,
                        marginTop: 8,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {request.details}
                    </div>
                  ) : null}
                </div>
                <StatePill label={meta.label} tone={meta.tone} icon={meta.icon} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {request.status === "new" ? (
                  <>
                    <Button type="primary" size="small" onClick={() => setAcceptTarget(request)}>
                      Accept → create task
                    </Button>
                    <Button size="small" danger onClick={() => setDeclineTarget(request)}>
                      Decline
                    </Button>
                  </>
                ) : null}
                {request.task_id ? (
                  <Button
                    size="small"
                    onClick={() =>
                      router.push(`/projects/${request.project_id}?task=${request.task_id}`)
                    }
                  >
                    Open the task
                  </Button>
                ) : null}
                {request.status === "accepted" ? (
                  <Button
                    size="small"
                    onClick={async () => {
                      try {
                        await markDone.mutateAsync(request.id);
                        message.success("Marked done — the client sees it too.");
                      } catch {
                        message.error("Could not update that.");
                      }
                    }}
                  >
                    Mark done
                  </Button>
                ) : null}
              </div>
            </Panel>
          );
        })
      )}
    </div>
  );

  const approvalsView = (
    <div style={{ display: "grid", gap: 12 }}>
      {approvals.length === 0 ? (
        <EmptyPanel
          title="Nothing sent for approval"
          desc="Send a post, a task or a file for sign-off and the decision is recorded with who made it and when."
          action={
            scopeProjectId ? (
              <Button type="primary" onClick={() => setApprovalOpen(true)} style={{ marginTop: 10 }}>
                Ask for an approval
              </Button>
            ) : undefined
          }
        />
      ) : (
        sortApprovals(approvals).map((approval) => {
          const state = APPROVAL_STATE_META[approval.state] ?? APPROVAL_STATE_META.pending;
          const subject =
            APPROVAL_SUBJECT_META[approval.subject_kind] ?? APPROVAL_SUBJECT_META.task;
          const decider = approval.decided_by_contact
            ? contactById.get(approval.decided_by_contact)
            : null;
          return (
            <Panel key={approval.id}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    background: `${subject.tone}1a`,
                    color: subject.tone,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "none",
                  }}
                >
                  <MIcon name={subject.icon} size={17} color={subject.tone} />
                </span>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>
                    {approval.title ?? "Untitled"}{" "}
                    <span style={{ color: C.textTertiary, fontWeight: 600 }}>
                      v{approval.version}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 2 }}>
                    {subject.label}
                    {approval.decided_at
                      ? ` · decided ${new Date(approval.decided_at).toLocaleString()}`
                      : " · waiting on the client"}
                    {decider ? ` by ${contactDisplayName(decider)}` : ""}
                  </div>
                  {approval.decision_note ? (
                    <div
                      style={{
                        fontSize: 13,
                        color: C.text,
                        marginTop: 8,
                        padding: "8px 10px",
                        background: C.panelSoft,
                        borderRadius: 9,
                      }}
                    >
                      {approval.decision_note}
                    </div>
                  ) : null}
                </div>
                <StatePill label={state.label} tone={state.tone} icon={state.icon} />
              </div>
              {approval.state === "pending" ? (
                <div style={{ marginTop: 10 }}>
                  <Button
                    size="small"
                    onClick={async () => {
                      try {
                        await deleteApproval.mutateAsync(approval.id);
                        message.success("Withdrawn.");
                      } catch {
                        message.error("Could not withdraw that.");
                      }
                    }}
                  >
                    Withdraw
                  </Button>
                </div>
              ) : null}
            </Panel>
          );
        })
      )}
    </div>
  );

  const contentView =
    view === "contacts"
      ? contactsView
      : view === "shared"
        ? sharedView
        : view === "requests"
          ? requestsView
          : approvalsView;

  const scopeProject = scopeProjectId ? projectById.get(scopeProjectId) : undefined;

  return (
    <>
      <div
        style={{
          display: embedded ? "block" : "flex",
          height: embedded ? "auto" : "calc(100vh - 58px)",
          margin: embedded ? 0 : "-22px -24px -48px",
          background: C.bg,
          overflow: "hidden",
        }}
      >
        {!embedded ? (
          <aside
            style={{
              width: 252,
              flex: "none",
              minHeight: 0,
              borderRight: `1px solid ${C.hair}`,
              background: C.panel,
              padding: "16px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <RailButton
              active={!scopeProjectId}
              icon="groups"
              label="All clients"
              count={contacts.length}
              onClick={() => setSelectedProjectId(undefined)}
            />
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: 0.7,
                color: C.textTertiary,
                padding: "12px 10px 4px",
                textTransform: "uppercase",
              }}
            >
              Projects
            </div>
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
              {(projects ?? []).map((project) => (
                <RailButton
                  key={project.id}
                  active={scopeProjectId === project.id}
                  dot={project.color_code ?? "#8a8d98"}
                  label={project.name}
                  onClick={() => setSelectedProjectId(project.id)}
                />
              ))}
            </div>
          </aside>
        ) : null}

        <main
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: "auto",
            padding: embedded ? "0 0 18px" : "22px 24px 40px",
          }}
        >
          {notReady ? (
            <NotSetUp />
          ) : (
            <>
              <div
                style={{
                  background: C.panel,
                  border: `1px solid ${C.hair}`,
                  borderRadius: 14,
                  padding: "12px 14px 14px",
                  boxShadow: "0 1px 2px rgba(16,24,40,.04)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 14,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ fontSize: 12.5, color: C.textTertiary }}>
                    {scopeProject
                      ? `Client area for ${scopeProject.name}`
                      : "Every client across your projects"}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button onClick={() => setInviteOpen(true)}>Invite contact</Button>
                    {scopeProjectId ? (
                      <>
                        <Button onClick={() => setShareOpen(true)}>Share an item</Button>
                        <Button onClick={() => setApprovalOpen(true)}>Ask for approval</Button>
                        <Button type="primary" onClick={() => setPreviewOpen(true)}>
                          Preview as client
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 200px))",
                    justifyContent: "start",
                    gap: 10,
                    marginTop: 14,
                  }}
                >
                  <MetricCard
                    icon="group"
                    label="Contacts"
                    value={scopedContacts.length}
                    detail="With access"
                    tone={C.accent}
                  />
                  <MetricCard
                    icon="folder_shared"
                    label="Shared"
                    value={shares.length}
                    detail="Items visible"
                    tone={C.indigo}
                  />
                  <MetricCard
                    icon="inbox"
                    label="Requests"
                    value={requestCounts.new}
                    detail="Waiting on you"
                    tone={C.gold}
                  />
                  <MetricCard
                    icon="approval"
                    label="Approvals"
                    value={pendingApprovals.length}
                    detail="Waiting on them"
                    tone={C.green}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                  margin: "18px 0 16px",
                }}
              >
                <ViewTab
                  active={view === "requests"}
                  icon="inbox"
                  label="Requests"
                  count={requestCounts.new}
                  onClick={() => setView("requests")}
                />
                <ViewTab
                  active={view === "approvals"}
                  icon="approval"
                  label="Approvals"
                  count={pendingApprovals.length}
                  onClick={() => setView("approvals")}
                />
                <ViewTab
                  active={view === "shared"}
                  icon="folder_shared"
                  label="Shared"
                  count={shares.length}
                  onClick={() => setView("shared")}
                />
                <ViewTab
                  active={view === "contacts"}
                  icon="group"
                  label="Contacts"
                  onClick={() => setView("contacts")}
                />
              </div>

              {contentView}
            </>
          )}
        </main>
      </div>

      <InviteContactModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        projectId={scopeProjectId}
      />
      {scopeProjectId ? (
        <>
          <ShareItemModal
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            projectId={scopeProjectId}
            alreadyShared={shares}
          />
          <RequestApprovalModal
            open={approvalOpen}
            onClose={() => setApprovalOpen(false)}
            projectId={scopeProjectId}
            approvals={approvals}
          />
          <Modal
            open={previewOpen}
            onCancel={() => setPreviewOpen(false)}
            footer={null}
            width={560}
            title="Preview as client"
            styles={{ body: { padding: 0, maxHeight: "72vh", overflowY: "auto" } }}
            destroyOnHidden
          >
            <PortalProject
              preview
              brand={{
                ...DEFAULT_PORTAL_BRAND,
                name: activeTeam?.name ?? DEFAULT_PORTAL_BRAND.name,
              }}
              overview={buildPreviewOverview({
                project: {
                  id: scopeProjectId,
                  name: scopeProject?.name ?? "Project",
                  color: scopeProject?.color ?? null,
                },
                contact: previewContact,
                shares,
                approvals,
                requests: previewRequestsFor(requests, previewContact?.id ?? null),
                access: previewContact
                  ? access.find(
                      (row) =>
                        row.contact_id === previewContact.id &&
                        row.project_id === scopeProjectId,
                    ) ?? null
                  : null,
                detailFor: previewDetailFor,
              })}
            />
          </Modal>
        </>
      ) : null}
      <AcceptRequestModal
        key={`accept-${acceptTarget?.id ?? "none"}`}
        open={acceptTarget !== null}
        onClose={() => setAcceptTarget(null)}
        request={acceptTarget}
        contact={
          acceptTarget?.contact_id ? contactById.get(acceptTarget.contact_id) ?? null : null
        }
      />
      <DeclineRequestModal
        key={`decline-${declineTarget?.id ?? "none"}`}
        open={declineTarget !== null}
        onClose={() => setDeclineTarget(null)}
        request={declineTarget}
      />
    </>
  );
}

/* ──────────────────────────── small pieces ──────────────────────────── */

function RailButton({
  active,
  icon,
  dot,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon?: string;
  dot?: string;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  const C = useC();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 10px",
        borderRadius: 10,
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        background: active ? C.accentSoft : "transparent",
        color: active ? C.accentDeep : C.textSecondary,
        fontSize: 13.5,
        fontWeight: active ? 700 : 500,
      }}
    >
      {icon ? <MIcon name={icon} size={18} color={active ? C.accentDeep : C.textTertiary} /> : null}
      {dot ? <span style={{ width: 10, height: 10, borderRadius: 999, background: dot }} /> : null}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {count !== undefined ? (
        <span style={{ fontSize: 11.5, color: active ? C.accentDeep : C.textTertiary }}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: string;
  label: string;
  value: string | number;
  detail: string;
  tone: string;
}) {
  const C = useC();
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.hair}`,
        borderRadius: 14,
        padding: "10px 12px",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: `${tone}18`,
            color: tone,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 auto",
          }}
        >
          <MIcon name={icon} size={15} color={tone} />
        </div>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: 0.6,
            color: C.textTertiary,
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: C.textTertiary }}>{detail}</div>
    </div>
  );
}

/**
 * The tables are not there yet. Said plainly, because "no contacts" and "the
 * migration has not been applied" look identical from the outside and only one
 * of them is the agency's problem to fix.
 */
function NotSetUp() {
  const C = useC();
  return (
    <div
      style={{
        background: C.panelSoft,
        border: `1px solid ${C.hair}`,
        borderRadius: 20,
        padding: 28,
        display: "grid",
        placeItems: "center",
        minHeight: 320,
      }}
    >
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <MIcon name="construction" size={34} color={C.textTertiary} />
        <Title level={4} style={{ marginTop: 10, marginBottom: 6 }}>
          The client area is not set up yet
        </Title>
        <Paragraph style={{ color: C.textSecondary, fontSize: 13.5, marginBottom: 0 }}>
          This workspace is missing the Client app&apos;s database migration, so there is
          nowhere yet to keep contacts, shares, requests or approvals. Everything here
          starts working the moment it is applied — nothing you do elsewhere is affected.
        </Paragraph>
      </div>
    </div>
  );
}

function InstallPrompt({
  admin,
  installing,
  onInstall,
  onManage,
}: {
  admin: boolean;
  installing: boolean;
  onInstall: () => void;
  onManage: () => void;
}) {
  const C = useC();
  return (
    <div
      style={{
        minHeight: 420,
        background: C.panelSoft,
        border: `1px solid ${C.hair}`,
        borderRadius: 26,
        padding: 28,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div style={{ maxWidth: 560, textAlign: "center" }}>
        <div
          style={{
            width: 70,
            height: 70,
            borderRadius: 22,
            margin: "0 auto 18px",
            background: "linear-gradient(135deg,#17b39a,#0f8f7a)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 16px 40px rgba(15,143,122,0.22)",
          }}
        >
          <MIcon name="handshake" size={34} color="#fff" />
        </div>
        <Title level={2} style={{ marginBottom: 8 }}>
          Client
        </Title>
        <Paragraph style={{ color: C.textSecondary, fontSize: 15 }}>
          Give the client a way in: the work you choose to share, the approvals you need
          from them, and requests that land on your board as real tasks. They sign in with
          a one-time link — no password, no shared URL that outlives the relationship.
        </Paragraph>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 18,
          }}
        >
          {admin ? (
            <Button type="primary" size="large" loading={installing} onClick={onInstall}>
              Install Client
            </Button>
          ) : null}
          <Button size="large" onClick={onManage}>
            Manage apps
          </Button>
        </div>
      </div>
    </div>
  );
}
