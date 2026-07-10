"use client";

import { SocialStudioWorkspace } from "@/features/app-social-studio/social-studio-workspace";

export function SocialStudioTab({ projectId }: { projectId: string }) {
  return <SocialStudioWorkspace projectId={projectId} embedded />;
}
