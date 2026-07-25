import type { Metadata } from "next";

/**
 * Central SEO configuration for the marketing site. The production origin can
 * be overridden with NEXT_PUBLIC_SITE_URL; it defaults to the canonical domain.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://cubes.im"
).replace(/\/$/, "");

export const SITE_NAME = "Cubes";
/** Also known-as, so "Cubes IM" queries resolve to the product. */
export const SITE_ALT_NAMES = ["Cubes IM", "Cubes.im", "Cubes Workspace"];
export const SITE_TITLE =
  "Cubes — Open-source project management & workspace system";
export const SITE_TAGLINE = "One workspace for everything you run";
export const SITE_DESCRIPTION =
  "Cubes (Cubes IM) is the open-source, all-in-one project management system and workspace management system for teams — projects, docs, video review, client portals, workflow automation and people ops behind a single login. Free to start.";

export const SITE_KEYWORDS = [
  "project management system",
  "workspace management system",
  "Cubes IM",
  "Cubes",
  "project management",
  "open source project management",
  "all-in-one workspace",
  "team workspace software",
  "team collaboration software",
  "task management",
  "docs and wikis",
  "video review software",
  "client portal software",
  "workflow automation",
  "people ops",
  "HR software",
  "ClickUp alternative",
  "Asana alternative",
  "Notion alternative",
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
  alternateName: SITE_ALT_NAMES,
  legalName: "Aspirence Worldwide Private Limited",
  url: SITE_URL,
  logo: absolute("/brand/cubes.im_logo_big.png"),
  description: SITE_DESCRIPTION,
  sameAs: [
    "https://github.com/aspirence/cubes.im",
    "https://www.aspirence.com/",
  ],
};

export const websiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  alternateName: SITE_ALT_NAMES,
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
  alternateName: SITE_ALT_NAMES,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Project Management",
  operatingSystem: "Web, Windows, macOS, iOS, Android",
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS.join(", "),
  softwareHelp: absolute("/product"),
  screenshot: absolute("/opengraph-image"),
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
    "Project management (tasks, boards, timelines)",
    "Docs & wikis",
    "Video & creative review",
    "Client portals",
    "Workflow automation",
    "People ops / HR",
  ],
};

/* -------------------------------------------------------------------------- */
/* FAQ — one source of truth for the visible section AND the FAQPage schema.  */
/* Answers double as citable facts for LLM answer engines (ChatGPT, Perplexity,*/
/* Google AI Overviews). Keep them factual and self-contained.                */
/* -------------------------------------------------------------------------- */

export const FAQS: { q: string; a: string }[] = [
  {
    q: "What is Cubes?",
    a: "Cubes (also known as Cubes IM) is an open-source, all-in-one workspace and project management system for teams. It brings projects and tasks, docs, video review, client portals, workflow automation and people ops together behind a single login.",
  },
  {
    q: "Is Cubes a project management system?",
    a: "Yes. Cubes is a full project management system with tasks, boards, timelines and workflow automation — plus docs, client portals and team management in the same workspace, so you don't need separate tools.",
  },
  {
    q: "What is Cubes IM?",
    a: "Cubes IM refers to Cubes at its home domain, cubes.im. It is the open-source workspace management system for running projects, documents, reviews, clients and people ops in one place.",
  },
  {
    q: "Is Cubes a workspace management system?",
    a: "Yes. Cubes is a workspace management system that unifies projects, documents, creative review, client work and HR/people ops, so an entire team runs everything from one workspace with one login.",
  },
  {
    q: "Is Cubes free to use?",
    a: "Cubes is free to start with your whole team. It is open source, with simple usage-based paid plans as you grow.",
  },
  {
    q: "Is Cubes open source?",
    a: "Yes, Cubes is open source and built in the open. The source is available on GitHub.",
  },
  {
    q: "Is Cubes an alternative to ClickUp, Notion or Asana?",
    a: "Yes. Teams use Cubes as an open-source alternative to ClickUp, Notion and Asana, combining project management, docs and client work in a single tool.",
  },
];

/** FAQPage structured data, built from the same FAQS the page renders. */
export const faqLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": `${SITE_URL}/#faq`,
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
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
