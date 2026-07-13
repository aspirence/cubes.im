import type { Metadata } from "next";

/**
 * Central SEO configuration for the marketing site. The production origin can
 * be overridden with NEXT_PUBLIC_SITE_URL; it defaults to the canonical domain.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://cubes.im"
).replace(/\/$/, "");

export const SITE_NAME = "Cubes";
export const SITE_TITLE = "Cubes — One workspace for everything you run";
export const SITE_TAGLINE = "One workspace for everything you run";
export const SITE_DESCRIPTION =
  "Cubes is the open-source, all-in-one workspace for teams — projects, docs, video review, client portals, and people ops behind a single login. Free to start.";

export const SITE_KEYWORDS = [
  "project management",
  "open source project management",
  "all-in-one workspace",
  "team collaboration software",
  "task management",
  "docs and wikis",
  "video review software",
  "client portal",
  "workflow automation",
  "people ops",
  "HR software",
  "ClickUp alternative",
  "Asana alternative",
  "Notion alternative",
  "Cubes",
];

/** Absolute URL for a site-relative path. */
export function absolute(path = "/"): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Builds a page's Metadata with a canonical URL and Open Graph/Twitter that
 * inherit the site defaults but override title/description. Use from a route's
 * server `layout.tsx` (the marketing pages are client components and can't
 * export metadata themselves).
 */
export function pageMetadata(opts: {
  path: string;
  title: string;
  description?: string;
}): Metadata {
  const description = opts.description ?? SITE_DESCRIPTION;
  const url = absolute(opts.path);
  return {
    title: opts.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      siteName: SITE_NAME,
      title: `${opts.title} · ${SITE_NAME}`,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title: `${opts.title} · ${SITE_NAME}`,
      description,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* JSON-LD structured data builders (schema.org).                             */
/* -------------------------------------------------------------------------- */

export const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: absolute("/brand/cubes.im_logo_big.png"),
  description: SITE_DESCRIPTION,
  sameAs: ["https://github.com/aspirence/cubes.im"],
};

export const websiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  publisher: { "@id": `${SITE_URL}/#organization` },
};

/** The product itself — a SoftwareApplication that is free to start. */
export const softwareApplicationLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${SITE_URL}/#software`,
  name: SITE_NAME,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Project Management",
  operatingSystem: "Web, Windows, macOS",
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  softwareHelp: absolute("/product"),
  isAccessibleForFree: true,
  publisher: { "@id": `${SITE_URL}/#organization` },
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    description: "Free to start with your whole team; usage-based paid plans.",
  },
  featureList: [
    "Projects & tasks",
    "Docs & wikis",
    "Video review",
    "Client portals",
    "Workflow automation",
    "People ops / HR",
  ],
};

/** BreadcrumbList for a marketing sub-page (Home › <name>). */
export function breadcrumbLd(name: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name, item: absolute(path) },
    ],
  };
}
