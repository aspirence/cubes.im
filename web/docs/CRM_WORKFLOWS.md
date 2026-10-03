# CRM ↔ Workflows

Status: built (Sept 2026). Migration `20261148000000_crm_workflow_events.sql`
(re-runnable, defensive: every part is guarded by `to_regclass` /
`to_regprocedure`, and an emitter can never fail the write it rides on).
`20261150000000_crm_project_scope.sql` (2026-09-28, dev only so far) files
deals, people and companies under a project and adds `project_id` to the event
payload. See [CRM_PROJECT_SCOPE.md](./CRM_PROJECT_SCOPE.md).

The CRM does not talk to other apps directly. It **states facts as events** and
**offers app steps**; a workflow — a web-form webhook, a schedule, another
app's event — is the only way anything reaches it. That keeps the CRM admin-only
while still letting a member's workflow say "put this lead in Screening".

History: the Marketing app (Meta Lead Ads → CRM) was removed on 2026-09-28. This
migration once also carried a leads table for it; the file was renamed and now
holds only the CRM parts below (its header numbering starts at 2 for that reason).

## Events

| key | fires when | extra keys on top of the shared payload |
|---|---|---|
| `crm.deal_created` | a row is inserted into `app_crm_deals` | — |
| `crm.deal_status_changed` | `status` changes on a live deal (`deleted_at is null`) | `from_status`, `to_status`, `changed_at` |
| `crm.deal_stage_changed` | `stage_id` changes on a live deal | `from_stage`, `from_stage_id`, `to_stage`, `to_stage_id`, `changed_at` |

Status is how the **lead** is doing (new → contacted → follow_up → qualified →
converted / not_interested / junk); stage is where the card sits on the board.
Two events, so a workflow that celebrates a conversion never fires for a drag
between columns.

Triggers: `app_crm_deals_emit_created` (after insert) and
`app_crm_deals_emit_changed` (after update of `status, stage_id`, when
`new.deleted_at is null`). Both first ask
`app_crm_event_has_listener(team_id, key)` — an enabled workflow in the team
with `trigger_type = 'event'` and `trigger_config.event_key = key` — and build
nothing when nobody listens, so an import of a thousand deals costs nothing in
a workspace without CRM workflows. Delivery is `wf_emit_event(team_id, key,
payload)` → `workflow_events`, picked up by the runner's `tick()` (see
[AUTOMATION_CLIENT.md](./AUTOMATION_CLIENT.md) § 1.8).

### The shared payload — `app_crm_deal_event_payload(jsonb)`

One shape for all three events, so a workflow built against one event's sample
reads the others without surprises. Built from `to_jsonb(deal)` plus lookups of
the stage, the campaign and the contact:

```
deal_id,
project_id               -- the deal's project; null = filed under no project (since 20261150)
name, stage, stage_id, status,
value, amount            -- both = app_crm_deals.amount (value is the older name)
currency                 -- currency_code
campaign_id, campaign_name,
source                   -- the CRM CAMPAIGN's channel ("meta", "google", …); kept under
                         -- this name because saved workflows and the catalog sample use it
deal_source              -- app_crm_deals.source: where the DEAL came from
source_ref               -- app_crm_deals.source_ref (object, {} when empty)
company_id, contact_id, contact_name, email, phone,   -- phone: the deal's, else the contact's
owner_id, created_by, close_date, created_at
```

The catalog samples live in `src/lib/workflows/app-action-catalog.ts`
(`WORKFLOW_EVENT_KEYS`, keys above) and are what the builder's field picker
shows. Every CRM sample must carry `project_id` too, or the picker never offers
it.

**Per project.** The CRM is worked per project, but the events fire for every
deal in the team. A workflow meant for one project starts with a condition:
`stop` unless `trigger.project_id = <that project's id>`. The payload carries
the id only, not the project's name.

## `app_crm_deals.source` / `source_ref`

Added by 20261148. `source text` (nullable, ≤ 60 chars) is a short machine word for
where a deal came from — `website`, `webhook`, `workflow`; null for one typed in
by hand. `source_ref jsonb not null default '{}'` (must be an object) is whatever
the origin knew: UTM tags, the page, the form, and — always, when written by a
workflow — `workflow_run_id` and `workflow_step`. Free-shaped on purpose: an
origin we have not met yet must still be able to leave its trace. Nothing in the
CRM UI reads or writes them yet; they surface through the event payload
(`deal_source`, `source_ref`) and the `crm.create_deal` step.

## App steps — `src/lib/crm/workflow-actions.ts`

Exported as `crmActions` and dispatched by `runAppAction` in
`src/lib/workflows/app-actions.ts`, which also checks the CRM app is installed
and enabled for the team. Every query is scoped by `ctx.teamId` (the client is
service_role, RLS does not do it). **Stages, campaigns and projects are
accepted by id or by name** (case-insensitive), because a member who cannot
list the CRM still has to be able to write "Screening". A project must belong to
`ctx.teamId`; the same-team trigger from 20261150 refuses anything else anyway. Descriptors (labels, param kinds, outputs)
are in `app-action-catalog.ts` under `APP_ACTIONS`.

### `crm.create_deal` — a lead becomes a deal

Finds or creates the person (by email, then phone) and the company (by domain,
then name), files the deal under a project, attaches the campaign, records the
origin, and never makes the same lead twice.

| param | notes |
|---|---|
| `name` | deal name; empty = contact name, else email, else phone (one of them is required) |
| `contact_name`, `email`, `phone` | the person; email is validated, phone needs ≥ 7 digits |
| `company`, `company_domain` | found by domain, then by name; created when new |
| `status` | `new` (default) · `contacted` · `follow_up` · `qualified` |
| `project` | project id or name (case-insensitive, like stage and campaign), a project of this workspace; the deal is filed under it. Empty = no project (the deal shows under "No project" in the CRM). An unknown project fails the step. A person or company the step **creates** is filed under the same project; one it **finds** keeps its own. |
| `stage` | id or name; empty = the first stage of the board |
| `campaign` | CRM campaign id or name — the attribution |
| `amount`, `currency`, `close_date` | number; three-letter code (empty = the campaign's, else the CRM default); `YYYY-MM-DD` |
| `source` | ≤ 60 chars, default `workflow` |
| `source_ref` | a JSON object (string or mapped object); `workflow_run_id` / `workflow_step` are added |
| `note` | added as a CRM note — on a duplicate, to the existing deal |
| `dedupe` | `email_or_phone` (default) · `email` · `phone` · `none` |
| `dedupe_days` | default 30, `0` = any time |

With dedupe on, an **open** deal (status new / contacted / follow_up /
qualified) for the same person inside the window is returned instead of a new
one — `created = false`, `duplicate = true` — so a form that posts twice never
doubles the pipeline. `dedupe: none` also skips the person lookup and creates a
fresh contact. Dedupe looks at the person's open deals in **every** project,
as before, so the deal returned may sit in another project than `project`
(its `project_id` output says where).

Outputs: `deal_id`, `created`, `duplicate`, `name`, `status`, `stage`, `stage_id`,
`campaign_id`, `campaign_name`, `contact_id`, `contact_name`, `email`, `phone`,
`company_id`, `project_id`, `amount`, `currency`, `url` (path to open the deal
in the CRM).

### `crm.update_deal` — change a deal, blank params leave a field alone

| param | notes |
|---|---|
| `deal_id` | required — `{{trigger.deal_id}}` or `{{steps.find.deal_id}}` |
| `status` | any of the seven statuses, or empty |
| `project` | project id or name: moves the deal to that project. Empty leaves it where it is (a workflow cannot unfile a deal; do that in the CRM). |
| `stage`, `campaign` | id or name |
| `amount`, `close_date`, `name` | as above; `name` renames |
| `note` | adds a CRM note |

Outputs: `deal_id`, `status`, `stage`, `campaign_id`, `project_id`, `changed`
(the fields that changed, `project_id` among them after a move), `url`.

### `crm.find_deal` — nothing found is an answer, not a failure

| param | notes |
|---|---|
| `deal_id` | by id (live deals only) … |
| `email`, `phone` | … else the newest open deal for the person matched by email, then phone |

Outputs: `found` (filter on it), `deal_id`, `name`, `status`, `stage`,
`campaign_id`, `contact_id`, `contact_name`, `email`, `phone`, `amount`, `url`.

## Templates — `src/features/workflows/workflow-templates.ts`

- **Web form → CRM deal** (`webhook_lead_to_crm`): a webhook trigger (a private
  URL for a website form, landing-page tool or Zapier) → `crm.create_deal` with
  `contact_name` / `email` / `phone` / `company` / `message` mapped from the
  post, `source: website`, `source_ref` = the UTM fields and page, dedupe by
  email or phone for 30 days → a `stop` condition unless `steps.deal.created`
  → notify the workflow's creator. Send one test post, then match the field
  names with the picker.
- **Deal won → notify** (`crm_deal_won_notify`): event `crm.deal_status_changed`
  → `stop` unless `trigger.to_status = converted` → notify the creator with the
  amount, currency and campaign. Swap the notification for an HTTP step to post
  it to Slack or WhatsApp.

Both need the CRM app installed (`apps: ["crm"]`); creating one is team-admin
only (RLS on `workflows`).
