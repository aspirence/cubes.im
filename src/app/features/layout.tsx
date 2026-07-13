import type { Metadata } from "next";
import { pageMetadata, breadcrumbLd } from "@/lib/seo";
import { JsonLd } from "@/components/marketing/json-ld";

export const metadata: Metadata = pageMetadata({
  path: "/features",
  title: "Features",
  description:
    "Everything your team runs on: tasks & projects, docs, video review, client portals, workflow automation, and people ops — open source and free to start.",
});

export default function FeaturesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbLd("Features", "/features")} />
      {children}
    </>
  );
}
