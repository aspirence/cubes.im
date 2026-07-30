import type { Metadata } from "next";
import { pageMetadata, breadcrumbLd } from "@/lib/seo";
import { JsonLd } from "@/components/marketing/json-ld";

export const metadata: Metadata = pageMetadata({
  path: "/terms",
  title: "Terms of Service",
  description: "The terms that govern your use of Cubes.",
});

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbLd("Terms of Service", "/terms")} />
      {children}
    </>
  );
}
