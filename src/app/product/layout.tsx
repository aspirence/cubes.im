import type { Metadata } from "next";
import { pageMetadata, breadcrumbLd } from "@/lib/seo";
import { JsonLd } from "@/components/marketing/json-ld";

export const metadata: Metadata = pageMetadata({
  path: "/product",
  title: "Product",
  description:
    "See how Cubes brings projects, docs, video review, client portals, and people ops into one workspace behind a single login.",
});

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbLd("Product", "/product")} />
      {children}
    </>
  );
}
