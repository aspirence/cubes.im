"use client";

/**
 * Sheets — the sheet itself: the live Google Sheet, embedded.
 *
 * This replaced a hand-built grid. The grid could render the rows, and nothing
 * else people actually use a spreadsheet for — no formulas, no fill handle, no
 * filter views, no comments, no second cursor. The real editor does all of it,
 * so the real editor is what a sheet shows.
 *
 * THE ONE THING THIS COMPONENT MUST NOT DO IS PRETEND.
 * The frame is cross-origin: no load event we can trust, no readable document,
 * no way to know whether the reader is looking at their data or at Google's
 * "You need access" page. So there is no spinner that resolves, no "couldn't
 * load" state, and no retry that claims to have checked. There is a line of
 * prose under the frame, always visible, that says what it is and what to do if
 * Google asks for access — and an "Open in Google Sheets" button, which is both
 * the escape hatch for serious editing and the thing to press when the frame is
 * showing a wall.
 */

import { Alert, Button, Tag, theme } from "antd";
import { MIcon } from "@/features/app-content-studio/ui";
import { embedAccessNote, sheetEmbedUrl, spreadsheetHref } from "@/lib/sheets/google-embed";
import type { GoogleLinkRow, SheetRecordRow } from "@/lib/sheets/types";

/**
 * The frame is the page's main content, so it takes the height of the viewport
 * minus the app chrome above it rather than a fixed number of pixels. dvh (not
 * vh) because mobile browsers shrink the visual viewport as their toolbars come
 * and go, and vh would leave the last rows under the address bar.
 */
const FRAME_HEIGHT = "clamp(420px, calc(100dvh - 230px), 1400px)";

function Frame({ src, title }: { src: string; title: string }) {
  const { token } = theme.useToken();
  return (
    <iframe
      src={src}
      title={title}
      style={{
        width: "100%",
        height: FRAME_HEIGHT,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 12,
        // Google paints its own white; without this the corners show the page
        // behind them for the second before the frame paints.
        background: "#fff",
        display: "block",
      }}
      // The editor needs the clipboard for copy/paste between sheets, and
      // fullscreen for its own "present" affordances.
      allow="clipboard-read; clipboard-write; fullscreen"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}

/** The always-visible truth line, plus the way out of the frame. */
function EmbedFooter({ link, href }: { link: GoogleLinkRow; href: string | null }) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        fontSize: 12.5,
        color: token.colorTextSecondary,
      }}
    >
      <MIcon name="info" size={15} color={token.colorTextTertiary} />
      <span style={{ flex: "1 1 260px", minWidth: 0 }}>{embedAccessNote(link.owner_email)}</span>
      {href ? (
        <Button
          size="small"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          icon={<MIcon name="open_in_new" size={15} />}
        >
          Open in Google Sheets
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The card a sheet shows when it has no Google Sheet behind it — the state that
 * used to be impossible, because the grid always had something to draw.
 *
 * Three ways to get here, and each needs a different first sentence and a
 * different button:
 *   - no Google account connected (an admin connects one, then provisions);
 *   - provisioning failed (the reason, and try again);
 *   - a sheet made before this existed (just provision it).
 */
function NotProvisioned({
  sheet,
  link,
  canManage,
  hasConnection,
  isAdmin,
  connectHref,
  onProvision,
  onOpenPanel,
  provisioning,
}: {
  sheet: SheetRecordRow;
  link: GoogleLinkRow | null;
  canManage: boolean;
  hasConnection: boolean;
  isAdmin: boolean;
  connectHref: string;
  onProvision: () => void;
  onOpenPanel: () => void;
  provisioning: boolean;
}) {
  const { token } = theme.useToken();
  const failed = link?.provision_status === "failed";

  return (
    <div
      style={{
        border: `1px dashed ${token.colorBorder}`,
        borderRadius: 12,
        padding: "28px 20px",
        display: "grid",
        gap: 14,
        justifyItems: "center",
        textAlign: "center",
        minHeight: 260,
        alignContent: "center",
      }}
    >
      <MIcon name="table_view" size={34} color={token.colorTextQuaternary} />
      <div style={{ display: "grid", gap: 6, maxWidth: 520 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          {failed ? "This sheet's Google Sheet couldn't be created" : "This sheet doesn't have a Google Sheet yet"}
        </div>
        <div style={{ fontSize: 13, color: token.colorTextSecondary }}>
          {failed
            ? (link?.provision_error ?? "Google refused the request.")
            : hasConnection
              ? `“${sheet.name}” lives in Cubes and its rows are safe — it just has no spreadsheet to show yet. Create one and its data is written into it straight away.`
              : "Cubes shows every sheet as a real Google Sheet, so it needs a Google account to create the spreadsheet in. Nothing has been lost: this sheet's rows are in Cubes and will be written into the spreadsheet the moment there is one."}
        </div>
      </div>

      {!canManage ? (
        <div style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
          Ask whoever made this sheet, or a workspace admin, to set up its Google Sheet.
        </div>
      ) : hasConnection ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Button type="primary" loading={provisioning} onClick={onProvision} icon={<MIcon name="add" size={16} />}>
            {failed ? "Try again" : "Create the Google Sheet"}
          </Button>
          <Button onClick={onOpenPanel} icon={<MIcon name="link" size={16} />}>
            Use a sheet I already have
          </Button>
        </div>
      ) : isAdmin ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Button type="primary" href={connectHref} icon={<MIcon name="link" size={16} />}>
            Connect Google
          </Button>
          <Button onClick={onOpenPanel}>Sync options</Button>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
          Ask a workspace admin to connect Google — they do it once for the whole workspace.
        </div>
      )}
    </div>
  );
}

export function SheetEmbed({
  sheet,
  link,
  loading,
  canManage,
  isAdmin,
  hasConnection,
  connectHref,
  onProvision,
  onOpenPanel,
  provisioning,
}: {
  sheet: SheetRecordRow;
  link: GoogleLinkRow | null;
  loading: boolean;
  /** The sheet's creator or a workspace admin — who may provision it. */
  canManage: boolean;
  isAdmin: boolean;
  hasConnection: boolean;
  connectHref: string;
  onProvision: () => void;
  onOpenPanel: () => void;
  provisioning: boolean;
}) {
  const { token } = theme.useToken();

  if (loading) {
    // A plain reserved block, not a skeleton of rows: there are no rows to
    // suggest the shape of any more, and a fake grid flashing before an iframe
    // would be the last impression of the old view we want to leave.
    return (
      <div
        style={{
          height: FRAME_HEIGHT,
          borderRadius: 12,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorFillQuaternary,
        }}
      />
    );
  }

  const src = link && link.provision_status === "ready" ? sheetEmbedUrl(link) : null;
  if (!link || !src) {
    return (
      <NotProvisioned
        sheet={sheet}
        link={link}
        canManage={canManage}
        hasConnection={hasConnection}
        isAdmin={isAdmin}
        connectHref={connectHref}
        onProvision={onProvision}
        onOpenPanel={onOpenPanel}
        provisioning={provisioning}
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {/* A sync that failed is the one thing that can make the frame's contents
          quietly wrong — the cells are real, they are just not current. Say it
          above the sheet rather than hiding it in the Google panel. */}
      {link.last_status === "error" && link.last_error ? (
        <Alert
          type="warning"
          showIcon
          message="The last sync with Cubes failed — what you see here may be out of date"
          description={link.last_error}
          action={
            <Button size="small" onClick={onOpenPanel}>
              Details
            </Button>
          }
        />
      ) : null}
      {/* Sharing is what stands between a colleague and Google's access wall,
          so a share that only half-worked is shown on the sheet, by name. */}
      {link.share_status === "partial" || link.share_status === "failed" ? (
        <Alert
          type="info"
          showIcon
          message={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              Some people can&apos;t open this Google Sheet
              <Tag style={{ margin: 0 }}>{link.share_counts?.left_out?.length ?? 0} without a Google address</Tag>
            </span>
          }
          description={link.share_error}
          action={
            <Button size="small" onClick={onOpenPanel}>
              Who
            </Button>
          }
          closable
        />
      ) : null}
      <Frame src={src} title={`${sheet.name} — Google Sheets`} />
      <EmbedFooter link={link} href={spreadsheetHref(link)} />
    </div>
  );
}
