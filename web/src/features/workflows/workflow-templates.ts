"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import {
  describeSchedule,
  workflowEventByKey,
  type AppActionKey,
  type ScheduleTriggerConfig,
} from "@/lib/workflows/app-action-catalog";
import { browserTimeZone } from "@/lib/workflows/schedule";
import { newWebhookToken } from "./use-workflow-automation";
import type { Json } from "@/types/database";

/**
 * Ready-made workflows around the CRM: a web form into the pipeline, a won
 * deal into a notification. Cross-app links are deliberately workflows, not
 * hard-wired jobs, so a team can change the trigger, add a condition or a
 * notification, or chain another app step. These are just good starting points.
 *
 * Other surfaces can deep-link to /workflows?template=<key> to open the same
 * picker preselected.
 */

export type WorkflowTemplateKey = "webhook_lead_to_crm" | "crm_deal_won_notify";

export type WorkflowTemplateTrigger =
  | { type: "schedule"; config: Omit<ScheduleTriggerConfig, "timezone"> }
  | { type: "event"; config: { event_key: string } }
  /** A private URL is issued when the workflow is created; the builder shows it. */
  | { type: "webhook" };

export interface WorkflowTemplateStep {
  /** Defaults to s1, s2, … Named steps can be referenced as {{steps.<key>.<output>}}. */
  step_key?: string;
  /** Defaults to "app". */
  step_type?: "app" | "action" | "condition";
  /** App steps: the action and its params. */
  action?: AppActionKey;
  params?: Record<string, unknown>;
  /** Action / condition steps: the config as workflow_steps stores it. A
   *  notify_user user_id of "{{creator}}" becomes the member who created it. */
  config?: Record<string, unknown>;
}

export interface WorkflowTemplate {
  key: WorkflowTemplateKey;
  name: string;
  description: string;
  icon: string;
  /** installed_apps.app_key values the steps need. */
  apps: string[];
  trigger: WorkflowTemplateTrigger;
  steps: WorkflowTemplateStep[];
}

const CREATOR = "{{creator}}";

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: "webhook_lead_to_crm",
    name: "Web form → CRM deal",
    description:
      "A private URL for your website form, landing page tool or Zapier. Each post becomes a CRM deal with the person and the UTM tags. Send one test post, then match the field names with the picker.",
    icon: "webhook",
    apps: ["crm"],
    trigger: { type: "webhook" },
    steps: [
      {
        step_key: "deal",
        action: "crm.create_deal",
        params: {
          name: "",
          contact_name: "{{trigger.name}}",
          email: "{{trigger.email}}",
          phone: "{{trigger.phone}}",
          company: "{{trigger.company}}",
          status: "new",
          stage: "",
          campaign: "",
          source: "website",
          // Most form tools post the UTM tags as top-level fields; the picker
          // shows the real names once a test post has been captured.
          source_ref:
            '{"utm_source":"{{trigger.utm_source}}","utm_medium":"{{trigger.utm_medium}}","utm_campaign":"{{trigger.utm_campaign}}","page":"{{trigger.page}}"}',
          note: "{{trigger.message}}",
          dedupe: "email_or_phone",
          dedupe_days: 30,
        },
      },
      {
        step_key: "only_new",
        step_type: "condition",
        config: {
          mode: "stop",
          match: "all",
          rules: [{ left: "{{steps.deal.created}}", op: "=", right: "true" }],
          left: "{{steps.deal.created}}",
          op: "=",
          right: "true",
        },
      },
      {
        step_key: "notify",
        step_type: "action",
        config: {
          action: "notify_user",
          user_id: CREATOR,
          message: "New website lead in the CRM: {{steps.deal.name}} ({{trigger.email}}).",
          url: "/crm/deals",
        },
      },
    ],
  },
  {
    key: "crm_deal_won_notify",
    name: "Deal won → notify",
    description:
      "When a CRM deal's status becomes Converted, send a notification with the amount and the campaign it came from. Swap the notification for an HTTP step to post it to Slack or WhatsApp.",
    icon: "celebration",
    apps: ["crm"],
    trigger: { type: "event", config: { event_key: "crm.deal_status_changed" } },
    steps: [
      {
        step_key: "won_only",
        step_type: "condition",
        config: {
          mode: "stop",
          match: "all",
          rules: [{ left: "{{trigger.to_status}}", op: "=", right: "converted" }],
          left: "{{trigger.to_status}}",
          op: "=",
          right: "converted",
        },
      },
      {
        step_key: "notify",
        step_type: "action",
        config: {
          action: "notify_user",
          user_id: CREATOR,
          message: "Deal won: {{trigger.name}} — {{trigger.amount}} {{trigger.currency}}, from campaign “{{trigger.campaign_name}}”.",
          url: "/crm/deals",
        },
      },
    ],
  },
];

export function workflowTemplateByKey(key: string | null | undefined): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.key === key);
}

/** When a template's workflow runs, in words, for the picker and the confirmation. */
export function templateWhen(tpl: WorkflowTemplate, zone: string): string {
  switch (tpl.trigger.type) {
    case "schedule":
      return describeSchedule({ ...tpl.trigger.config, timezone: zone });
    case "event":
      return workflowEventByKey(tpl.trigger.config.event_key)?.label ?? "On an event";
    case "webhook":
      return "When a request hits its private URL";
  }
}

/**
 * Creates a workflow from a template: the workflow (a schedule trigger in the
 * creator's zone unless one is given, an event key, or a webhook whose URL
 * is issued here), then its steps. next_run_at is set by the database from
 * the trigger config. Team admins only (RLS).
 */
export function useCreateWorkflowFromTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      templateKey: WorkflowTemplateKey;
      timezone?: string;
      name?: string;
    }): Promise<{ id: string }> => {
      if (!teamId) throw new Error("No active team");
      const tpl = workflowTemplateByKey(input.templateKey);
      if (!tpl) throw new Error("Unknown template");

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const zone = input.timezone || browserTimeZone();
      const triggerConfig: Record<string, unknown> =
        tpl.trigger.type === "schedule"
          ? { ...tpl.trigger.config, timezone: zone }
          : tpl.trigger.type === "event"
            ? tpl.trigger.config
            : {};
      const { data: wf, error } = await supabase
        .from("workflows")
        .insert({
          team_id: teamId,
          name: input.name?.trim() || tpl.name,
          description: tpl.description,
          trigger_type: tpl.trigger.type,
          trigger_config: triggerConfig as unknown as Json,
          enabled: true,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;

      const rollback = async () => {
        // Do not leave a half-built workflow behind to fire empty.
        await supabase.from("workflows").delete().eq("id", wf.id);
      };

      const steps = tpl.steps.map((s, i) => {
        const stepType = s.step_type ?? "app";
        let config: Record<string, unknown>;
        if (stepType === "app") {
          config = { action: s.action, params: { ...(s.params ?? {}) } };
        } else {
          config = { ...(s.config ?? {}) };
          if (config.user_id === CREATOR) config.user_id = user?.id ?? "";
        }
        return {
          workflow_id: wf.id,
          position: i + 1,
          step_key: s.step_key ?? `s${i + 1}`,
          step_type: stepType,
          config: config as unknown as Json,
        };
      });
      const { error: stepsError } = await supabase.from("workflow_steps").insert(steps);
      if (stepsError) {
        await rollback();
        throw stepsError;
      }

      if (tpl.trigger.type === "webhook") {
        const { error: hookError } = await (supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> })
          .from("workflow_webhooks")
          .insert({ workflow_id: wf.id, team_id: teamId, token: newWebhookToken() });
        if (hookError) {
          await rollback();
          throw hookError;
        }
      }
      return { id: wf.id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows", teamId] });
    },
  });
}
