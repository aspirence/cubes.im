"use client";

import { SheetsWorkspace } from "@/features/app-sheets/sheets-workspace";

export function SheetsTab({ projectId }: { projectId: string }) {
  return <SheetsWorkspace projectId={projectId} embedded />;
}
