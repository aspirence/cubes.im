import type { Metadata } from "next";
import { pageMetadata, breadcrumbLd, softwareApplicationLd } from "@/lib/seo";
import { JsonLd } from "@/components/marketing/json-ld";

export const metadata: Metadata = pageMetadata({
  path: "/pricing",
  title: "Pricing",
  description:
    "One flat price for unlimited team members — you only pay as your storage grows. Start free with your whole team. Open source, no per-seat fees.",
});

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={[breadcrumbLd("Pricing", "/pricing"), softwareApplicationLd]} />
      {children}
    </>
  );
}
