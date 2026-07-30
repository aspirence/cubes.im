import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { PortalApp, type ClientPortalData } from "./portal-app";

/**
 * Public, token-gated client portal. Data comes from the `get_client_portal`
 * RPC (returns null unless the portal is 'live'), so this needs no session and
 * leaks nothing for drafts. The interactive UI lives in the PortalApp client
 * component; this server shell only validates the token and fetches the data.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Client portal" };

function Unavailable() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0d0b1a",
        color: "#e7e5f0",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            margin: "0 auto 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 28, color: "#9b93c4" }}>
            lock
          </span>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
          Portal unavailable
        </h1>
        <p style={{ color: "#9a94b8", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          This link is invalid, expired, or the portal isn&apos;t published yet.
          Please check with your project team for an updated link.
        </p>
      </div>
    </main>
  );
}

export default async function ClientPortalPublicPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!UUID_RE.test(token)) return <Unavailable />;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_client_portal", {
    p_token: token,
  });
  if (error || !data) return <Unavailable />;

  return <PortalApp data={data as unknown as ClientPortalData} token={token} />;
}
