"use client";

import { useState } from "react";
import { App, Tooltip, theme } from "antd";
import { MIcon } from "./m-icon";

/**
 * A deal's number, ready to act on: tap to dial, or copy it in one click.
 * Sales work is mostly "find the number, call the number", so the copy button
 * sits inline rather than behind the record drawer. Both controls stop the
 * click from reaching the row underneath, which usually opens a drawer.
 */
export function PhoneWithCopy({
  phone,
  size = 12.5,
  /** Rendered when there is no number; pass null to render nothing at all. */
  fallback = null,
}: {
  phone: string | null | undefined;
  size?: number;
  fallback?: React.ReactNode;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [copied, setCopied] = useState(false);

  if (!phone) return <>{fallback}</>;

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      // A brief tick on the button itself; the toast covers the case where
      // the button scrolls out of view mid-copy.
      window.setTimeout(() => setCopied(false), 1400);
      message.success("Number copied");
    } catch {
      message.error("Couldn't copy the number.");
    }
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        maxWidth: "100%",
      }}
    >
      <MIcon name="call" size={size + 1} color={token.colorTextQuaternary} />
      <a
        href={`tel:${phone}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          fontSize: size,
          color: token.colorTextSecondary,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {phone}
      </a>
      <Tooltip title={copied ? "Copied" : "Copy number"}>
        <button
          type="button"
          aria-label={`Copy ${phone}`}
          onClick={copy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: 2,
            border: "none",
            borderRadius: 5,
            background: "transparent",
            cursor: "pointer",
            color: copied ? token.colorSuccess : token.colorTextTertiary,
            flex: "none",
          }}
        >
          <MIcon name={copied ? "check" : "content_copy"} size={size + 1} />
        </button>
      </Tooltip>
    </span>
  );
}
