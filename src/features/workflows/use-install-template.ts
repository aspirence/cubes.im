"use client";

import { useCreateAgent } from "@/features/workflows/use-agents";
import { useCreateAgentFromTemplate } from "@/features/workflows/use-ops-manager";
import { serializeAgentConfig } from "@/features/workflows/agent-config";
import type { AgentTemplate } from "@/features/workflows/agent-templates";

/** A best-effort unique id (browser crypto, with a fallback). */
function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `t_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Installs a marketplace template into the active workspace and returns the new
 * agent id. "ops" templates are seeded by the server RPC (they have a
 * deterministic brain); "preset" templates seed a normal agent client-side from
 * the template's starter prompt + default @contexts.
 */
export function useInstallTemplate() {
  const createAgent = useCreateAgent();
  const createFromTemplate = useCreateAgentFromTemplate();

  return {
    isPending: createAgent.isPending || createFromTemplate.isPending,
    async install(tpl: AgentTemplate): Promise<string> {
      if (tpl.kind === "ops") {
        return await createFromTemplate.mutateAsync(tpl.key);
      }
      const prompt = tpl.starterPrompt ?? "";
      const agent = await createAgent.mutateAsync({
        name: tpl.name,
        emoji: tpl.emoji,
        description: tpl.description,
        dataScope: serializeAgentConfig({
          systemPrompt: prompt || null,
          trainingTasks: prompt
            ? [
                {
                  id: uid(),
                  title: `${tpl.name} — starter task`,
                  instruction: prompt,
                  mentions: tpl.contexts,
                  expectedOutput: null,
                  enabled: true,
                },
              ]
            : [],
        }),
      });
      return agent.id;
    },
  };
}
