import type { Metadata } from "next";
import { PortalLogin } from "@/features/app-client/portal-login";
import { DEFAULT_PORTAL_BRAND } from "@/features/app-client/types";
import { SITE_NAME } from "@/lib/seo";

/**
 * Client sign-in. Public by way of `PUBLIC_PATHS` in src/proxy.ts (`/portal`),
 * and never indexed — a sign-in page for a private client area has nothing to
 * gain from a search result.
 *
 * This is the address the magic-link route redirects to when a link is stale
 * (`/portal?error=link`), so it lives at /portal itself; /portal/login renders
 * the same screen for anyone who was given that address instead.
 *
 * The screen carries the product's branding rather than an agency's: before an
 * email is typed we do not know which workspace the visitor belongs to, and
 * taking that from a query parameter would let anyone paint this page with
 * someone else's logo.
 *
 * It deliberately does NOT bounce a visitor who already has a session cookie:
 * the cookie may be revoked or expired, and a redirect here plus a redirect
 * back from /portal/home is a loop the client cannot escape.
 */
export const metadata: Metadata = {
  title: "Client sign-in",
  robots: { index: false, follow: false },
};

export default async function PortalSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const one = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : null;
  return (
    <PortalLogin
      brand={{ ...DEFAULT_PORTAL_BRAND, name: SITE_NAME }}
      reason={one(params.reason) ?? one(params.error)}
    />
  );
}
