import type { Metadata } from "next";
import { pageMetadata, breadcrumbLd } from "@/lib/seo";
import { JsonLd } from "@/components/marketing/json-ld";

export const metadata: Metadata = pageMetadata({
  path: "/manifesto",
  title: "Manifesto",
  description:
    "Why we build Cubes: one open workspace for the whole team, instead of a dozen disconnected tools behind a dozen logins.",
});

export default function ManifestoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbLd("Manifesto", "/manifesto")} />
      {children}
    </>
  );
}
