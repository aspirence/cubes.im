/**
 * A review revision can be an uploaded file (served as a direct, signed URL) or
 * an external LINK the team pasted. A raw provider link — YouTube, Vimeo, Google
 * Drive, Loom, Dropbox share pages — is an HTML page, not a media file, so it
 * plays as a black `<video>`. This resolves a link to either a file the
 * `<video>` element can play, or an embeddable page for an `<iframe>`.
 */

export type MediaSource =
  | { kind: "file"; url: string }
  | { kind: "embed"; url: string; provider: string };

/** Direct-media extensions that always play in a `<video>` element. */
const FILE_EXT_RE = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi)(\?|#|$)/i;

/**
 * Classify a source URL. Uploaded revisions arrive here as a signed storage URL
 * and fall through to `file`; only pasted provider links get rewritten to an
 * embed. Anything unrecognised is treated as a direct file (best effort — the
 * player shows an "open original" fallback if it can't load).
 */
export function resolveVideoSource(raw: string | null | undefined): MediaSource | null {
  if (!raw) return null;
  const url = raw.trim();
  if (!url) return null;

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "file", url };
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  // Dropbox share page -> raw bytes for a real <video>. Handled before the
  // extension check because the share URL itself ends in .mp4 but isn't a file.
  if (host === "dropbox.com") {
    u.hostname = "dl.dropboxusercontent.com";
    u.searchParams.delete("dl");
    u.searchParams.set("raw", "1");
    return { kind: "file", url: u.toString() };
  }

  // A recognisable direct-media extension always wins (even on a CDN host).
  if (FILE_EXT_RE.test(u.pathname)) return { kind: "file", url };

  // YouTube ----------------------------------------------------------------
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const id =
      u.searchParams.get("v") ||
      (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live" ? parts[1] : null);
    if (id) return { kind: "embed", url: `https://www.youtube.com/embed/${id}`, provider: "YouTube" };
  }
  if (host === "youtu.be" && parts[0]) {
    return { kind: "embed", url: `https://www.youtube.com/embed/${parts[0]}`, provider: "YouTube" };
  }

  // Vimeo ------------------------------------------------------------------
  if (host === "player.vimeo.com") return { kind: "embed", url, provider: "Vimeo" };
  if (host === "vimeo.com") {
    // vimeo.com/123456789  or  vimeo.com/123456789/abcdef (unlisted hash)
    const id = parts[0];
    const hash = parts[1];
    if (id && /^\d+$/.test(id)) {
      const embed = hash
        ? `https://player.vimeo.com/video/${id}?h=${hash}`
        : `https://player.vimeo.com/video/${id}`;
      return { kind: "embed", url: embed, provider: "Vimeo" };
    }
  }

  // Google Drive — share links, open?id=, uc?id=, the newer
  // drive.usercontent.google.com/download?id=, and legacy docs.google.com.
  if (
    host === "drive.google.com" ||
    host === "docs.google.com" ||
    host === "drive.usercontent.google.com"
  ) {
    const idFromPath = parts[0] === "file" && parts[1] === "d" ? parts[2] : null;
    const id = idFromPath || u.searchParams.get("id");
    if (id) return { kind: "embed", url: `https://drive.google.com/file/d/${id}/preview`, provider: "Google Drive" };
  }

  // Loom -------------------------------------------------------------------
  if (host === "loom.com" && (parts[0] === "share" || parts[0] === "embed") && parts[1]) {
    return { kind: "embed", url: `https://www.loom.com/embed/${parts[1]}`, provider: "Loom" };
  }

  // Streamable -------------------------------------------------------------
  if (host === "streamable.com" && parts[0]) {
    const id = parts[0] === "e" ? parts[1] : parts[0];
    if (id) return { kind: "embed", url: `https://streamable.com/e/${id}`, provider: "Streamable" };
  }

  // Wistia -----------------------------------------------------------------
  if ((host.endsWith("wistia.com") || host.endsWith("wistia.net")) && parts.includes("medias")) {
    const id = parts[parts.indexOf("medias") + 1];
    if (id) return { kind: "embed", url: `https://fast.wistia.net/embed/iframe/${id}`, provider: "Wistia" };
  }

  // Unknown — try to play it directly; the UI offers "open original" if it fails.
  return { kind: "file", url };
}
