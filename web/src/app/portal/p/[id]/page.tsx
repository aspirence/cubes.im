import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PortalProject } from "@/features/app-client/portal-project";
import { PortalStatus } from "@/features/app-client/portal-status";
import { portalRpc, readPortalToken } from "@/features/app-client/portal-server";
import {
  DEFAULT_PORTAL_BRAND,
  parseOverview,
  parseSessionContext,
} from "@/features/app-client/types";

/**
 * One project, as its client sees it: the shared work, the approvals waiting
 * on them, and their own requests.
 *
 * `client_project_overview` takes the session token AND the project id, and
 * answers `{ok: false, reason: 'not_found'}` when that contact has no access
 * row — which is why "not shared with you" and "no such project" are one screen
 * here. Rendering cannot leak what the payload never contained.
 */
export const metadata: Metadata = {
  title: "Project",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PortalProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await readPortalToken();
  if (!token) redirect("/portal?reason=signed_out");

  if (!UUID_RE.test(id)) {
    return (
      <PortalStatus
        icon="link_off"
        title="That link is not valid"
        message="Check the link you were sent, or open your projects and pick it from the list."
        action={{ href: "/portal/home", label: "My projects" }}
      />
    );
  }

  // Branding comes from the session, the project payload from the overview —
  // two RPCs rather than one because the workspace's logo is not a fact about
  // the project.
  const [session, result] = await Promise.all([
    portalRpc("client_session_context", { p_token: token }),
    portalRpc("client_project_overview", { p_token: token, p_project_id: id }),
  ]);

  if (session.missing || result.missing) {
    return (
      <PortalStatus
        icon="construction"
        title="Not set up yet"
        message="This workspace has not finished switching on its client area."
      />
    );
  }
  if (result.error) {
    return (
      <PortalStatus
        icon="cloud_off"
        title="We cannot load this project"
        message="Something went wrong on our side. Please try again in a moment."
        action={{ href: `/portal/p/${id}`, label: "Try again" }}
      />
    );
  }

  const context = parseSessionContext(session.data);
  if (!context) redirect("/portal?reason=expired");

  const overview = parseOverview(result.data);
  if (!overview) {
    return (
      <PortalStatus
        icon="lock"
        title="Not shared with you"
        message="This project is not shared with your address, or your access has been removed. Ask your agency if you think that is wrong."
        action={{ href: "/portal/home", label: "My projects" }}
      />
    );
  }

  return (
    <PortalProject
      overview={overview}
      brand={context?.brand ?? DEFAULT_PORTAL_BRAND}
    />
  );
}
