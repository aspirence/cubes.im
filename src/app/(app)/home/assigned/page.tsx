"use client";

import { InboxPane } from "@/features/home/inbox-pane";

export default function AssignedCommentsPage() {
  return (
    <InboxPane
      title="Assigned Comments"
      description="Comments where you were @mentioned — treat them as action items."
      types={["mention"]}
    />
  );
}
