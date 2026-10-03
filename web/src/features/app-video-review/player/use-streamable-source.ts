"use client";

import { useQuery } from "@tanstack/react-query";
import { resolveVideoSource, type MediaSource } from "../media-source";

/**
 * A Google Drive video normally plays through Drive's own `/preview` iframe,
 * which is cross-origin: we cannot read `currentTime`, so timestamped comments
 * and frame drawings — the entire point of this app — are impossible on exactly
 * the videos most clients send.
 *
 * The fix is to stream the Drive bytes through our own endpoint into our own
 * `<video>`, where the playhead is ours again. That endpoint needs the team's
 * Google connection and a file the connection is allowed to read, so it can
 * legitimately be unavailable; rather than guess, we ask it with a one-byte
 * range request and fall back to the iframe when the answer is no.
 */

export interface StreamableSource {
  /** What the stage should actually play. */
  source: MediaSource | null;
  /** True when we are playing our own stream, so timecodes are trustworthy. */
  streaming: boolean;
  /** Set when we had to fall back; one line the UI can show under the stage. */
  degradedReason: string | null;
  probing: boolean;
}

function streamUrl(videoId: string, revision: number): string {
  return `/api/video-review/${videoId}/stream?revision=${revision}`;
}

/**
 * Asks the stream endpoint whether it can serve this revision. A 200/206 with a
 * media content type is a yes; anything else (including the route not existing
 * yet) is a no, and never an error the viewer has to see.
 */
async function probeStream(url: string): Promise<{ ok: boolean; reason: string | null }> {
  try {
    // A one-byte range keeps the probe cheap even for a multi-GB master, and
    // proves the endpoint supports the range requests seeking depends on.
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      cache: "no-store",
    });
    if (res.status === 200 || res.status === 206) {
      const type = res.headers.get("content-type") ?? "";
      if (type.startsWith("video/") || type === "application/octet-stream") {
        return { ok: true, reason: null };
      }
      return { ok: false, reason: null };
    }
    if (res.status === 409) {
      // The endpoint says a person has to act (reconnect Google, or pick the
      // file again). Its message is written for this reader, so pass it on.
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, reason: body?.error ?? null };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason:
          "Cubes can’t open this Drive file yet — connect Google in Settings and pick the file, and comments become frame-timed.",
      };
    }
    return { ok: false, reason: null };
  } catch {
    return { ok: false, reason: null };
  }
}

/**
 * Resolves the URL of a revision into what the player should show, upgrading a
 * Google Drive embed to our own stream whenever the backend can serve it.
 */
export function useStreamableSource(
  videoId: string | undefined,
  revision: number,
  playUrl: string | null | undefined,
): StreamableSource {
  const media = resolveVideoSource(playUrl);
  // Only Drive links are worth probing: every other embed (YouTube, Vimeo,
  // Loom) is a hosted player we are not allowed to pull bytes out of.
  const isDrive =
    (media?.kind === "embed" || media?.kind === "unsupported") &&
    media.provider === "Google Drive";
  const canProbe = Boolean(videoId) && isDrive;

  const { data, isLoading } = useQuery({
    queryKey: ["video-review-stream", videoId, revision, playUrl ?? null],
    enabled: canProbe,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: () => probeStream(streamUrl(videoId as string, revision)),
  });

  if (!isDrive || !videoId) {
    return {
      source: media,
      streaming: false,
      degradedReason:
        media?.kind === "embed"
          ? `This is a ${media.provider} player, so Cubes can’t read its playhead — comments here aren’t frame-timed. Upload the file (or paste a direct link) for timestamped notes.`
          : null,
      probing: false,
    };
  }

  if (data?.ok) {
    return {
      source: { kind: "file", url: streamUrl(videoId, revision) },
      streaming: true,
      degradedReason: null,
      probing: false,
    };
  }

  return {
    source: media,
    streaming: false,
    // A folder link already explains itself on the stage; a second line under
    // it would just repeat the same advice in different words.
    degradedReason: isLoading || media?.kind === "unsupported"
      ? null
      : (data?.reason ??
        "Playing through Google Drive’s own player, which doesn’t expose the playhead — comments on this version aren’t frame-timed. Import the file into Cubes (or upload it) for timestamped notes."),
    probing: isLoading,
  };
}
