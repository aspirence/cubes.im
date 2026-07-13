import type { MetadataRoute } from "next";
import { absolute } from "@/lib/seo";

/**
 * Allow crawling the marketing pages; keep the authenticated app, auth flows,
 * API, and token-based public links out of the index. The app dashboard lives
 * at root-level paths (not under a single prefix), so they're listed here and
 * are additionally noindex'd via the (app) route-group layout metadata.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/auth/",
        "/login",
        "/signup",
        "/setup",
        "/home",
        "/projects",
        "/schedule",
        "/chat",
        "/people",
        "/reporting",
        "/settings",
        "/hr",
        "/admin-center",
        "/workflows",
        "/apps",
        "/portal/",
        "/share/",
      ],
    },
    sitemap: absolute("/sitemap.xml"),
    host: absolute("/"),
  };
}
