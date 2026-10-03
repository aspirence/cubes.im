"use client";

import { ClientWorkspace } from "@/features/app-client/client-workspace";

export function ClientTab({ projectId }: { projectId: string }) {
  return <ClientWorkspace projectId={projectId} embedded />;
}
