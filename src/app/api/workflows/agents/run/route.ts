import dayjs from "dayjs";
import { NextResponse } from "next/server";
import {
  collectAgentMentions,
  extractAgentMentions,
  getAgentContext,
  readAgentConfig,
  type AgentContextKey,
  type AgentTrainingTask,
} from "@/features/workflows/agent-config";
import {
  createOpenRouterCompletion,
  mapOpenRouterError,
} from "@/lib/ai/openrouter";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

type RunAgentBody = {
  agentId?: string;
  prompt?: string;
  trainingTaskId?: string | null;
};

function ensurePrompt(prompt: string, trainingTask: AgentTrainingTask | null): string {
  if (prompt.trim()) return prompt.trim();
  if (trainingTask) return `Run the saved task "${trainingTask.title}" using the tagged Cubes context.`;
  return "";
}

async function fetchContextForMention(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  mention: AgentContextKey,
  teamId: string,
  orgId: string | null,
) {
  switch (mention) {
    case "projects": {
      const { data, error } = await supabase
        .from("projects")
        .select(
          `id, name, color_code, created_at,
           status:sys_project_statuses!projects_status_id_fk ( name ),
           category:project_categories!projects_category_id_fk ( name ),
           client:clients!projects_client_id_fk ( name )`,
        )
        .eq("team_id", teamId)
        .order("updated_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return {
        source: "projects",
        rows: data ?? [],
      };
    }
    case "tasks": {
      const { data, error } = await supabase
        .from("tasks")
        .select(
          `id, name, task_no, done, end_date, total_minutes,
           project:projects!tasks_project_id_fk!inner ( id, name, color_code, team_id ),
           status:task_statuses!tasks_status_id_fk ( id, name ),
           priority:task_priorities!tasks_priority_id_fk ( id, name )`,
        )
        .eq("project.team_id", teamId)
        .eq("archived", false)
        .is("parent_task_id", null)
        .order("updated_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return {
        source: "tasks",
        rows: data ?? [],
      };
    }
    case "members": {
      const { data, error } = await supabase
        .from("team_members")
        .select(
          `id, active, created_at,
           user:users!team_members_user_id_fk ( id, name, email, avatar_url ),
           role:roles!team_members_role_id_fk ( id, name, admin_role, owner )`,
        )
        .eq("team_id", teamId)
        .order("created_at", { ascending: true })
        .limit(30);
      if (error) throw error;
      return {
        source: "members",
        rows: data ?? [],
      };
    }
    case "workflows": {
      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, description, enabled, trigger_type, run_count, last_run_at, updated_at")
        .eq("team_id", teamId)
        .order("updated_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return {
        source: "workflows",
        rows: data ?? [],
      };
    }
    case "reports": {
      const [{ data: overview, error: overviewError }, { data: projects, error: projectsError }, { data: members, error: membersError }] =
        await Promise.all([
          supabase.rpc("report_team_overview", { p_team_id: teamId }),
          supabase.rpc("report_projects", { p_team_id: teamId }),
          supabase.rpc("report_members", { p_team_id: teamId }),
        ]);
      if (overviewError) throw overviewError;
      if (projectsError) throw projectsError;
      if (membersError) throw membersError;
      return {
        source: "reports",
        overview: (overview as unknown[] | null)?.[0] ?? null,
        topProjects: (projects as unknown[] | null)?.slice(0, 10) ?? [],
        topMembers: (members as unknown[] | null)?.slice(0, 10) ?? [],
      };
    }
    case "timelogs": {
      const { data, error } = await supabase.rpc("report_time_logs", {
        p_team_id: teamId,
        p_from: dayjs().subtract(30, "day").format("YYYY-MM-DD"),
        p_to: dayjs().format("YYYY-MM-DD"),
      });
      if (error) throw error;
      return {
        source: "timelogs",
        rows: (data as unknown[] | null)?.slice(0, 50) ?? [],
      };
    }
    case "files": {
      const { data, error } = await supabase
        .from("app_files_files")
        .select(
          `id, name, mime, size_bytes, created_at, project_id, source_import_label,
           project:projects!app_files_files_project_fk ( id, name, color_code )`,
        )
        .eq("team_id", teamId)
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return {
        source: "files",
        rows: data ?? [],
      };
    }
    case "reviews": {
      const { data, error } = await supabase
        .from("app_video_review_videos")
        .select(
          `id, title, status, stage, latest_revision, updated_at, task_id,
           project:projects!app_video_review_videos_project_fk ( id, name, color_code )`,
        )
        .eq("team_id", teamId)
        .eq("deleted", false)
        .order("updated_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return {
        source: "reviews",
        rows: data ?? [],
      };
    }
    case "social": {
      const { data, error } = await supabase
        .from("app_social_studio_posts")
        .select(
          `id, title, status, scheduled_for, published_at, updated_at,
           project:projects!app_social_studio_posts_project_fk ( id, name, color_code ),
           task:tasks!app_social_studio_posts_task_fk ( id, name, task_no )`,
        )
        .eq("team_id", teamId)
        .order("updated_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return {
        source: "social",
        rows: data ?? [],
      };
    }
    case "employees": {
      if (!orgId) return { source: "employees", rows: [], unavailable: true };
      const { data, error } = await supabase
        .from("hr_employees")
        .select(
          "id, full_name, employee_code, employment_type, status, date_of_joining, work_email, work_location",
        )
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return {
        source: "employees",
        rows: data ?? [],
      };
    }
    case "attendance": {
      if (!orgId) return { source: "attendance", rows: [], unavailable: true };
      const { data, error } = await supabase
        .from("hr_attendance")
        .select(
          `id, date, status, work_minutes, clock_in, clock_out,
           employee:hr_employees!hr_attendance_employee_id_fk ( id, full_name, employee_code )`,
        )
        .eq("org_id", orgId)
        .order("date", { ascending: false })
        .limit(40);
      if (error) throw error;
      return {
        source: "attendance",
        rows: data ?? [],
      };
    }
    case "leaves": {
      if (!orgId) return { source: "leaves", rows: [], unavailable: true };
      const { data, error } = await supabase
        .from("hr_leave_requests")
        .select(
          `id, status, from_date, to_date, days, created_at,
           employee:hr_employees!hr_leave_requests_employee_id_fk ( id, full_name, employee_code ),
           leave_type:hr_leave_types!hr_leave_requests_leave_type_id_fk ( id, name )`,
        )
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return {
        source: "leaves",
        rows: data ?? [],
      };
    }
    default:
      return null;
  }
}

async function buildAgentContext(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  mentions: AgentContextKey[],
  teamId: string,
  orgId: string | null,
) {
  const entries = await Promise.all(
    mentions.map(async (mention) => [
      mention,
      await fetchContextForMention(supabase, mention, teamId, orgId),
    ] as const),
  );

  return Object.fromEntries(entries);
}

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RunAgentBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const agentId = body.agentId?.trim();
  const prompt = body.prompt?.trim() ?? "";
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }
  if (prompt.length > 12000) {
    return NextResponse.json({ error: "Prompt too long" }, { status: 400 });
  }

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .maybeSingle();
  if (agentError) {
    return NextResponse.json({ error: agentError.message }, { status: 500 });
  }
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const config = readAgentConfig(agent.data_scope);
  const trainingTask =
    body.trainingTaskId && body.trainingTaskId.trim()
      ? config.trainingTasks.find((task) => task.id === body.trainingTaskId) ?? null
      : null;
  if (body.trainingTaskId && !trainingTask) {
    return NextResponse.json(
      { error: "Selected training task was not found on this agent." },
      { status: 400 },
    );
  }

  const effectivePrompt = ensurePrompt(prompt, trainingTask);
  if (!effectivePrompt) {
    return NextResponse.json(
      { error: "Enter a prompt or select a saved agent task." },
      { status: 400 },
    );
  }

  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("id, name, organization_id")
    .eq("id", agent.team_id)
    .maybeSingle();
  if (teamError) {
    return NextResponse.json({ error: teamError.message }, { status: 500 });
  }
  if (!team) {
    return NextResponse.json({ error: "Agent team not found." }, { status: 404 });
  }

  const usedMentions = Array.from(
    new Set<AgentContextKey>([
      ...collectAgentMentions(config),
      ...extractAgentMentions(trainingTask?.instruction),
      ...extractAgentMentions(effectivePrompt),
      ...(trainingTask?.mentions ?? []),
    ]),
  );

  try {
    const context = await buildAgentContext(
      supabase,
      usedMentions,
      team.id,
      team.organization_id ?? null,
    );

    const contextGuide = usedMentions
      .map((mention) => `@${mention}: ${getAgentContext(mention).title}`)
      .join(", ");

    const completion = await createOpenRouterCompletion({
      model: config.model,
      messages: [
        {
          role: "system",
          content: `You are ${agent.name}, a configurable Cubes agent.

Follow the workspace instructions exactly. Use only the Cubes context supplied in this request for factual claims. If context is missing, say what additional @context should be attached instead of inventing data. Keep the response concise, actionable, and formatted in clean markdown.

Agent description:
${agent.description ?? "(none)"}

Core instructions:
${config.systemPrompt?.trim() || "(none)"}

Saved task:
${trainingTask ? `${trainingTask.title}\n${trainingTask.instruction}` : "(none)"}

Saved task expected output:
${trainingTask?.expectedOutput?.trim() || "(none)"}

Attached Cubes contexts:
${contextGuide || "(none)"}`,
        },
        {
          role: "user",
          content: `Current date: ${dayjs().format("YYYY-MM-DD")}
Team: ${team.name}

User request:
${effectivePrompt}

Cubes context JSON:
${JSON.stringify(context, null, 2)}`,
        },
      ],
    });

    return NextResponse.json({
      answer: completion.content,
      model: completion.model,
      prompt: effectivePrompt,
      usedMentions,
      trainingTask: trainingTask
        ? {
            id: trainingTask.id,
            title: trainingTask.title,
            instruction: trainingTask.instruction,
          }
        : null,
    });
  } catch (err) {
    const { status, message } = mapOpenRouterError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
