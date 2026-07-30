import { createClient } from "@/lib/supabase/client";

/**
 * Seeds a "sample workspace" template into a team: three example projects with
 * tasks spread across statuses, priorities, and due dates, so a brand-new
 * owner lands on a living dashboard instead of an empty one.
 *
 * Runs entirely through the same RLS-guarded RPCs the app uses
 * (`create_project` / `create_task`), so it can only seed teams the caller
 * actually owns. Deleting the projects removes the sample data completely.
 */

type Supabase = ReturnType<typeof createClient>;

interface SampleTask {
  name: string;
  bucket: "todo" | "doing" | "done";
  /** Due date as an offset in days from today (negative = overdue). */
  due: number;
  priority?: "low" | "medium" | "high";
  /** Assign the seeding owner so "by assignee" charts have data. */
  assignMe?: boolean;
}

interface SampleProject {
  name: string;
  color: string;
  tasks: SampleTask[];
}

const SAMPLE_PROJECTS: SampleProject[] = [
  {
    name: "Website Redesign",
    color: "#4a4ad0",
    tasks: [
      { name: "Audit current site & gather feedback", bucket: "done", due: -6 },
      { name: "Define sitemap & user flows", bucket: "done", due: -4, assignMe: true },
      { name: "Wireframes for key pages", bucket: "doing", due: 2, priority: "high", assignMe: true },
      { name: "Homepage visual design", bucket: "doing", due: 4, priority: "medium" },
      { name: "Design system tokens & components", bucket: "todo", due: 7 },
      { name: "Copywriting for landing pages", bucket: "todo", due: -2, priority: "high" },
      { name: "Responsive pass & QA", bucket: "todo", due: 10, assignMe: true },
      { name: "Launch checklist", bucket: "todo", due: 14, priority: "low" },
    ],
  },
  {
    name: "Q3 Marketing Launch",
    color: "#e0559b",
    tasks: [
      { name: "Campaign brief & goals", bucket: "done", due: -5, assignMe: true },
      { name: "Landing page copy", bucket: "doing", due: 1, priority: "high" },
      { name: "Email drip sequence", bucket: "doing", due: 3, assignMe: true },
      { name: "Social calendar for launch week", bucket: "todo", due: 5 },
      { name: "Influencer shortlist & outreach", bucket: "todo", due: -1, priority: "medium" },
      { name: "Launch-day checklist", bucket: "todo", due: 12, priority: "low" },
    ],
  },
  {
    name: "Client Onboarding",
    color: "#2f8f5f",
    tasks: [
      { name: "Welcome pack & kickoff deck", bucket: "done", due: -3 },
      { name: "Contract & invoicing templates", bucket: "doing", due: 4, assignMe: true },
      { name: "Client portal setup", bucket: "todo", due: 6, priority: "high" },
      { name: "Feedback survey draft", bucket: "todo", due: 9, priority: "low" },
    ],
  },
];

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Picks a status id for a bucket, falling back to the first status. */
function statusForBucket(
  statuses: {
    id: string;
    category: { is_todo: boolean; is_doing: boolean; is_done: boolean } | null;
  }[],
  bucket: SampleTask["bucket"],
): string | undefined {
  const match = statuses.find((s) =>
    bucket === "todo"
      ? s.category?.is_todo
      : bucket === "doing"
        ? s.category?.is_doing
        : s.category?.is_done,
  );
  return (match ?? statuses[0])?.id;
}

/**
 * Seeds the sample template into `teamId`. Throws on the first hard failure;
 * callers treat this as best-effort and fall back to a blank workspace.
 */
export async function seedSampleWorkspace(
  supabase: Supabase,
  teamId: string,
  userId?: string,
): Promise<void> {
  // Global priority lookup, ordered low -> high by value.
  const { data: priorities } = await supabase
    .from("task_priorities")
    .select("id, value")
    .order("value", { ascending: true });
  const prioId = (p?: SampleTask["priority"]): string | undefined => {
    if (!p || !priorities || priorities.length === 0) return undefined;
    if (p === "low") return priorities[0]?.id;
    if (p === "high") return priorities[priorities.length - 1]?.id;
    return priorities[Math.floor(priorities.length / 2)]?.id;
  };

  // The seeding owner's team_member row (for task assignees).
  let myMemberId: string | undefined;
  if (userId) {
    const { data: members } = await supabase
      .from("team_members")
      .select("id, user_id")
      .eq("team_id", teamId);
    myMemberId = (members ?? []).find((m) => m.user_id === userId)?.id;
  }

  for (const project of SAMPLE_PROJECTS) {
    const { data: projectId, error: projectError } = await supabase.rpc(
      "create_project",
      {
        p_name: project.name,
        p_team_id: teamId,
        p_color_code: project.color,
      },
    );
    if (projectError) throw projectError;
    const pid = projectId as string;

    // Give the project a plausible timeline.
    await supabase
      .from("projects")
      .update({
        start_date: isoDaysFromNow(-14),
        end_date: isoDaysFromNow(30),
      })
      .eq("id", pid);

    // The project's statuses (created by create_project) with their categories.
    const { data: rawStatuses, error: statusError } = await supabase
      .from("task_statuses")
      .select(
        "id, sort_order, sys_task_status_categories(is_todo, is_doing, is_done)",
      )
      .eq("project_id", pid)
      .order("sort_order", { ascending: true });
    if (statusError) throw statusError;
    const statuses = (rawStatuses ?? []).map((s) => ({
      id: s.id,
      category: s.sys_task_status_categories,
    }));

    for (const task of project.tasks) {
      const { data: taskId, error: taskError } = await supabase.rpc(
        "create_task",
        {
          p_name: task.name,
          p_project_id: pid,
          ...(statusForBucket(statuses, task.bucket)
            ? { p_status_id: statusForBucket(statuses, task.bucket) }
            : {}),
          ...(prioId(task.priority) ? { p_priority_id: prioId(task.priority) } : {}),
          ...(task.assignMe && myMemberId ? { p_assignees: [myMemberId] } : {}),
        },
      );
      if (taskError) throw taskError;

      // Dates make the dashboard come alive (overdue / due-this-week buckets).
      await supabase
        .from("tasks")
        .update({
          start_date: isoDaysFromNow(task.due - 5),
          end_date: isoDaysFromNow(task.due),
        })
        .eq("id", taskId as string);
    }
  }
}
