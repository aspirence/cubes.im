"use client";

import { Badge, Button, Popover, Progress, Tooltip, theme } from "antd";
import { useUploadStore } from "@/store/upload-store";

function MIcon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

const STATUS_META: Record<string, { icon: string; color: string; label: string }> = {
  done: { icon: "check_circle", color: "#2f8f5f", label: "Done" },
  error: { icon: "error", color: "#c0453c", label: "Failed" },
  canceled: { icon: "cancel", color: "#9a9da8", label: "Canceled" },
};

/**
 * Live background-upload progress in the app-shell header: a circular percentage
 * while uploads run, with a hover popover listing each file, its progress, and a
 * cancel button. Renders nothing when there are no uploads.
 */
export function UploadIndicator() {
  const { token } = theme.useToken();
  const jobs = useUploadStore((s) => s.jobs);
  if (jobs.length === 0) return null;

  const active = jobs.filter((j) => j.status === "uploading");
  const overall = active.length
    ? Math.round(
        (active.reduce((a, j) => a + j.progress, 0) / active.length) * 100,
      )
    : 100;

  const content = (
    <div style={{ width: 300, maxHeight: 320, overflowY: "auto" }}>
      {jobs.map((j) => {
        const meta = j.status !== "uploading" ? STATUS_META[j.status] : null;
        return (
          <div
            key={j.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 4px",
            }}
          >
            <MIcon
              name={meta ? meta.icon : "cloud_upload"}
              size={18}
              color={meta ? meta.color : token.colorPrimary}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12.5,
                  color: token.colorText,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {j.name}
              </div>
              {j.status === "uploading" ? (
                <Progress
                  percent={Math.round(j.progress * 100)}
                  showInfo={false}
                  size="small"
                  status="active"
                />
              ) : (
                <Tooltip title={j.status === "error" ? j.error : undefined}>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: meta?.color ?? token.colorTextTertiary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {j.status === "error" && j.error ? j.error : meta?.label}
                  </div>
                </Tooltip>
              )}
            </div>
            {j.status === "uploading" ? (
              <>
                <span style={{ fontSize: 11.5, color: token.colorTextTertiary, flex: "none" }}>
                  {Math.round(j.progress * 100)}%
                </span>
                <Tooltip title="Cancel">
                  <Button
                    type="text"
                    size="small"
                    aria-label="Cancel upload"
                    icon={<MIcon name="close" size={15} />}
                    onClick={() => j.cancel()}
                  />
                </Tooltip>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <Popover
      content={content}
      title={active.length ? `Uploading ${active.length}…` : "Uploads"}
      trigger="hover"
      placement="bottomRight"
    >
      <span style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
        <Badge count={active.length} size="small" offset={[-2, 2]}>
          {active.length ? (
            <Progress
              type="circle"
              percent={overall}
              size={26}
              strokeWidth={12}
              format={(p) => (
                <span style={{ fontSize: 8, color: token.colorTextSecondary }}>{p}</span>
              )}
            />
          ) : (
            <MIcon name="cloud_done" size={20} color="#2f8f5f" />
          )}
        </Badge>
      </span>
    </Popover>
  );
}
