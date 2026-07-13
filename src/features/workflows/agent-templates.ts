import type { AgentContextKey } from "@/features/workflows/agent-config";

/**
 * Pre-built agent templates — the "marketplace". Picking one either calls
 * create_agent_from_template (for the special server-brained agents like the
 * Operations Manager) or seeds a normal agent client-side from `starterPrompt`
 * + `contexts` (see useInstallTemplate). Every template is one click to add.
 */
export interface AgentTemplate {
  key: string;
  name: string;
  emoji: string;
  tagline: string;
  description: string;
  highlights: string[];
  accent: string;
  /** "ops" → seeded by the server RPC; "preset" → seeded client-side. */
  kind: "ops" | "preset";
  /** Marketplace badge, e.g. "Featured", "Popular", "New", "Pro". */
  badge?: string;
  /** CSS gradient for the card banner. */
  gradient: string;
  /** Cubes @contexts this agent works with by default. */
  contexts: AgentContextKey[];
  /** System prompt seed for preset agents. */
  starterPrompt?: string;
  author?: string;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    key: "ops_manager",
    name: "Operations Manager",
    emoji: "🎯",
    tagline: "Keeps delivery on track",
    description:
      "An always-on ops brain that watches delivery health across the workspace, then chases the things that slip — overdue, stalled, over-revised, and overloaded.",
    highlights: [
      "Flags overdue, stalled & at-risk work",
      "Spots heavy client-revision items",
      "Balances workload across the team",
      "Nudges owners in chat & posts a digest",
    ],
    accent: "#4a4ad0",
    kind: "ops",
    badge: "Featured",
    gradient: "linear-gradient(135deg,#4a4ad0 0%,#7c6cff 60%,#b46ff0 100%)",
    contexts: ["projects", "tasks", "members", "reviews", "timelogs"],
    author: "Cubes",
  },
  {
    key: "content_writer",
    name: "Content Writer",
    emoji: "✍️",
    tagline: "Drafts that sound like you",
    description:
      "Turns a brief or a task into polished copy — blog posts, docs, task descriptions and release notes — grounded in your real project context.",
    highlights: [
      "Drafts from a one-line brief",
      "Matches your tone and format",
      "Pulls facts from @projects & @files",
    ],
    accent: "#e0883e",
    kind: "preset",
    badge: "Popular",
    gradient: "linear-gradient(135deg,#f0a03e 0%,#e0663f 100%)",
    contexts: ["projects", "tasks", "files"],
    starterPrompt:
      "You are a senior content writer. Given a brief or a task, draft clear, on-brand copy (blog posts, docs, task descriptions, release notes). Use @projects, @tasks and @files to ground every claim in the team's real work. Keep it concise, skimmable, and ready to publish.",
    author: "Cubes",
  },
  {
    key: "social_manager",
    name: "Social Media Manager",
    emoji: "📣",
    tagline: "Ships your work as posts",
    description:
      "Turns shipped work and milestones into a week of on-brand social posts across channels, with hooks, captions and hashtags.",
    highlights: [
      "Weekly post calendar from real work",
      "Hooks, captions & hashtags",
      "Repurposes updates per channel",
    ],
    accent: "#e0559b",
    kind: "preset",
    badge: "New",
    gradient: "linear-gradient(135deg,#e0559b 0%,#b46ff0 100%)",
    contexts: ["projects", "social", "reviews"],
    starterPrompt:
      "You are a social media manager. Turn shipped work, launches and milestones from @projects and @social into a week of on-brand posts for LinkedIn, X and Instagram. For each post give a hook, caption and hashtags, tailored to the channel. Keep the brand voice confident and human.",
    author: "Cubes",
  },
  {
    key: "client_success",
    name: "Client Success Manager",
    emoji: "🤝",
    tagline: "Keeps clients in the loop",
    description:
      "Watches client projects and drafts warm, specific status updates — what shipped, what's next, and anything that needs the client's input.",
    highlights: [
      "Weekly client status drafts",
      "Flags blockers needing client input",
      "Summarizes progress & next steps",
    ],
    accent: "#2bb3a3",
    kind: "preset",
    gradient: "linear-gradient(135deg,#2bb3a3 0%,#3f8ff0 100%)",
    contexts: ["projects", "tasks", "reports"],
    starterPrompt:
      "You are a client success manager. For each client project in @projects, draft a warm, specific status update: what shipped this week, what's next, and anything that needs the client's decision or input. Use @tasks and @reports for the facts. Professional, concise, reassuring.",
    author: "Cubes",
  },
  {
    key: "qa_reviewer",
    name: "QA & Review Buddy",
    emoji: "🔍",
    tagline: "Catches it before the client does",
    description:
      "Reviews deliverables against the task's acceptance criteria and past revision notes, then lists concrete issues to fix before hand-off.",
    highlights: [
      "Checks work vs acceptance criteria",
      "Learns from past revision rounds",
      "Concrete, prioritized fix list",
    ],
    accent: "#8e63f6",
    kind: "preset",
    gradient: "linear-gradient(135deg,#8e63f6 0%,#4a63f6 100%)",
    contexts: ["tasks", "reviews", "files"],
    starterPrompt:
      "You are a meticulous QA reviewer. Review the deliverable against the task's acceptance criteria in @tasks and the revision history in @reviews. Return a concrete, prioritized list of issues to fix before hand-off, and call out anything a client is likely to push back on.",
    author: "Cubes",
  },
  {
    key: "people_ops",
    name: "People Ops Assistant",
    emoji: "🧑‍💼",
    tagline: "Hiring & onboarding, handled",
    description:
      "Drafts job descriptions, screens applicants against a role, and builds a first-week onboarding plan from your team's setup.",
    highlights: [
      "JD & screening question drafts",
      "Onboarding plans per role",
      "Reads @employees for context",
    ],
    accent: "#1c9c6c",
    kind: "preset",
    gradient: "linear-gradient(135deg,#3fb95a 0%,#2bb3a3 100%)",
    contexts: ["employees", "members"],
    starterPrompt:
      "You are a people-ops assistant. Draft job descriptions and screening questions, evaluate candidates against a role, and build first-week onboarding plans. Use @employees and @members to reflect how the team is actually set up. Practical and warm.",
    author: "Cubes",
  },
  {
    key: "sales_prospector",
    name: "Sales Prospector",
    emoji: "🚀",
    tagline: "Research + outreach in one",
    description:
      "Researches a prospect or client, finds the angle, and drafts a short, specific outreach sequence you'd actually want to receive.",
    highlights: [
      "Prospect & account research",
      "Finds the relevant angle",
      "Drafts a short outreach sequence",
    ],
    accent: "#f36f45",
    kind: "preset",
    badge: "Pro",
    gradient: "linear-gradient(135deg,#f0883e 0%,#e0556a 100%)",
    contexts: ["reports", "projects"],
    starterPrompt:
      "You are a sales prospector. Research a prospect or account, find the most relevant angle, and draft a short 3-step outreach sequence that is specific, human, and not salesy. Reference relevant work from @projects and @reports where it helps.",
    author: "Cubes",
  },
  {
    key: "standup_summary",
    name: "Standup Summarizer",
    emoji: "☀️",
    tagline: "The daily, without the meeting",
    description:
      "Compiles what everyone shipped, what's in flight, and what's blocked into a crisp daily standup you can drop into chat.",
    highlights: [
      "Daily progress across the team",
      "Surfaces blockers early",
      "Ready to paste into chat",
    ],
    accent: "#3f8ff0",
    kind: "preset",
    gradient: "linear-gradient(135deg,#3f8ff0 0%,#7c6cf0 100%)",
    contexts: ["tasks", "members", "timelogs"],
    starterPrompt:
      "You are a standup summarizer. From @tasks, @members and @timelogs, compile a crisp daily standup: what shipped yesterday, what's in flight today, and what's blocked (with owner). Group by person, keep it short, and format it ready to paste into a chat channel.",
    author: "Cubes",
  },
];

export function agentTemplate(key: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((t) => t.key === key);
}
