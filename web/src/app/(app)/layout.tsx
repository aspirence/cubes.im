import type { Metadata } from "next";
import { AppShell } from "./app-shell";

// The authenticated app is private — keep it out of search indexes (defense in
// depth alongside the robots.ts disallow rules).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
