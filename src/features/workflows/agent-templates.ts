/**
 * Pre-built agent templates. Picking one calls create_agent_from_template,
 * which seeds a fully-configured agent (skills, system prompt, ops settings).
 */
export interface AgentTemplate {
  key: string;
  name: string;
  emoji: string;
  tagline: string;
  description: string;
  highlights: string[];
  accent: string;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    key: "ops_manager",
    name: "Operations Manager",
    emoji: "🎯",
    tagline: "Keeps delivery on track",
    description:
      "An always-on ops brain that watches delivery health across the workspace, then chases the things that slip.",
    highlights: [
      "Flags overdue, stalled & at-risk work",
      "Spots heavy client-revision items",
      "Balances workload across the team",
      "Nudges owners in chat & posts a digest",
    ],
    accent: "#4a4ad0",
  },
];

export function agentTemplate(key: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((t) => t.key === key);
}
