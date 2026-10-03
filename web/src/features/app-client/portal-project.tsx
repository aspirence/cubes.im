"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PButton,
  PCard,
  PEmpty,
  PField,
  PNotice,
  PPill,
  PSectionTitle,
  PortalShell,
  inputStyle,
  usePortalPalette,
} from "./portal-shell";
import { friendlyWhen, shortDate } from "./portal-chart";
import {
  APPROVAL_STATE_META,
  REQUEST_STATUS_CLIENT_META,
  REQUEST_TYPES,
  SHARE_KIND_META,
  formatCount,
  humanBytes,
  parseSheetData,
  sheetCellText,
  type PortalApproval,
  type PortalBrand,
  type PortalOverview,
  type PortalSharedItem,
  type PortalSheetData,
} from "./types";
import type { PortalPalette } from "./portal-theme";

/**
 * Everything a client can see and do on one project.
 *
 * The order is the order the research says they act in: the decisions waiting
 * on them, the work that was shared, then their own requests. Nothing internal
 * is rendered here because nothing internal is in the payload —
 * client_project_overview never selects a comment, a work log, a budget or
 * another contact's request, so this component could not show one.
 *
 * `preview` renders the same screen for the agency with every control inert,
 * which is the only honest way to answer "what does my client actually see?".
 */
export function PortalProject({
  overview,
  brand,
  preview = false,
}: {
  overview: PortalOverview;
  brand: PortalBrand;
  preview?: boolean;
}) {
  const palette = usePortalPalette(brand.accent);
  const router = useRouter();
  const { canRequest, canApprove } = overview.permissions;

  const pending = overview.approvals.filter((a) => a.state === "pending");
  const decided = overview.approvals.filter((a) => a.state !== "pending");

  return (
    <PortalShell
      brand={brand}
      palette={palette}
      back={preview ? undefined : { href: "/portal/home", label: "All projects" }}
      banner={
        preview ? (
          <div
            style={{
              background: palette.text,
              color: "#fff",
              fontSize: 12.5,
              fontWeight: 600,
              textAlign: "center",
              padding: "7px 16px",
            }}
          >
            Preview — this is the client&apos;s view. Buttons are inert here.
          </div>
        ) : null
      }
    >
      <div style={{ margin: "2px 2px 0" }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{overview.project.name}</div>
        {overview.project.clientName ? (
          <div style={{ fontSize: 13, color: palette.textSecondary, marginTop: 2 }}>
            {overview.project.clientName}
          </div>
        ) : null}
      </div>

      <PSectionTitle
        palette={palette}
        icon="approval"
        title="Waiting for you"
        hint={
          canApprove
            ? "Your decision is recorded with your name and the time."
            : "Someone else at your company signs these off."
        }
      />
      {pending.length === 0 ? (
        <PEmpty
          palette={palette}
          icon="task_alt"
          title="Nothing to approve"
          desc="When the team sends something for sign-off, it lands here."
        />
      ) : (
        pending.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            palette={palette}
            // `canDecide` is the database's own verdict for this contact; the
            // button is not offered when the answer would be 403.
            disabled={preview || !approval.canDecide}
            disabledReason={
              preview
                ? "Preview only."
                : "Your access is view-only — ask your agency to make you an approver."
            }
            preview={preview}
            onDone={() => router.refresh()}
          />
        ))
      )}

      {decided.length > 0 ? (
        <>
          <PSectionTitle
            palette={palette}
            icon="history"
            title="Already decided"
            hint="Your permanent record of what was signed off, and when."
          />
          {decided.map((approval) => (
            <PCard key={approval.id} palette={palette}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                    {approval.title}{" "}
                    <span style={{ color: palette.textTertiary, fontWeight: 600 }}>
                      v{approval.version}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: palette.textSecondary, marginTop: 3 }}>
                    {APPROVAL_STATE_META[approval.state].label}
                    {approval.decidedByMe ? " by you" : ""}
                    {approval.decidedAt ? ` · ${friendlyWhen(approval.decidedAt)}` : ""}
                  </div>
                  {approval.decisionNote ? (
                    <div
                      style={{
                        fontSize: 12.5,
                        color: palette.text,
                        marginTop: 7,
                        padding: "8px 10px",
                        background: palette.panelSoft,
                        borderRadius: 9,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {approval.decisionNote}
                    </div>
                  ) : null}
                </div>
                <PPill
                  label={APPROVAL_STATE_META[approval.state].label}
                  tone={approval.state === "approved" ? palette.green : palette.red}
                  icon={APPROVAL_STATE_META[approval.state].icon}
                />
              </div>
            </PCard>
          ))}
        </>
      ) : null}

      <PSectionTitle
        palette={palette}
        icon="folder_shared"
        title="Shared with you"
        hint="Only what the team chose to share on this project."
      />
      {overview.shares.length === 0 ? (
        <PEmpty
          palette={palette}
          icon="inbox"
          title="Nothing shared yet"
          desc="Tasks, files and updates the team shares will show up here."
        />
      ) : (
        <SharedList items={overview.shares} palette={palette} preview={preview} />
      )}

      <PSectionTitle
        palette={palette}
        icon="forum"
        title="Your requests"
        hint="Everything you have asked for, and where it got to."
      />
      {overview.requests.length === 0 ? (
        <PEmpty
          palette={palette}
          icon="add_comment"
          title="No requests yet"
          desc="Ask for something below and it goes straight to the team."
        />
      ) : (
        overview.requests.map((request) => {
          const meta = REQUEST_STATUS_CLIENT_META[request.status];
          return (
            <PCard key={request.id} palette={palette}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{request.title}</div>
                  <div style={{ fontSize: 12, color: palette.textTertiary, marginTop: 2 }}>
                    {REQUEST_TYPES.find((t) => t.value === request.requestType)?.label ??
                      request.requestType}
                    {request.createdAt ? ` · ${friendlyWhen(request.createdAt)}` : ""}
                  </div>
                  {request.details ? (
                    <div
                      style={{
                        fontSize: 12.5,
                        color: palette.textSecondary,
                        marginTop: 6,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {request.details}
                    </div>
                  ) : null}
                  {request.decisionNote ? (
                    <div
                      style={{
                        fontSize: 12.5,
                        color: palette.text,
                        marginTop: 7,
                        padding: "8px 10px",
                        background: palette.panelSoft,
                        borderRadius: 9,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {request.decisionNote}
                    </div>
                  ) : null}
                </div>
                <PPill label={meta.label} tone={meta.tone} icon={meta.icon} />
              </div>
            </PCard>
          );
        })
      )}

      {canRequest ? (
        <NewRequestForm
          projectId={overview.project.id}
          palette={palette}
          disabled={preview}
          onDone={() => router.refresh()}
        />
      ) : null}
    </PortalShell>
  );
}

/* ──────────────────────────── shared items ──────────────────────────── */

function SharedList({
  items,
  palette,
  preview,
}: {
  items: PortalSharedItem[];
  palette: PortalPalette;
  preview: boolean;
}) {
  return (
    <PCard palette={palette} padding={0}>
      {items.map((item, index) => (
        <SharedRow
          key={item.shareId}
          item={item}
          palette={palette}
          preview={preview}
          first={index === 0}
        />
      ))}
    </PCard>
  );
}

function SharedRow({
  item,
  palette,
  preview,
  first,
}: {
  item: PortalSharedItem;
  palette: PortalPalette;
  preview: boolean;
  first: boolean;
}) {
  const [open, setOpen] = useState(false);
  const meta = SHARE_KIND_META[item.kind];
  // A sheet whose rows live in the database opens right here. Every other
  // source is a live view of the team's own data and has no honest read-only
  // rendering for an outsider, so the row says which it is.
  const opens = item.kind === "sheet" && item.sheet?.viewable === true && !preview;

  const row = (
    <div
      style={{
        display: "flex",
        gap: 11,
        alignItems: "flex-start",
        padding: "12px 14px",
        borderTop: first ? "none" : `1px solid ${palette.hair}`,
        textAlign: "left",
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          flex: "none",
          borderRadius: 9,
          background: `${meta.tone}1a`,
          color: meta.tone,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 17 }}>
          {item.done ? "check_circle" : meta.icon}
        </span>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 650 }}>{item.title}</div>
        <div style={{ fontSize: 12, color: palette.textTertiary }}>
          {meta.label}
          {item.detail ? ` · ${item.detail}` : ""}
          {item.createdAt ? ` · ${friendlyWhen(item.createdAt)}` : ""}
        </div>
        {item.body ? (
          <div
            style={{
              fontSize: 13,
              color: palette.textSecondary,
              marginTop: 7,
              whiteSpace: "pre-wrap",
            }}
          >
            {item.body}
          </div>
        ) : null}
        {item.sheet && !item.sheet.viewable ? (
          <div style={{ fontSize: 12, color: palette.textTertiary, marginTop: 6 }}>
            This one is a live view of the team&apos;s own workspace, so it is not published
            here. Ask them to send it across.
          </div>
        ) : null}
      </div>
      {item.url ? (
        <span
          className="material-symbols-rounded"
          aria-hidden
          style={{ fontSize: 19, color: palette.textTertiary }}
        >
          download
        </span>
      ) : null}
      {opens ? (
        <span
          className="material-symbols-rounded"
          aria-hidden
          style={{ fontSize: 20, color: palette.textTertiary }}
        >
          {open ? "expand_less" : "expand_more"}
        </span>
      ) : null}
    </div>
  );

  if (item.url && !preview) {
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        {row}
      </a>
    );
  }
  if (!opens) return <div>{row}</div>;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          display: "block",
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit",
          color: "inherit",
          cursor: "pointer",
        }}
      >
        {row}
      </button>
      {open ? <SheetTable shareId={item.shareId} palette={palette} /> : null}
    </div>
  );
}

/**
 * A shared sheet, read-only.
 *
 * It is fetched on open rather than with the page: a sheet can be hundreds of
 * rows, and most visits are for the approvals at the top. The route takes the
 * share id and the session cookie, and returns only the columns the sheet
 * itself declares — there is nothing here for this component to filter.
 */
function SheetTable({
  shareId,
  palette,
}: {
  shareId: string;
  palette: PortalPalette;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; data: PortalSheetData }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  // One fetch per open: the row unmounts this component when it is collapsed,
  // so "loading" is the state it is born in and there is nothing to reset.
  useEffect(() => {
    let alive = true;
    fetch(`/api/client/portal/sheets/${shareId}`)
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!alive) return;
        const data = response.ok ? parseSheetData(body) : null;
        if (data) {
          setState({ kind: "ready", data });
          return;
        }
        setState({
          kind: "error",
          message:
            response.status === 401
              ? "Your session has expired — reload the page to sign in again."
              : "We could not open this sheet. Please try again in a moment.",
        });
      })
      .catch(() => {
        if (alive) {
          setState({ kind: "error", message: "We could not reach the server." });
        }
      });
    return () => {
      alive = false;
    };
  }, [shareId]);

  if (state.kind === "loading") {
    return (
      <div style={{ padding: "0 14px 13px", fontSize: 12.5, color: palette.textTertiary }}>
        Opening…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div style={{ padding: "0 14px 13px", fontSize: 12.5, color: palette.red }}>
        {state.message}
      </div>
    );
  }

  const { columns, rows, total } = state.data;
  if (columns.length === 0 || rows.length === 0) {
    return (
      <div style={{ padding: "0 14px 13px", fontSize: 12.5, color: palette.textTertiary }}>
        {columns.length === 0
          ? "This sheet has no columns to show yet."
          : "This sheet has no rows yet."}
      </div>
    );
  }

  const cell: React.CSSProperties = {
    padding: "7px 10px",
    borderBottom: `1px solid ${palette.hair}`,
    whiteSpace: "nowrap",
    textAlign: "left",
  };

  return (
    <div style={{ padding: "0 14px 13px" }}>
      <div style={{ overflowX: "auto", border: `1px solid ${palette.hair}`, borderRadius: 10 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: "100%" }}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  style={{
                    ...cell,
                    fontWeight: 700,
                    color: palette.textSecondary,
                    background: palette.panelSoft,
                  }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column.id} style={cell}>
                    {sheetCellText(row[column.id], column)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > rows.length ? (
        <div style={{ fontSize: 11.5, color: palette.textTertiary, marginTop: 6 }}>
          Showing the first {formatCount(rows.length)} of {formatCount(total)} rows.
        </div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────── approvals ────────────────────────────── */

/**
 * The work an approval is about.
 *
 * Without this a sign-off is a blind signature — a filename, a version number
 * and two buttons. Everything here comes joined to the approval by
 * `client_project_overview`, and the bytes come from
 * /api/client/portal/approvals/[id]/file, which derives what it may serve from
 * the approval's own subject rather than from anything the browser sends.
 */
function ApprovalSubject({
  approval,
  palette,
  preview,
}: {
  approval: PortalApproval;
  palette: PortalPalette;
  preview: boolean;
}) {
  const subject = approval.subject;
  const muted: React.CSSProperties = {
    fontSize: 12.5,
    color: palette.textTertiary,
    marginTop: 9,
    lineHeight: 1.5,
  };

  if (!subject) {
    return (
      <div style={muted}>
        {preview
          ? "The client sees the item itself here — a post with its words and artwork, or the file."
          : "The item this was raised on is no longer available. Ask the team to send it again."}
      </div>
    );
  }

  // No session means no signed URL, so a preview shows the words and says so
  // rather than rendering a broken image.
  const fileHref = preview ? null : `/api/client/portal/approvals/${approval.id}/file`;
  const panel: React.CSSProperties = {
    marginTop: 10,
    padding: "10px 12px",
    background: palette.panelSoft,
    borderRadius: 10,
  };

  if (subject.kind === "task") {
    return (
      <div style={panel}>
        <div style={{ fontSize: 13.5, fontWeight: 650 }}>{subject.name}</div>
        <div style={{ fontSize: 12, color: palette.textTertiary, marginTop: 2 }}>
          {[
            subject.done ? "Done" : subject.status,
            subject.endDate ? `Due ${shortDate(subject.endDate)}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "In progress"}
        </div>
      </div>
    );
  }

  if (subject.kind === "video_review") {
    return (
      <div style={panel}>
        <div style={{ fontSize: 13.5, fontWeight: 650 }}>{subject.title}</div>
        <div style={{ fontSize: 12, color: palette.textTertiary, marginTop: 2 }}>
          {subject.revision ? `Cut ${subject.revision}` : "Video"} · watch it on the review link
          the team sent you
        </div>
      </div>
    );
  }

  if (subject.kind === "file") {
    return (
      <div style={panel}>
        <SubjectFile
          name={subject.name}
          mime={subject.mime}
          sizeBytes={subject.sizeBytes}
          href={fileHref}
          palette={palette}
        />
      </div>
    );
  }

  return (
    <div style={panel}>
      <div style={{ fontSize: 13.5, fontWeight: 650 }}>{subject.title}</div>
      <div style={{ fontSize: 12, color: palette.textTertiary, marginTop: 2 }}>
        {[
          subject.contentType,
          subject.scheduledFor ? `Goes out ${friendlyWhen(subject.scheduledFor)}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Post"}
      </div>
      {subject.body ? (
        <div
          style={{
            fontSize: 13,
            color: palette.text,
            marginTop: 8,
            whiteSpace: "pre-wrap",
            lineHeight: 1.55,
          }}
        >
          {subject.body}
        </div>
      ) : null}
      {subject.assets.length > 0 ? (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {subject.assets.map((asset) => (
            <SubjectFile
              key={asset.n}
              name={asset.name}
              mime={asset.mime}
              sizeBytes={asset.sizeBytes}
              href={fileHref ? `${fileHref}?asset=${asset.n}` : null}
              palette={palette}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One file under an approval: shown if it is an image, opened either way. */
function SubjectFile({
  name,
  mime,
  sizeBytes,
  href,
  palette,
}: {
  name: string;
  mime: string | null;
  sizeBytes: number | null;
  href: string | null;
  palette: PortalPalette;
}) {
  const isImage = (mime ?? "").startsWith("image/");
  return (
    <div>
      {isImage && href ? (
        // The source is a per-session signed URL on the storage host, which
        // the image optimiser cannot be pointed at.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={href}
          alt={name}
          style={{
            display: "block",
            width: "100%",
            maxHeight: 320,
            objectFit: "contain",
            borderRadius: 9,
            background: palette.bg,
            marginBottom: 6,
          }}
        />
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          className="material-symbols-rounded"
          aria-hidden
          style={{ fontSize: 18, color: palette.textTertiary }}
        >
          {isImage ? "image" : "description"}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{name}</div>
          {sizeBytes !== null ? (
            <div style={{ fontSize: 11.5, color: palette.textTertiary }}>
              {humanBytes(sizeBytes)}
            </div>
          ) : null}
        </div>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12.5, fontWeight: 650, color: palette.accent }}
          >
            Open
          </a>
        ) : null}
      </div>
    </div>
  );
}

function ApprovalCard({
  approval,
  palette,
  disabled,
  disabledReason,
  preview,
  onDone,
}: {
  approval: PortalApproval;
  palette: PortalPalette;
  disabled: boolean;
  disabledReason: string;
  preview: boolean;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approved" | "changes_requested" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const decide = async (state: "approved" | "changes_requested") => {
    if (disabled) return;
    // "Request changes" without a note is a wasted round for everyone, so the
    // first press opens the box and only the second one submits.
    if (state === "changes_requested" && !asking) {
      setAsking(true);
      return;
    }
    setBusy(state);
    setError(null);
    try {
      const response = await fetch(`/api/client/portal/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, note: note.trim() || null }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
      };
      if (!response.ok) {
        setError(
          body.error ??
            (body.reason === "already_decided"
              ? "Somebody at your company has already decided this."
              : "That did not go through. Please try again."),
        );
        setBusy(null);
        return;
      }
      onDone();
    } catch {
      setError("We could not reach the server. Please try again.");
      setBusy(null);
    }
  };

  return (
    <PCard palette={palette} accentEdge={palette.gold}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>
        {approval.title}{" "}
        <span style={{ color: palette.textTertiary, fontWeight: 600 }}>v{approval.version}</span>
      </div>
      <div style={{ fontSize: 12, color: palette.textTertiary, marginTop: 2 }}>
        Sent {friendlyWhen(approval.requestedAt)}
      </div>
      {approval.note ? (
        <div
          style={{
            fontSize: 13,
            color: palette.text,
            marginTop: 9,
            padding: "9px 11px",
            background: palette.panelSoft,
            borderRadius: 10,
            whiteSpace: "pre-wrap",
          }}
        >
          {approval.note}
        </div>
      ) : null}

      <ApprovalSubject approval={approval} palette={palette} preview={preview} />

      {asking ? (
        <div style={{ marginTop: 11 }}>
          <PField palette={palette} label="What needs changing?">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Be specific — this goes straight to the team."
              style={{ ...inputStyle(palette), minHeight: 84, resize: "vertical" }}
            />
          </PField>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 9, marginTop: 12, flexWrap: "wrap" }}>
        <PButton
          palette={palette}
          onClick={() => decide("approved")}
          disabled={disabled || busy !== null}
          tone={palette.green}
        >
          {busy === "approved" ? "Approving…" : "Approve"}
        </PButton>
        <PButton
          palette={palette}
          variant="ghost"
          tone={palette.red}
          onClick={() => decide("changes_requested")}
          disabled={disabled || busy !== null}
        >
          {busy === "changes_requested"
            ? "Sending…"
            : asking
              ? "Send changes"
              : "Request changes"}
        </PButton>
      </div>
      {disabled ? (
        <div style={{ fontSize: 11.5, color: palette.textTertiary, marginTop: 8 }}>
          {disabledReason}
        </div>
      ) : null}
      {error ? (
        <div style={{ marginTop: 9 }}>
          <PNotice palette={palette} tone={palette.red} icon="error" title="Not recorded">
            {error}
          </PNotice>
        </div>
      ) : null}
    </PCard>
  );
}

/* ─────────────────────────────── requests ─────────────────────────────── */

function NewRequestForm({
  projectId,
  palette,
  disabled,
  onDone,
}: {
  projectId: string;
  palette: PortalPalette;
  disabled: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [requestType, setRequestType] = useState("general");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState("normal");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    if (title.trim().length < 3) {
      setError("Give it a short title so the team knows what it is.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/client/portal/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          requestType,
          title: title.trim(),
          // A link is appended to the details rather than stored separately:
          // a request has no attachment column, and a reference the team
          // cannot open is worse than no reference at all.
          details: [details.trim(), link.trim() ? `Reference: ${link.trim()}` : ""]
            .filter(Boolean)
            .join("\n\n"),
          priority,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "We could not send that. Please try again.");
        setBusy(false);
        return;
      }
      setTitle("");
      setDetails("");
      setLink("");
      setOpen(false);
      setBusy(false);
      onDone();
    } catch {
      setError("We could not reach the server. Please try again.");
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <PButton palette={palette} full onClick={() => setOpen(true)} disabled={disabled}>
        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 19 }}>
          add
        </span>
        New request
      </PButton>
    );
  }

  return (
    <PCard palette={palette}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>New request</div>
        <PField palette={palette} label="What kind of request is this?">
          <select
            value={requestType}
            onChange={(e) => setRequestType(e.target.value)}
            style={inputStyle(palette)}
          >
            {REQUEST_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label} — {type.hint}
              </option>
            ))}
          </select>
        </PField>
        <PField palette={palette} label="Title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Diwali offer creative for Instagram"
            style={inputStyle(palette)}
          />
        </PField>
        <PField
          palette={palette}
          label="Details"
          hint="Dates, sizes, the offer, anything you already know."
        >
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={4}
            maxLength={8000}
            style={{ ...inputStyle(palette), minHeight: 100, resize: "vertical" }}
          />
        </PField>
        <PField palette={palette} label="How urgent is it?">
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            style={inputStyle(palette)}
          >
            <option value="low">Whenever you can</option>
            <option value="normal">Normal</option>
            <option value="high">Urgent</option>
          </select>
        </PField>
        <PField
          palette={palette}
          label="Link to a file (optional)"
          hint="Paste a Drive or WeTransfer link. Uploading files from here is not available yet."
        >
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://…"
            style={inputStyle(palette)}
          />
        </PField>
        {error ? (
          <PNotice palette={palette} tone={palette.red} icon="error" title="Not sent">
            {error}
          </PNotice>
        ) : null}
        <div style={{ display: "flex", gap: 9 }}>
          <PButton palette={palette} type="submit" disabled={busy || disabled}>
            {busy ? "Sending…" : "Send request"}
          </PButton>
          <PButton palette={palette} variant="quiet" onClick={() => setOpen(false)}>
            Cancel
          </PButton>
        </div>
        {disabled ? (
          <div style={{ fontSize: 11.5, color: palette.textTertiary }}>
            Preview only — the client submits this.
          </div>
        ) : null}
      </form>
    </PCard>
  );
}
