"use client";

import { useState } from "react";
import { PCard, PEmpty, PPill, PortalShell, usePortalPalette } from "./portal-shell";
import type { PortalPalette } from "./portal-theme";
import type { PortalBrand, PortalContact, PortalProjectSummary } from "./types";

/**
 * Sign-out is a POST to the backend's own route, which deletes the session row
 * before clearing the cookie — a revoke, not a cosmetic logout. The redirect
 * happens here because the route answers JSON (it is also called from script).
 */
function SignOutButton({ palette }: { palette: PortalPalette }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/client/auth/logout", { method: "POST" });
        } catch {
          // The cookie may survive a failed call; the sign-in page is still
          // the right place to land, and it will bounce a live session back.
        }
        window.location.href = "/portal?reason=signed_out";
      }}
      style={{
        minHeight: 36,
        padding: "0 10px",
        borderRadius: 9,
        border: `1px solid ${palette.hair}`,
        background: palette.panel,
        color: palette.textSecondary,
        fontSize: 12.5,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

/**
 * The client's landing page: the projects shared with them, with the two
 * numbers that decide whether they tap — what is waiting on them, and what is
 * new. Nothing else, because a client who has to choose between eight tiles
 * closes the tab.
 */
export function PortalHome({
  brand,
  contact,
  projects,
}: {
  brand: PortalBrand;
  contact: PortalContact;
  projects: PortalProjectSummary[];
}) {
  const palette = usePortalPalette(brand.accent);
  const waiting = projects.reduce((sum, p) => sum + p.pendingApprovals, 0);

  return (
    <PortalShell
      brand={brand}
      palette={palette}
      right={<SignOutButton palette={palette} />}
    >
      <div style={{ margin: "2px 2px 0" }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>
          Hello, {contact.name.split(" ")[0]}
        </div>
        <div style={{ fontSize: 13.5, color: palette.textSecondary, marginTop: 2 }}>
          {waiting > 0
            ? `${waiting} thing${waiting === 1 ? "" : "s"} waiting for your sign-off.`
            : "Nothing is waiting on you right now."}
        </div>
      </div>

      {projects.length === 0 ? (
        <PEmpty
          palette={palette}
          icon="folder_off"
          title="Nothing shared yet"
          desc="When your agency shares a project with you, it appears here."
        />
      ) : (
        projects.map((project) => (
          <a
            key={project.id}
            href={`/portal/p/${project.id}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <PCard palette={palette} accentEdge={project.color ?? palette.accent}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700 }}>{project.name}</div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: palette.textTertiary,
                      marginTop: 2,
                    }}
                  >
                    {project.clientName ? `${project.clientName} · ` : ""}
                    {project.sharedCount} shared item
                    {project.sharedCount === 1 ? "" : "s"}
                  </div>
                </div>
                <span
                  className="material-symbols-rounded"
                  aria-hidden
                  style={{ fontSize: 20, color: palette.textTertiary }}
                >
                  chevron_right
                </span>
              </div>
              {project.pendingApprovals > 0 || project.openRequests > 0 ? (
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
                  {project.pendingApprovals > 0 ? (
                    <PPill
                      label={`${project.pendingApprovals} to approve`}
                      tone={palette.gold}
                      icon="pending"
                    />
                  ) : null}
                  {project.openRequests > 0 ? (
                    <PPill
                      label={`${project.openRequests} request${
                        project.openRequests === 1 ? "" : "s"
                      } open`}
                      tone={palette.accent}
                      icon="forum"
                    />
                  ) : null}
                </div>
              ) : null}
            </PCard>
          </a>
        ))
      )}

      <div style={{ fontSize: 11.5, color: palette.textTertiary, textAlign: "center" }}>
        Signed in as {contact.email}
      </div>
    </PortalShell>
  );
}
