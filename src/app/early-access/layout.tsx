import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = {
  ...pageMetadata({
    path: "/early-access",
    title: "Early access",
    description: "Request early access to Cubes.",
  }),
  robots: { index: false, follow: true },
};

export default function EarlyAccessLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
