import type { Metadata } from "next";
import { AppShell } from "./app-shell";

// The authenticated app is private — keep it out of search indexes (defense in
// depth alongside the robots.ts disallow rules).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Rendered per request, never prerendered.
 *
 * Every screen in here is behind auth and personal to the viewer, so a static
 * shell buys nothing — and trying to build one is actively harmful. Several of
 * these pages read search params or other client-only state, which forces a
 * bailout during static generation, and Next 16's `workStore` invariant then
 * fires on whichever pages the pass happens to reach: `/admin-center/billing`
 * one build, `/settings/cubes` the next, three unrelated pages the build after.
 * An edit anywhere could shift the bundle and flip it, which made a green build
 * a matter of luck rather than of the code being correct.
 *
 * Opting the whole group out of that pass is the honest description of what
 * these routes are, and it makes the build deterministic.
 */
export const dynamic = "force-dynamic";

export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
