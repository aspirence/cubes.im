import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ReviewApp, type ReviewShareData } from "./review-app";

/**
 * Public, token-gated video review page. Data comes from the
 * `get_video_review_share` RPC (SECURITY DEFINER), which returns null unless the
 * share is active — so this needs no session and leaks nothing for paused or
 * unknown links. The video bytes stream through `/api/review/[token]/video`.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = {
  title: "Video review",
  robots: { index: false, follow: false },
};

function Unavailable() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        background: "#f7f7f9",
        color: "#55565f",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fff",
          border: "1px solid #eceef2",
          marginBottom: 6,
        }}
      >
        <span className="material-symbols-rounded" style={{ fontSize: 28, color: "#9a9da8" }}>
          lock
        </span>
      </div>
      <h1 style={{ fontSize: 19, fontWeight: 700, color: "#17171c", margin: 0 }}>
        This review link isn’t available
      </h1>
      <p style={{ fontSize: 14, maxWidth: 380, margin: 0, lineHeight: 1.6 }}>
        The link may be wrong, or sharing may have been paused by the team.
        Please check with them for an updated link.
      </p>
    </main>
  );
}

export default async function PublicReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!UUID_RE.test(token)) return <Unavailable />;

  const supabase = await createClient();
  // The RPC isn't in the generated types yet — call it via a loose view of the
  // client. It must stay a member call so supabase-js keeps its `this` binding.
  const db = supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>;
  };
  const { data, error } = await db.rpc("get_video_review_share", { p_token: token });

  if (error || !data) return <Unavailable />;

  return <ReviewApp data={data as ReviewShareData} token={token} />;
}
