import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PortalHome } from "@/features/app-client/portal-home";
import { PortalStatus } from "@/features/app-client/portal-status";
import { portalRpc, readPortalToken } from "@/features/app-client/portal-server";
import {
  parsePortalProjects,
  parseSessionContext,
} from "@/features/app-client/types";

/**
 * The signed-in client's home: the projects shared with them.
 *
 * Both reads are SECURITY DEFINER RPCs that take the session token — the
 * database resolves the contact and decides what comes back, so this page has
 * no filtering of its own to get wrong. An unknown or expired token is
 * indistinguishable from no token at all: both end at the sign-in screen.
 */
export const metadata: Metadata = {
  title: "Your projects",
  robots: { index: false, follow: false },
};

export default async function PortalHomePage() {
  const token = await readPortalToken();
  if (!token) redirect("/portal");

  const session = await portalRpc("client_session_context", { p_token: token });
  if (session.missing) {
    return (
      <PortalStatus
        icon="construction"
        title="Client sign-in is not set up yet"
        message="This workspace has not finished switching on its client area. Your agency can still send you what you need in the meantime."
      />
    );
  }
  if (session.error) {
    return (
      <PortalStatus
        icon="cloud_off"
        title="We cannot load your projects"
        message="Something went wrong on our side. Please try again in a moment."
        action={{ href: "/portal/home", label: "Try again" }}
      />
    );
  }

  const context = parseSessionContext(session.data);
  // An expired or revoked session parses to null. The sign-in page is a plain
  // page (it never redirects a visitor back here), so this cannot loop.
  if (!context) redirect("/portal?reason=expired");

  const projects = await portalRpc("client_portal_projects", { p_token: token });
  return (
    <PortalHome
      brand={context.brand}
      contact={context.contact}
      projects={projects.missing || projects.error ? [] : parsePortalProjects(projects.data)}
    />
  );
}
