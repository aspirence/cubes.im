"use client";

import { useState } from "react";
import { Card, Segmented, Typography } from "antd";
import { FilesBrowser } from "@/features/app-files/files-browser";
import { LocalFilesPanel } from "@/features/app-files/local-files-panel";

const { Text } = Typography;

/** The Files view embedded in a project — cloud (shared) files, or a folder on
 *  the user's own machine (local access, no upload) with push-to-remote. */
export function FilesTab({ projectId }: { projectId: string }) {
  const [mode, setMode] = useState<"cloud" | "local">("cloud");
  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="material-symbols-rounded"
              aria-hidden
              style={{ fontSize: 20, color: "#2f9c9c" }}
            >
              folder_shared
            </span>
            <span style={{ fontWeight: 700, fontSize: 15.5 }}>Files</span>
          </div>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {mode === "cloud"
              ? "This project's shared files — organized into folders, with per-file permissions."
              : "A folder on your machine — browse without uploading, copy files anywhere, or push any to the cloud for the team."}
          </Text>
        </div>
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as "cloud" | "local")}
          options={[
            { label: "Shared", value: "cloud" },
            { label: "Local folder", value: "local" },
          ]}
        />
      </div>

      {mode === "cloud" ? (
        <FilesBrowser projectId={projectId} />
      ) : (
        <LocalFilesPanel projectId={projectId} />
      )}
    </Card>
  );
}
