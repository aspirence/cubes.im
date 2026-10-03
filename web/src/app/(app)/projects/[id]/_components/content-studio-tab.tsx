"use client";

import { ContentStudioWorkspace } from "@/features/app-content-studio/content-studio-workspace";

export function ContentStudioTab({ projectId }: { projectId: string }) {
  return <ContentStudioWorkspace projectId={projectId} embedded />;
}
