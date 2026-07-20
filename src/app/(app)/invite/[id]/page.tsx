"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, Result, Spin, Button } from "antd";
import { useAuth } from "@/features/auth/use-auth";
import { useAcceptInvitation } from "@/features/invitations/use-invitations";

/**
 * Invitation acceptance landing page.
 *
 * For a logged-in user it calls `useAcceptInvitation(id)` once and, on success,
 * routes to /home. If the user is not authenticated it sends them to /login
 * with a `next` param so the flow resumes after sign-in (the proxy guard also
 * enforces this, so this is a client-side safety net).
 */
export default function AcceptInvitePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const invitationId = params?.id;

  const { user, loading } = useAuth();
  const acceptInvitation = useAcceptInvitation();

  // Ensure the mutation only fires once even across re-renders.
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!invitationId) return;

    // Not signed in -> bounce to login, preserving the return path.
    if (!user) {
      const next = encodeURIComponent(`/invite/${invitationId}`);
      router.replace(`/login?next=${next}`);
      return;
    }

    if (attemptedRef.current) return;
    attemptedRef.current = true;

    acceptInvitation.mutate(invitationId, {
      onSuccess: () => {
        // Same as the onboarding chooser: the onboarding gate just changed
        // server-side, so re-enter the app with a fresh document.
        window.location.assign("/home");
      },
    });
  }, [loading, user, invitationId, acceptInvitation, router]);

  const errorMessage =
    acceptInvitation.error instanceof Error
      ? acceptInvitation.error.message
      : "We couldn't accept this invitation. It may have expired or already "
        + "been used.";

  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <Card style={{ width: "100%", maxWidth: 520 }}>
        {acceptInvitation.isError ? (
          <Result
            status="error"
            title="Invitation could not be accepted"
            subTitle={errorMessage}
            extra={
              <Button type="primary" onClick={() => router.replace("/home")}>
                Go to home
              </Button>
            }
          />
        ) : (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>Accepting your invitation…</div>
          </div>
        )}
      </Card>
    </div>
  );
}
