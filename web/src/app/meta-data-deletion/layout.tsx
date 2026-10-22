import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  path: "/meta-data-deletion",
  title: "Facebook data deletion",
  description: "What Cubes stores for a connected Facebook Ads account, and how it is deleted.",
});

export default function MetaDataDeletionLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
