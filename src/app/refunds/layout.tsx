import type { Metadata } from "next";
import { pageMetadata, breadcrumbLd } from "@/lib/seo";
import { JsonLd } from "@/components/marketing/json-ld";

export const metadata: Metadata = pageMetadata({
  path: "/refunds",
  title: "Refund Policy",
  description: "Our refund policy for paid Cubes plans.",
});

export default function RefundsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbLd("Refund Policy", "/refunds")} />
      {children}
    </>
  );
}
