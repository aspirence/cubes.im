"use client";

import { useState } from "react";
import { App, Avatar, Button, Input, Modal, Switch, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  useVideoShare,
  useCreateOrEnableShare,
  useUpdateShare,
  useVideoShareSessions,
} from "@/features/app-video-review/use-video-review";
import { useVR } from "@/features/app-video-review/vr-theme";
import { errMsg } from "@/lib/err";

dayjs.extend(relativeTime);

const { Text } = Typography;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** A soft palette of avatar tints, picked deterministically per reviewer. */
const AVATAR_TINTS = ["#4a4ad0", "#0e9f6e", "#d97706", "#db2777", "#0891b2", "#7c3aed"];
function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

function ToggleRow({
  icon,
  title,
  desc,
  checked,
  loading,
  onChange,
}: {
  icon: string;
  title: string;
  desc: string;
  checked: boolean;
  loading?: boolean;
  onChange: (v: boolean) => void;
}) {
  const VR = useVR();
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <span
        className="material-symbols-rounded"
        aria-hidden
        style={{ fontSize: 19, color: VR.textTertiary, marginTop: 1 }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: VR.text }}>{title}</div>
        <div style={{ fontSize: 12, color: VR.textTertiary, lineHeight: 1.45 }}>{desc}</div>
      </div>
      <Switch size="small" checked={checked} loading={loading} onChange={onChange} />
    </div>
  );
}

/**
 * "Publish for client review" — turns a video into a public, unguessable link
 * a client opens without a Cubes account. Shows the link + copy, the two
 * privacy toggles, and the roster of who has opened it (name + visit count).
 */
export function ShareReviewModal({
  open,
  onClose,
  videoId,
}: {
  open: boolean;
  onClose: () => void;
  videoId: string;
}) {
  const VR = useVR();
  const { message } = App.useApp();
  const { data: share, isLoading } = useVideoShare(videoId);
  const createShare = useCreateOrEnableShare(videoId);
  const updateShare = useUpdateShare(videoId);
  const { data: sessions } = useVideoShareSessions(share?.id, open && Boolean(share));
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = share ? `${origin}/review/${share.token}` : "";
  const published = Boolean(share);
  const live = Boolean(share?.active);

  const create = async () => {
    try {
      await createShare.mutateAsync();
    } catch (err) {
      message.error(errMsg(err, "Couldn't create the review link."));
    }
  };

  const patch = async (input: {
    active?: boolean;
    allow_download?: boolean;
    require_name?: boolean;
    reviewer_name?: string | null;
  }) => {
    if (!share) return;
    try {
      await updateShare.mutateAsync({ id: share.id, ...input });
    } catch (err) {
      message.error(errMsg(err, "Couldn't update the link."));
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      message.error("Couldn't copy — select and copy the link manually.");
    }
  };

  const totalVisits = (sessions ?? []).reduce((n, s) => n + s.visit_count, 0);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 20, color: VR.accent }}>
            share
          </span>
          Share for client review
        </span>
      }
      footer={
        <Button type="primary" onClick={onClose}>
          Done
        </Button>
      }
      width={520}
      destroyOnHidden
    >
      {isLoading ? (
        <div style={{ padding: "20px 0", color: VR.textTertiary }}>Loading…</div>
      ) : !published ? (
        // ---- Not yet published -------------------------------------------
        <div style={{ padding: "10px 0 4px" }}>
          <div
            style={{
              display: "flex",
              gap: 12,
              padding: 14,
              borderRadius: 12,
              background: VR.accentSoft,
              marginBottom: 16,
            }}
          >
            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 22, color: VR.accent }}>
              link
            </span>
            <Text style={{ fontSize: 13, color: VR.textSecondary, lineHeight: 1.55 }}>
              Create a private link your client can open — no account needed. They
              add their name once, then leave timestamped comments that show up
              here against that name.
            </Text>
          </div>
          <Button
            type="primary"
            block
            size="large"
            loading={createShare.isPending}
            onClick={create}
            icon={
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                add_link
              </span>
            }
          >
            Create review link
          </Button>
        </div>
      ) : (
        // ---- Published ----------------------------------------------------
        <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 6 }}>
          {/* The link */}
          <div>
            <div style={{ display: "flex", gap: 8 }}>
              <Input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                style={{ fontSize: 12.5, opacity: live ? 1 : 0.5 }}
                prefix={
                  <span
                    className="material-symbols-rounded"
                    aria-hidden
                    style={{ fontSize: 15, color: VR.textTertiary }}
                  >
                    {live ? "public" : "link_off"}
                  </span>
                }
              />
              <Button type="primary" onClick={copy} disabled={!live}>
                {copied ? "Copied!" : "Copy"}
              </Button>
              <Tooltip title="Open in a new tab">
                <Button
                  href={live ? link : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  disabled={!live}
                  icon={
                    <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
                      open_in_new
                    </span>
                  }
                />
              </Tooltip>
            </div>
            <Text style={{ fontSize: 11.5, color: VR.textTertiary, marginTop: 6, display: "block" }}>
              {live
                ? "Anyone with this link can watch and comment."
                : "Sharing is paused — the link won’t open for anyone."}
            </Text>
          </div>

          {/* Toggles */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              padding: 14,
              borderRadius: 12,
              border: `1px solid ${VR.hairline}`,
              background: VR.panel,
            }}
          >
            <ToggleRow
              icon={live ? "toggle_on" : "toggle_off"}
              title="Link is live"
              desc="Turn off to pause the link without deleting it."
              checked={live}
              loading={updateShare.isPending}
              onChange={(v) => void patch({ active: v })}
            />
            <div style={{ height: 1, background: VR.hairline }} />
            <ToggleRow
              icon="badge"
              title="Ask for the reviewer’s name"
              desc="Clients enter who they are before commenting."
              checked={Boolean(share?.require_name)}
              onChange={(v) => void patch({ require_name: v })}
            />
            {share && !share.require_name ? (
              // Not asking the client → the team names the reviewer here.
              <div style={{ paddingLeft: 29, marginTop: -4 }}>
                <Input
                  key={share.id}
                  size="small"
                  defaultValue={share.reviewer_name ?? ""}
                  placeholder="e.g. Acme Client"
                  maxLength={80}
                  prefix={
                    <span
                      className="material-symbols-rounded"
                      aria-hidden
                      style={{ fontSize: 14, color: VR.textTertiary }}
                    >
                      person
                    </span>
                  }
                  onPressEnter={(e) => e.currentTarget.blur()}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if ((share.reviewer_name ?? "") !== v)
                      void patch({ reviewer_name: v || null });
                  }}
                />
                <div style={{ fontSize: 11, color: VR.textTertiary, marginTop: 4 }}>
                  Comments will be attributed to this name. Leave empty to use “Guest”.
                </div>
              </div>
            ) : null}
            <ToggleRow
              icon="download"
              title="Allow download"
              desc="Show a download button on the review page."
              checked={Boolean(share?.allow_download)}
              onChange={(v) => void patch({ allow_download: v })}
            />
          </div>

          {/* Sessions */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Text strong style={{ fontSize: 13, color: VR.text }}>
                Client activity
              </Text>
              {sessions && sessions.length > 0 ? (
                <span
                  style={{
                    fontSize: 11,
                    color: VR.accent,
                    background: VR.accentSoft,
                    borderRadius: 999,
                    padding: "1px 8px",
                    fontWeight: 600,
                  }}
                >
                  {sessions.length} {sessions.length === 1 ? "reviewer" : "reviewers"} · {totalVisits} visits
                </span>
              ) : null}
            </div>

            {!sessions || sessions.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "22px 12px",
                  borderRadius: 10,
                  border: `1px dashed ${VR.hairline}`,
                  color: VR.textTertiary,
                  fontSize: 12.5,
                }}
              >
                No one has opened the link yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "7px 8px",
                      borderRadius: 9,
                    }}
                  >
                    <Avatar
                      size={30}
                      style={{ background: tintFor(s.name), fontSize: 12, flex: "none" }}
                    >
                      {initials(s.name)}
                    </Avatar>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: VR.text,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: VR.textTertiary }}>
                        Last seen {dayjs(s.last_seen_at).fromNow()}
                      </div>
                    </div>
                    <Tooltip title={`${s.visit_count} ${s.visit_count === 1 ? "visit" : "visits"}`}>
                      <span
                        style={{
                          flex: "none",
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: VR.textSecondary,
                          background: VR.panelSoft,
                          borderRadius: 999,
                          padding: "2px 9px",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        ×{s.visit_count}
                      </span>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
