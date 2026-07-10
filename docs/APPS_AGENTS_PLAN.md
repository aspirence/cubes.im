# Workflows + Agents + Apps — Feature Plan (v2)

> Status: DRAFT v2 — restructured around a Pabbly-Connect-style **Workflow** model per Rahul's direction.
> v1 research retained below (WhatsApp / OpenRouter / competitors / codebase-reuse). Add notes inline anywhere.

## 1. The model (three layers)

```
APPS (App Center)     = connectors: WhatsApp, Slack, Email, Webhook (+ more later)
        ▲ used by
WORKFLOWS             = the orchestration engine (Pabbly-style): Trigger → Step → Step → ...
        ▲ invoked as a step
AGENTS                = reusable personas: skills bundle + data scope ("HR Analyst", "PM Reporter")
```

- **Workflow** answers: *kab chale, kis sequence mein kya ho, kis tool se kya jaye, kis member ko kya karna hai.*
- **Agent** answers: *kaun analyze karega, kaunsa data, kaunsi skills.* One agent → attach in many workflows.
- **App** answers: *bahar ki duniya se kaise judna hai* (send + receive).

### Pabbly parity (what users already understand)

| Pabbly | Ours | Notes |
|---|---|---|
| Trigger | Trigger step | schedule / internal event / inbound integration |
| Action | App step + Internal-action step | send WhatsApp/Slack/email; create/assign task, notify |
| Filter | Condition step | if/else on step data |
| Router | Branch step (post-v1) | multi-path |
| Delay | Delay step (post-v1) | wait mins/days/until |
| — (no equivalent) | **Agent step** | deterministic skills → data/report into the flow |
| — (no equivalent) | **Human step** | team member approval/input — pauses the run |
| Task counting: internal steps free | Deterministic steps free; **AI steps only** cost tokens | same mental model |

### Token economics (unchanged core requirement)

- **Build-time AI (OpenRouter)**: user prompt → compiled *workflow draft* (trigger + steps + params + templates). One call per create/edit. Preview → user approves.
- **Run-time**: **zero tokens.** Agent steps run registry RPCs; templates render deterministically; conditions evaluate on data; delivery via connectors.
- **Explicit AI step** (optional step type, off by default): narrative summary / classification inside a flow — clearly labeled "uses AI tokens".

## 2. Workflow anatomy

### Step types (v1 set)

| Step type | Config | Output into flow context |
|---|---|---|
| `trigger.schedule` | cron + tz | `{fired_at}` |
| `trigger.event` | internal events (task created/status changed/assignee added — reuses automations matchers; + HR: leave applied/approved) | event row data |
| `trigger.inbound` (post-v1) | webhook received / WhatsApp message | payload |
| `agent` | agent_id + param overrides (date range etc.) | skills output: `{overview: {...}, overdue: [...]}` |
| `condition` | `{left: "{{steps.s1.overdue_count}}", op: ">", right: 5}` | pass/stop (v1); branch (post-v1) |
| `action` | internal ops: create_task, assign_member, add_comment, notify_user (reuses automations executor actions) | created ids |
| `app` | connection_id + template + recipients (`{{...}}` interpolation) | delivery status |
| `human` | assignee (team_member), ask: approve/reject ya input, due + reminder, timeout behavior (skip/stop) | `{decision, note, acted_by, acted_at}` — **run pauses till action** |
| `ai` (post-v1, opt-in) | model + prompt template over context | text |

**Context object**: har step apna output `steps.<key>` mein daalta hai; aage ke steps `{{steps.s1.output.x}}` se use karte hain (Pabbly-style field mapping; builder mein dropdown picker).

### Example (Rahul's HR scenario, ab multi-step)

```
Workflow: "Weekly HR pulse"
Trigger: Monday 9:00 IST
s1 Agent "HR Analyst"     → hr_analytics + availability skills → data
s2 Condition              → s1.leave_pending > 0 ?
s3 Human: HR Manager      → "Pending leaves review karo" (approve/note) — run waits
s4 App: WhatsApp (founder)→ utility template: headcount, attendance %, s3.note
s5 Action                 → if s1.overdue_tasks > 5 → create task "Sprint review call" assigned to PM
```

Run history mein har step ka input/output/status dikhega (Pabbly task-history jaisa).

## 3. Data model

```
workflows        (id, team_id, name, description, enabled,
                  trigger_type CHECK, trigger_config jsonb, next_run_at timestamptz,
                  prompt text,                 -- original NL ask (recompile ke liye), nullable (manual builds)
                  created_by, run_count, last_run_at, created_at, updated_at)

workflow_steps   (id, workflow_id FK cascade, position int, step_key text,   -- 's1','s2' for {{refs}}
                  step_type CHECK IN ('agent','condition','action','app','human','ai'),
                  config jsonb CHECK object, enabled bool)

agents           (id, team_id, name, emoji, description,
                  skills jsonb,                -- [{skill, params}] validated vs server registry
                  data_scope jsonb,            -- team/org bounds
                  created_by, created_at, updated_at)

workflow_runs    (id, workflow_id, status CHECK ('running','waiting_human','success','error','stopped'),
                  context jsonb,               -- accumulated steps.* outputs
                  current_position int, trigger_snapshot jsonb,
                  started_at, finished_at, error text)

workflow_step_runs (id, run_id FK cascade, step_id, status, input jsonb, output jsonb,
                    error text, started_at, finished_at)

human_actions    (id, step_run_id FK, workflow_run_id, assignee_team_member_id, kind CHECK ('approval','input'),
                  title, note_request, status CHECK ('pending','approved','rejected','done','expired'),
                  decision_note text, due_at, acted_by, acted_at, created_at)

app_connections  (id, org_id, provider CHECK ('webhook','slack','email','whatsapp'), name, enabled,
                  config jsonb, created_by, timestamps)          -- non-secret
app_connection_secrets (connection_id PK/FK, credentials jsonb)  -- deny-all to authenticated; service_role only

delivery_outbox  (id, run_id, step_run_id, connection_id, payload jsonb,
                  status CHECK ('pending','sent','failed'), attempts int, last_error, created_at, sent_at)
```

RLS same discipline as automations: read = team member, write = team admin; runs/step_runs/outbox written by SECURITY DEFINER executor; secrets service-role only. Sab pattern `20261009000000_automations_engine.sql` se.

## 4. Execution engine (the state machine)

- **One pg_cron sweep** (`run-due-workflows`, every 5 min) — `materialize_recurring_tasks` ka proven pattern: due schedules → create `workflow_runs` → step loop.
- **Step loop** (`advance_workflow_run(run_id)` SECURITY DEFINER): current step execute karo → output context mein merge → next position. `human` step pe: `human_actions` row + notification (in-app; app-connection reminder optional) → run `waiting_human` pe park. Jab assignee app mein approve/reject karta hai (UI: "My approvals" inbox) → RPC decision record karke `advance_workflow_run` resume karta hai.
- **Event triggers**: automations engine ke matcher triggers extend/reuse — event fires → matching workflows ke runs enqueue (depth-guard already solved wahan).
- **App steps** → `delivery_outbox` row; ek Next route-handler poller (ya baad mein pg_net) service-role se credentials padh ke send karta hai, status/attempts update karta hai. WhatsApp = graph API template send; Slack = incoming webhook; Email = Resend; Webhook = POST + optional HMAC.
- **Error isolation**: per-step try/catch → step_run.error + run status 'error', sweep kabhi nahi girta (automations executor ka idiom).
- Cron ke paas auth.uid() nahi hota — executor workflow row ke stored team/org ko authority maanta hai (same trust move as recurring tasks); creation admin-gated hai to escalation nahi.

## 5. UI plan (saare surfaces)

### 5.1 Workflow Builder — the centerpiece (3-pane layout)

```
┌──────────────────────────────────────────────────────────────────────┐
│ TOP BAR: name · enable toggle · ✨AI assist · Test run · Save        │
├──────────────┬────────────────────────────────┬──────────────────────┤
│ STEP LIBRARY │            CANVAS              │      INSPECTOR       │
│ (palette)    │   (v1: vertical stepper,       │  (selected step ka   │
│              │    Pabbly-style; branching     │   config panel)      │
│ 🔍 search    │    post-v1 as indented paths)  │                      │
│ ▸ Triggers   │                                │  auto-generated form │
│ ▸ Agents     │   ⚡ Trigger: Mon 9:00         │  (input_schema se)   │
│ ▸ Data/Skills│      │                         │                      │
│ ▸ Logic      │   🤖 s1 Agent: HR Analyst      │  "Insert data" picker│
│ ▸ Actions    │      │                         │  = upstream steps.*  │
│ ▸ Apps       │   ⑂ s2 Condition: leaves>0    │  outputs ka tree     │
│ ▸ Human      │      │                         │                      │
│ ▸ AI (label: │   👤 s3 Approval: HR Manager   │  [Test this step]    │
│   uses tokens)│     │                         │  sample output view  │
│              │   💬 s4 WhatsApp → Founder     │                      │
│ (Apps jo     │      │                         │                      │
│ connected    │   ➕ add step                  │                      │
│ nahi = greyed│                                │                      │
│ + "Connect") │                                │                      │
├──────────────┴────────────────────────────────┴──────────────────────┤
│ TEST CONSOLE (bottom drawer): step-by-step run, input/output JSON     │
└──────────────────────────────────────────────────────────────────────┘
```

- **Step Library**: searchable, categorized; har entry = icon + naam + one-liner "kya kar sakta hai"; hover/click pe detail (inputs, outputs, requirements). **Palette poori tarah capability registry se render hota hai** (section 6) — hardcoded nahi. Unconnected app ke steps greyed + "Connect in App Center" CTA. AI step pe "uses AI tokens" badge.
- **Canvas v1** = vertical stepper (dnd-kit already in deps; reorder drag se). Step card: icon, naam, config summary line, ⚠ badge agar config incomplete, output-fields count pill. Click = inspector kholta hai.
- **Inspector**: config form **auto-generated from the capability's input JSON Schema** (AntD renderer — ek baar banao, har step type free milta hai). Field values mein "Insert data" picker: upstream steps ke output_schema ka tree (Pabbly ka field-mapping feel). Niche "Test this step" — sample/pichle-run data pe akela step chala ke output dikhao.
- **Top bar AI assist (✨)**: prompt box — naya draft ya "isme ye change kar do" → OpenRouter compile → **diff-preview canvas pe** (added/changed steps highlighted) → accept/tweak. AI = compile-time only.
- **Test console**: bottom drawer — pura test run, har step ki timeline, input/output JSON viewers, error red mein. (Pabbly task-history parity.)

### 5.2 Baaki surfaces

| Surface | Kya hai |
|---|---|
| **/workflows** (top-level sidebar item "Workflows") | list: naam, trigger summary chip, enable toggle, last-run status, run count; "New" → blank / template / ✨AI prompt |
| **Run history** (per workflow tab) | runs table → expand = per-step timeline; filters; "Re-run" |
| **My Approvals** (navbar badge + page) | pending human steps: context card (workflow, data snapshot, requester), Approve/Reject + note, due countdown; act karte hi run resume |
| **App Center** (sidebar "Apps") | provider card grid — har card pe "enables: N triggers, M actions" (registry se counted); connected list with health dot + "Test"; detail page = config + write-only secrets form + "used by X workflows" |
| **Agents** (sidebar ya /workflows ke andar tab) | gallery cards (emoji, naam, skills chips, used-in-N-workflows); editor = skills picker (registry se, param forms auto) + data scope + "Preview output" |
| **Templates gallery** | prebuilt workflows preview ke saath → "Use template" → builder prefilled |

## 6. Capability registry — customizability ka core

**Har cheez jo palette mein dikhti hai ek `capability` descriptor hai.** UI, executor, aur AI-builder teeno isi ek registry se chalte hain — yahi full-customizability aur future MCP ka foundation hai.

```jsonc
{
  "key": "skill.hr_analytics",
  "kind": "trigger | skill | action | app_action | app_trigger | logic | human | ai",
  "title": "HR Analytics",
  "description": "Headcount, attendance rate, pending leaves, joiners/exits",
  "icon": "monitoring", "category": "HR",
  "input_schema": { /* JSON Schema → inspector ka form auto-render */ },
  "output_schema": { /* JSON Schema → downstream field-mapping picker */ },
  "requires": { "connection_provider": null, "min_role": "member", "org_scope": true },
  "source": "builtin",            // ya "mcp:<connection_id>"
  "runtime": { "executor": "rpc:hr_org_analytics" }   // ya "http:outbox", "mcp:tool"
}
```

- **v1**: registry code mein (`src/lib/workflows/capabilities.ts`) + DB CHECK enums — automations engine wala "AI proposes, server validates, DB enforces" discipline.
- **Naya step type add karna** = 1 descriptor + 1 executor handler. UI (palette entry, config form, mapping picker) aur AI-builder enums **khud update** ho jate hain.
- **AI builder** ko compile pe yahi registry context milta hai — wo sirf registered capabilities wire kar sakta hai, kabhi invent nahi.

## 7. MCP roadmap (verified: spec RC 2026-07-28)

MCP 2026 mein production-grade ho chuka hai: stateless HTTP core (plain load-balancers pe chalta hai), OAuth 2.1 authorization, cacheable `tools/list` (ttlMs), official registry (~2000 servers), MCP Apps (server-rendered UI) + Tasks (long-running work) extensions.

**Phase M1 — MCP client (Apps hub ka extension):**
- App Center mein "Connect MCP server": URL + OAuth 2.1 consent flow (ya token) → `app_connections` row (provider='mcp').
- Connect hote hi `tools/list` discover → **har tool ek capability descriptor** ban jata hai (`source: "mcp:<connection_id>"`, input_schema tool ke schema se) → palette mein "From <server>" category apne aap.
- Workflow step type `mcp_tool`: runtime pe deterministic tool call (mapped params, koi LLM nahi) — **zero-token promise intact**; AI sirf compile pe wiring karta hai.
- Executor: outbox poller se Streamable HTTP call, service-role-stored creds. `tools/list` ttlMs respect karke cache.

**Phase M2 — apna MCP server:** cubes skills/actions ko MCP server ki tarah expose karo (`.well-known` server card) — tab Claude/ChatGPT/koi bhi external agent hamare workspace pe (scoped OAuth ke saath) kaam kar sakta hai. Ye "accessibility" vision ka endgame hai: hamari skills bahar ke AI ke liye, bahar ke tools hamare workflows ke liye.

**Phase M3 (explore) — AI-authored capabilities:** user AI se bole "Google Sheets me rows likhne ka step banao" → AI MCP registry se suitable server suggest kare → connect → capability ready. (MCP registry search API se.)

## 8. Phases (revised)

- **A — Apps hub**: app_connections + secrets + App Center UI + webhook & Slack + test-connection. *(WhatsApp verification parallel start.)*
- **B — Workflow engine + registry core**: capability registry v1 + auto-form renderer + agents/skills (7 builtin) + linear runner + Builder UI (palette/canvas/inspector/test-console) + Run-now + run history. In-app delivery. *Acceptance: HR pulse workflow builder mein bane, test-run end-to-end, zero tokens.*
- **C — Scheduler + Human + external delivery**: pg_cron sweep + human step (Approvals inbox, pause/resume) + app steps via outbox (Slack/webhook/email-Resend). *Acceptance: unattended Monday run, HR approval pe rukta hai, resume pe Slack+email.*
- **D — AI builder + WhatsApp + event triggers**: ✨ compile/patch endpoint + diff-preview; WhatsApp connector; trigger.event (automations matchers reuse). *Acceptance: NL prompt → working workflow; founder ko WhatsApp report.*
- **E — MCP client (M1)** + Router/Delay steps + Templates gallery.
- **F — Later**: AI step type (metered), inbound triggers (WhatsApp reply → workflow), chat-with-agent, apna MCP server (M2), AI-authored capabilities (M3).

**Existing automations engine ka future**: abhi as-is rahega (lightweight single-shot rules). Workflows mature hone pe "Open as workflow" migration option — automations = quick rules, workflows = orchestration. (Open question #6.)

## 9. Research appendix (v1 — still current)

### WhatsApp (Meta Cloud API, Jul 2026)
Per-message pricing (Jul 2025 se): sirf delivered **template** msgs billed, category+country wise (India utility ≈ ₹0.145, marketing ≈ ₹1.09; US utility ≈ $0.004). Free-form service replies **free** in 24h window (user ke message se khulta hai). Business-initiated hamesha approved template + opt-in. Onboarding: Meta app + WABA + fresh phone number + business verification (days–weeks; bina verification 250 unique recipients/24h; verified Tier-1 1k/day auto-scaling). Templates: header (text/media/PDF doc) + body vars + URL buttons; approval usually same-day; Meta re-categorize kar sakta hai (utility→marketing) — digest wording transactional rakho. Webhook: HMAC-SHA256 signed, statuses + inbound same endpoint. Direct Cloud API = zero platform fee; Twilio = +$0.005/msg dono direction (dev sandbox instant); 360dialog ≈ €49/mo no-markup alternative. **Recommendation: direct Meta Cloud API; verification Phase A ke saath shuru.**

### OpenRouter (Jul 2026)
OpenAI-compatible `/api/v1/chat/completions`, Bearer auth, attribution headers (`HTTP-Referer`, `X-OpenRouter-Title`). Structured outputs `response_format json_schema strict` (set `provider.require_parameters: true`), tool-calling normalized. `models: []` ordered fallback; `:floor` cheapest / `:nitro` fastest; `openrouter/auto` router. Pass-through pricing + 5.5% credit fee; BYOK (1M req/mo free). `:free` models capped 50–1000 req/day — production pe nahi. **Recommendation: plain fetch behind `src/lib/ai/openrouter.ts`** (same getClient/mapError/extractJson surface as anthropic.ts); app-level key to start, BYOK later.

### Competitor patterns
ClickUp "App Center" + "Autopilot Agents" (trigger/conditions/instructions/knowledge/tools anatomy); Monday agents (Define→Connect→Test, skills, approvals, credit-mandatory from May 2026 $0.01/credit); Asana AI Studio (rule-builder + AI steps, pooled credits, hard-stop on exhaustion); Notion Custom Agents (instructions page = memory, schedules, Slack/email delivery, $10/1k credit add-on); Slack Marketplace + Workflow Builder. **Sab per-run credits lete hain — hamare deterministic runs free hona differentiator hai.** Naming: hub = sidebar "Apps" / page "App Center"; agents = plain "Agents"; ab orchestration = "Workflows" (Pabbly/Zapier-generic, self-explanatory).

### Codebase reuse map
- **Skills-ready RPCs**: `report_team_overview/projects/members/time_logs`, `hr_org_analytics`, `get_team_member_availability`, `admin_org_overview` — sab SECURITY DEFINER + membership-gated.
- **Automations engine** (20261009 migration): config-table pattern, executor idiom (CASE dispatch, error-swallow to run log), matcher triggers (event sourcing for `trigger.event`), RLS shape — workflows schema iska superset.
- **pg_cron sweep idiom**: `materialize_recurring_tasks` (hourly) + `accrue_monthly_leave` — guarded DO-block registration; one sweep job, not per-entity jobs.
- **create_notification()** — in-app delivery free day-one; **email/Slack/WhatsApp infra net-new** (koi edge functions/Resend abhi nahi) → outbox + route-handler poller.
- **AI route skeleton** (`/api/ai/*` + `src/lib/ai/anthropic.ts`): SSR auth → validate → RLS context → json_schema output → clamp → mapError. Compile endpoint isi ka clone.
- **Secrets precedent**: koi encryption infra nahi; service-role-only table + route-handler pattern (`api/account/delete` jaisa) codebase-consistent hai.
- **Settings CRUD + section-nav registry** — Apps/Workflows/Agents pages inhi patterns pe.

## 10. Open questions (Rahul — add/answer here)

1. **Scope**: workflows team-level (recommended) — HR agents ke liye org-level data_scope allow karein? (HR skills org-gated hain hi)
2. **OpenRouter key**: app-level single key (recommend, compile-only cost) ya workspace BYOK day-one?
3. **WhatsApp recipients**: sirf members (verified number + consent) ya external (founder/client jo member nahi)? External ke liye alag consent flow chahiye.
4. **Report format**: text/template v1; PDF attachment (jsPDF hai) kab?
5. **Human step v1**: approve/reject + note kaafi hai, ya form-input fields bhi?
6. **Automations engine**: alag rakhein (quick rules) ya workflows mein merge long-term?
7. **Branching (Router)**: v1 mein sirf linear + stop-condition, ya Router bhi v1 mein chahiye?
8. **Builder-first ya AI-first**: manual builder pehle (recommended — AI compile usi pe preview karta hai) theek hai?

## 11. Honest takes / risks

- Workflow engine = automations se **bada** lift: state machine (pause/resume), context passing, outbox. Lekin sab building blocks proven hain isi codebase mein — naya sirf composition hai.
- **Human step** sabse zyada naya surface hai (approvals inbox + resume semantics + timeouts) — isliye Phase C mein, core runner ke stabilize hone ke baad.
- Field-mapping UX (`{{steps.s1.x}}` pickers) hi Pabbly-feel ka asli kaam hai — builder pe design time lagana worth it.
- WhatsApp still the long pole (verification/templates/opt-in) — Slack/email same value days mein dete hain.
- "Zero token runs" tabhi tak sach hai jab tak skills registry disciplined hai — AI-generated SQL kabhi nahi; naya data chahiye to nayi skill server-side add hoti hai.
