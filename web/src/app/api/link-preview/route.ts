import { NextResponse, type NextRequest } from "next/server";

/**
 * Fetches a URL and extracts Open Graph / basic metadata for a link-preview
 * card. Used by the rich task description editor. Returns { title, description,
 * image, siteName, url } — best-effort; missing fields are null.
 */

export const runtime = "nodejs";

interface Preview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

/** Blocks obvious SSRF targets (localhost / private ranges / non-http). */
function isSafePublicUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "[::1]"
  ) {
    return null;
  }
  return u;
}

function metaContent(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

/** Builds regexes matching <meta property="og:x" content="..."> in any order. */
function ogPatterns(prop: string): RegExp[] {
  const p = prop.replace(/[:]/g, "\\:");
  return [
    new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, "i"),
  ];
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "Missing url." }, { status: 400 });
  }
  const safe = isSafePublicUrl(target);
  if (!safe) {
    return NextResponse.json({ error: "URL not allowed." }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(safe.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Some sites gate og tags behind a real UA.
        "User-Agent": "Mozilla/5.0 (compatible; CubesLinkPreview/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeout);
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.includes("text/html")) {
      // Not an HTML page (e.g. an image or PDF) — return a minimal preview.
      const preview: Preview = {
        url: safe.toString(),
        title: null,
        description: null,
        image: type.startsWith("image/") ? safe.toString() : null,
        siteName: safe.hostname,
      };
      return NextResponse.json(preview, { headers: { "Cache-Control": "public, max-age=3600" } });
    }
    // Read a bounded amount of the body — <head> is near the top.
    const html = (await res.text()).slice(0, 200_000);

    const rawTitle =
      metaContent(html, ogPatterns("og:title")) ??
      metaContent(html, [/<title[^>]*>([^<]+)<\/title>/i]);
    let image = metaContent(html, [...ogPatterns("og:image"), ...ogPatterns("twitter:image")]);
    if (image) {
      try {
        image = new URL(image, safe).toString();
      } catch {
        image = null;
      }
    }

    const preview: Preview = {
      url: safe.toString(),
      title: rawTitle,
      description:
        metaContent(html, [...ogPatterns("og:description"), ...ogPatterns("description")]),
      image,
      siteName: metaContent(html, ogPatterns("og:site_name")) ?? safe.hostname,
    };
    return NextResponse.json(preview, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    clearTimeout(timeout);
    return NextResponse.json(
      { url: safe.toString(), title: null, description: null, image: null, siteName: safe.hostname },
      { status: 200 },
    );
  }
}
