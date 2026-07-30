import type { Metadata } from "next";
import { pageMetadata, breadcrumbLd } from "@/lib/seo";
import { JsonLd } from "@/components/marketing/json-ld";

export const metadata: Metadata = pageMetadata({
  path: "/privacy",
  title: "Privacy Policy",
  description: "How Cubes collects, uses, and protects your data.",
});

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbLd("Privacy Policy", "/privacy")} />
      {children}
    </>
  );
}
