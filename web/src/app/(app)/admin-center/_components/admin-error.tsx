"use client";

import { Alert, Result } from "antd";

/**
 * Returns true when the supplied error is the org-admin RPC `forbidden` raise
 * (the admin_* RPCs `RAISE 'forbidden'` when the caller is not the org owner /
 * admin). Matches defensively on the message text.
 */
export function isForbiddenError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
  return message.toLowerCase().includes("forbidden");
}

/**
 * Shared error rendering for Admin Center RPC pages: shows a friendly
 * "Admins only" Result when the RPC rejects with `forbidden`, otherwise a
 * generic error Alert. Returns null when there is no error.
 */
export function AdminError({
  error,
  title,
}: {
  error: unknown;
  title: string;
}) {
  if (!error) return null;

  if (isForbiddenError(error)) {
    return (
      <Result
        status="403"
        title="Admins only"
        subTitle="You need to be an owner or admin of this organization to view this page."
      />
    );
  }

  return (
    <Alert
      type="error"
      showIcon
      style={{ marginTop: 16 }}
      message={title}
      description={error instanceof Error ? error.message : "Please try again."}
    />
  );
}
