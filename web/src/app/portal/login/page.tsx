import type { Metadata } from "next";
import PortalSignInPage from "../page";

/**
 * An alias for /portal, because both addresses get handed to clients: the
 * magic-link route falls back to /portal, while "go to <app>/portal/login" is
 * what an agency types into WhatsApp. Same screen either way.
 */
export const metadata: Metadata = {
  title: "Client sign-in",
  robots: { index: false, follow: false },
};

export default PortalSignInPage;
