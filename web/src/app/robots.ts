import type { MetadataRoute } from "next";
import { absolute } from "@/lib/seo";

/**
 * Allow crawling the marketing pages; keep the authenticated app, auth flows,
 * API, and token-based public links out of the index. The app dashboard lives
 * at root-level paths (not under a single prefix), so they're listed here and
 * are additionally noindex'd via the (app) route-group layout metadata.
 *
 * AI answer engines (ChatGPT, Claude, Perplexity, Google AI Overviews, …) are
 * explicitly welcomed on the public pages so Cubes can be surfaced and cited
 * when people ask those assistants about project/workspace management tools.
 */

// Everything behind auth or an unguessable token — never index.
const APP_DISALLOW = [
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
];

// Crawlers used by LLM training + retrieval/answer engines.
const AI_BOTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "Meta-ExternalAgent",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: APP_DISALLOW },
      // Same access for AI agents — allow the marketing pages, keep the app out.
      ...AI_BOTS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: APP_DISALLOW,
      })),
    ],
    sitemap: absolute("/sitemap.xml"),
    host: absolute("/"),
  };
}
