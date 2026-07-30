"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp } from "antd";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { createClient } from "@/lib/supabase/client";
import { resolveVideoSource } from "@/features/app-video-review/media-source";

dayjs.extend(relativeTime);

/* ------------------------------------------------------------------ types */

export interface ReviewComment {
  id: string;
  revision: number;
  time_ms: number;
  body: string;
  resolved: boolean;
  created_at: string;
  author_name: string;
  is_guest: boolean;
}
export interface ReviewRevision {
  revision: number;
  summary: string | null;
  has_source: boolean;
  /** External link for URL-based revisions; null for uploaded files. */
  source_url?: string | null;
}
export interface ReviewShareData {
  share: { allow_download: boolean; require_name: boolean; reviewer_name: string | null };
  video: {
    id: string;
    title: string;
    status: string;
    latest_revision: number;
    project_name: string | null;
  };
  revisions: ReviewRevision[];
  comments: ReviewComment[];
}

/* ---------------------------------------------------------------- palette */
// Deliberately fixed & light — a clean, predictable client experience that
// doesn't inherit a reviewer's dark-mode toggle.
const C = {
  bg: "#f7f7f9",
  panel: "#ffffff",
  hairline: "#eceef2",
  hairlineSoft: "#f2f3f6",
  text: "#17171c",
  textSecondary: "#55565f",
  textTertiary: "#8a8c96",
  accent: "#4a4ad0",
  accentSoft: "#eef0ff",
  fill: "#f4f5f8",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  changes_requested: "Changes requested",
};

const AVATAR_TINTS = ["#4a4ad0", "#0e9f6e", "#d97706", "#db2777", "#0891b2", "#7c3aed"];
function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}
function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ------------------------------------------------------------ local ident */

function keyFor(token: string, k: string) {
  return `cubes.review.${token}.${k}`;
}
function ensureVisitorKey(token: string): string {
  const k = keyFor(token, "visitor");
  let v = localStorage.getItem(k);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(k, v);
  }
  return v;
}

/* ================================================================ component */

export function ReviewApp({ data, token }: { data: ReviewShareData; token: string }) {
  const { message } = AntdApp.useApp();
  const supabase = useMemo(() => createClient(), []);
  // The share RPCs aren't in the generated types yet. Wrap them as MEMBER calls
  // (db.rpc) so supabase-js keeps its `this` binding — a detached `supabase.rpc`
  // reference throws at call time.
  const rpc = useMemo(() => {
    const db = supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    return (fn: string, args: Record<string, unknown>) => db.rpc(fn, args);
  }, [supabase]);

  // Live copy — polls so the client sees the team's (and other reviewers')
  // replies, seeded from the server-rendered data.
  const { data: live, refetch } = useQuery({
    queryKey: ["public-review", token],
    initialData: data,
    refetchInterval: 25_000,
    queryFn: async (): Promise<ReviewShareData> => {
      const { data: d, error } = await rpc("get_video_review_share", { p_token: token });
      if (error) throw new Error(error.message);
      // A paused/removed link returns null — keep the last good view rather
      // than blanking the page mid-session.
      if (!d) throw new Error("paused");
      return d as ReviewShareData;
    },
  });
  const view = live ?? data;

  const revisions = view.revisions ?? [];
  const [rev, setRev] = useState<number>(view.video.latest_revision);
  const currentRev = revisions.find((r) => r.revision === rev) ?? revisions[0];
  const hasSource = currentRev?.has_source ?? false;

  // Identity ---------------------------------------------------------------
  // Seed the reviewer's name from localStorage on the first render (a returning
  // visitor skips the name gate). No stored value on the server -> the gate is
  // the deterministic initial tree.
  const hasWindow = typeof window !== "undefined";
  const storedName = hasWindow ? localStorage.getItem(keyFor(token, "name")) : null;
  const storedSession = hasWindow ? localStorage.getItem(keyFor(token, "session")) : null;
  // When the client isn't asked, the team's preset name (or "Guest") is used —
  // so the name gate is skipped entirely and there's never a null name.
  const presetName = data.share.reviewer_name?.trim() || "";
  const initialName = data.share.require_name
    ? storedName
    : presetName || storedName || "Guest";
  const [name, setName] = useState<string | null>(initialName);
  // Seed the session so a returning reviewer can comment without waiting for the
  // record round-trip; the effect below still refreshes/validates it.
  const [sessionId, setSessionId] = useState<string | null>(storedSession);
  const [nameDraft, setNameDraft] = useState(storedName ?? "");
  const [identifying, setIdentifying] = useState(false);
  const recordedRef = useRef(false);

  // Record (or refresh) the visit once per load, as soon as a name is known.
  useEffect(() => {
    if (recordedRef.current || !name) return;
    recordedRef.current = true;
    const visitorKey = ensureVisitorKey(token);
    void rpc("record_video_review_visit", {
      p_token: token,
      p_name: name,
      p_visitor_key: visitorKey,
    }).then(({ data: sid, error }) => {
      if (error) {
        recordedRef.current = false;
        return;
      }
      if (typeof sid === "string") {
        setSessionId(sid);
        localStorage.setItem(keyFor(token, "session"), sid);
      }
    });
  }, [name, token, rpc]);

  const submitName = async (proposed: string) => {
    const clean = proposed.trim().slice(0, 80);
    if (!clean) {
      message.warning("Please enter your name.");
      return;
    }
    setIdentifying(true);
    try {
      const visitorKey = ensureVisitorKey(token);
      const { data: sid, error } = await rpc("record_video_review_visit", {
        p_token: token,
        p_name: clean,
        p_visitor_key: visitorKey,
      });
      if (error) throw new Error(error.message);
      recordedRef.current = true;
      localStorage.setItem(keyFor(token, "name"), clean);
      if (typeof sid === "string") {
        setSessionId(sid);
        localStorage.setItem(keyFor(token, "session"), sid);
      }
      setName(clean);
    } catch {
      message.error("Couldn't start the session. Please try again.");
    } finally {
      setIdentifying(false);
    }
  };

  // Player + composer ------------------------------------------------------
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const seek = (ms: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = ms / 1000;
      void videoRef.current.play().catch(() => {});
    }
  };

  const submitComment = async () => {
    const text = body.trim();
    if (!text) return;
    if (!sessionId) {
      message.warning("Add your name first.");
      return;
    }
    setPosting(true);
    try {
      const { error } = await rpc("add_video_review_guest_comment", {
        p_token: token,
        p_session_id: sessionId,
        p_revision: rev,
        p_body: text,
        p_time_ms: Math.round(currentTime * 1000),
      });
      if (error) throw new Error(error.message);
      setBody("");
      // Refresh so the new comment (and any others) appear in order.
      await refetch();
    } catch {
      message.error("Couldn't post your comment.");
    } finally {
      setPosting(false);
    }
  };

  const commentsForRev = (view.comments ?? []).filter((c) => c.revision === rev);
  // Uploaded revisions stream through the signed route; a pasted link resolves
  // to a provider embed (iframe) or a direct file the <video> can play.
  const media = resolveVideoSource(currentRev?.source_url ?? null);
  const isEmbed = media?.kind === "embed";
  const isUnsupported = media?.kind === "unsupported";
  const streamSrc = `/api/review/${token}/video?rev=${rev}`;
  const fileSrc = media?.kind === "file" ? media.url : streamSrc;

  // ---- Name gate ---------------------------------------------------------
  // Only reached when the client IS asked for a name and hasn't given one yet;
  // when names aren't required, `name` is pre-resolved (preset/Guest) above.
  if (!name) {
    return (
      <NameGate
        title={view.video.title}
        projectName={view.video.project_name}
        value={nameDraft}
        onChange={setNameDraft}
        loading={identifying}
        onSubmit={() => void submitName(nameDraft)}
      />
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          background: C.panel,
          borderBottom: `1px solid ${C.hairline}`,
          position: "sticky",
          top: 0,
          zIndex: 5,
          flexWrap: "wrap",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            flex: "none",
            background: "linear-gradient(140deg, #34346a 0%, #4a4ad0 100%)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 18, color: "#fff" }}>
            movie
          </span>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {view.video.title}
          </div>
          <div style={{ fontSize: 12, color: C.textTertiary }}>
            {view.video.project_name ? `${view.video.project_name} · ` : ""}
            {STATUS_LABEL[view.video.status] ?? view.video.status}
          </div>
        </div>

        {revisions.length > 1 ? (
          <select
            value={rev}
            onChange={(e) => setRev(Number(e.target.value))}
            style={{
              height: 32,
              borderRadius: 8,
              border: `1px solid ${C.hairline}`,
              background: C.panel,
              color: C.text,
              padding: "0 10px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {revisions.map((r) => (
              <option key={r.revision} value={r.revision}>
                Version v{r.revision}
              </option>
            ))}
          </select>
        ) : null}

        {view.share.allow_download && hasSource && !isEmbed ? (
          <a
            href={fileSrc}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 32,
              padding: "0 12px",
              borderRadius: 8,
              border: `1px solid ${C.hairline}`,
              color: C.textSecondary,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
              download
            </span>
            Download
          </a>
        ) : null}

        {name ? (
          <span
            title={`Reviewing as ${name}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: tintFor(name),
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {initials(name)}
            </span>
          </span>
        ) : null}
      </header>

      {/* Body */}
      <div className="rv-grid">
        {/* Player */}
        <section className="rv-player">
          <div
            style={{
              background: "#000",
              borderRadius: 14,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              aspectRatio: "16 / 9",
            }}
          >
            {!hasSource ? (
              <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
                No video for this version.
              </div>
            ) : isEmbed && media ? (
              <iframe
                key={rev}
                src={media.url}
                title={view.video.title}
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                allowFullScreen
                style={{ width: "100%", height: "100%", border: 0 }}
              />
            ) : isUnsupported && media ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  padding: 24,
                  textAlign: "center",
                  color: "rgba(255,255,255,0.72)",
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 32 }}>
                  videocam_off
                </span>
                <div style={{ fontWeight: 600, color: "#fff" }}>Video isn’t available to play here</div>
                <a
                  href={media.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    marginTop: 4,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    border: "1px solid rgba(255,255,255,0.3)",
                    borderRadius: 8,
                    padding: "6px 14px",
                  }}
                >
                  Open link ↗
                </a>
              </div>
            ) : (
              <video
                key={rev}
                ref={videoRef}
                src={fileSrc}
                controls
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
              />
            )}
          </div>
          {currentRev?.summary ? (
            <p style={{ marginTop: 10, fontSize: 13, color: C.textSecondary }}>
              <span style={{ fontWeight: 600 }}>v{rev}:</span> {currentRev.summary}
            </p>
          ) : null}
        </section>

        {/* Comments */}
        <aside className="rv-side">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 2px 10px",
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 19, color: C.accent }}>
              chat_bubble
            </span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Comments</span>
            <span style={{ color: C.textTertiary, fontSize: 13 }}>{commentsForRev.length}</span>
          </div>

          {/* Composer */}
          <div
            style={{
              background: C.panel,
              border: `1px solid ${C.hairline}`,
              borderRadius: 12,
              padding: 10,
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span
                style={{
                  fontVariantNumeric: "tabular-nums",
                  background: C.accentSoft,
                  color: C.accent,
                  borderRadius: 6,
                  padding: "1px 7px",
                  fontSize: 11.5,
                  fontWeight: 600,
                }}
              >
                @ {fmt(currentTime)}
              </span>
              <span style={{ fontSize: 11.5, color: C.textTertiary }}>
                pins to the current frame
              </span>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add your feedback…"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitComment();
                }
              }}
              style={{
                width: "100%",
                resize: "vertical",
                minHeight: 46,
                border: `1px solid ${C.hairline}`,
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 13.5,
                fontFamily: "inherit",
                color: C.text,
                outline: "none",
                background: C.panel,
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button
                type="button"
                onClick={() => void submitComment()}
                disabled={!body.trim() || posting}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "7px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: body.trim() && !posting ? "pointer" : "not-allowed",
                  color: "#fff",
                  background: body.trim() && !posting ? C.accent : "#b9b9e4",
                }}
              >
                {posting ? "Posting…" : "Comment"}
              </button>
            </div>
          </div>

          {/* List */}
          {commentsForRev.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 16px",
                color: C.textTertiary,
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 15,
                  background: C.fill,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 10,
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 24 }}>
                  reviews
                </span>
              </div>
              <div style={{ fontWeight: 600, color: C.text }}>No comments yet</div>
              <div style={{ fontSize: 12.5 }}>Scrub to a moment and leave the first note.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {commentsForRev.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    gap: 9,
                    padding: 9,
                    borderRadius: 10,
                    opacity: c.resolved ? 0.55 : 1,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      flex: "none",
                      borderRadius: "50%",
                      background: tintFor(c.author_name),
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {initials(c.author_name || "?")}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{c.author_name}</span>
                      {!c.is_guest ? (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: C.textTertiary,
                            background: C.fill,
                            borderRadius: 999,
                            padding: "0 6px",
                          }}
                        >
                          Team
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => seek(c.time_ms)}
                        style={{
                          border: "none",
                          background: C.accentSoft,
                          color: C.accent,
                          borderRadius: 5,
                          padding: "0 6px",
                          fontSize: 11,
                          cursor: "pointer",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {fmt(c.time_ms / 1000)}
                      </button>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 11, color: C.textTertiary }}>
                        {dayjs(c.created_at).fromNow()}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 13.5,
                        color: C.text,
                        marginTop: 2,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        textDecoration: c.resolved ? "line-through" : "none",
                      }}
                    >
                      {c.body}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      <footer
        style={{
          textAlign: "center",
          padding: "20px 16px 28px",
          color: C.textTertiary,
          fontSize: 12,
        }}
      >
        Powered by{" "}
        <a href="https://cubes.im" target="_blank" rel="noopener noreferrer" style={{ color: C.accent, fontWeight: 600 }}>
          Cubes
        </a>
      </footer>

      <style>{`
        .rv-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 380px;
          gap: 18px;
          max-width: 1320px;
          margin: 0 auto;
          padding: 18px 16px 8px;
          align-items: start;
        }
        .rv-side {
          position: sticky;
          top: 74px;
          max-height: calc(100vh - 96px);
          overflow-y: auto;
        }
        @media (max-width: 900px) {
          .rv-grid { grid-template-columns: 1fr; gap: 14px; }
          .rv-side { position: static; max-height: none; overflow: visible; }
        }
      `}</style>
    </main>
  );
}

/* --------------------------------------------------------------- name gate */

function NameGate({
  title,
  projectName,
  value,
  onChange,
  loading,
  onSubmit,
}: {
  title: string;
  projectName: string | null;
  value: string;
  onChange: (v: string) => void;
  loading: boolean;
  onSubmit: () => void;
}) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: C.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: C.panel,
          border: `1px solid ${C.hairline}`,
          borderRadius: 18,
          padding: 28,
          boxShadow: "0 20px 60px -30px rgba(16,24,40,0.35)",
          textAlign: "center",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 52,
            height: 52,
            borderRadius: 15,
            margin: "0 auto 16px",
            background: "linear-gradient(140deg, #34346a 0%, #4a4ad0 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 26, color: "#fff" }}>
            movie
          </span>
        </div>
        <h1 style={{ fontSize: 19, fontWeight: 800, color: C.text, margin: "0 0 4px" }}>
          You’re invited to review
        </h1>
        <p style={{ fontSize: 13.5, color: C.textSecondary, margin: "0 0 2px", lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600, color: C.text }}>{title}</span>
          {projectName ? ` · ${projectName}` : ""}
        </p>
        <p style={{ fontSize: 12.5, color: C.textTertiary, margin: "0 0 20px" }}>
          Tell us your name so the team knows who left each comment.
        </p>
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
          placeholder="Your name"
          maxLength={80}
          style={{
            width: "100%",
            height: 44,
            border: `1px solid ${C.hairline}`,
            borderRadius: 10,
            padding: "0 14px",
            fontSize: 14.5,
            color: C.text,
            outline: "none",
            textAlign: "center",
            background: C.panel,
          }}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || !value.trim()}
          style={{
            width: "100%",
            height: 44,
            marginTop: 12,
            border: "none",
            borderRadius: 10,
            fontSize: 14.5,
            fontWeight: 700,
            color: "#fff",
            cursor: loading || !value.trim() ? "not-allowed" : "pointer",
            background: !value.trim() || loading ? "#b9b9e4" : C.accent,
          }}
        >
          {loading ? "Starting…" : "Start reviewing"}
        </button>
      </div>
    </main>
  );
}
