# CRM by project

Status: dev, 2026-09-28. Migration `20261150000000_crm_project_scope.sql` is
applied to the dev database (sivarq…) only. Prod (txrp…) needs it pushed before
this ships. Until then every create or edit that sends `project_id` is rejected
there (unknown column), and every record shows only under "No project".

This file is the contract. Change it here first.

## Why

The user decided on 2026-09-28: "CRM by project hi karna padega, company wala
feature khatam kr do". The CRM is worked per **project**. This replaces the
one-day company scope: `docs/CRM_COMPANY_SCOPE.md` is deleted, along with its
company switcher, the "Focus CRM on this company" actions and the project view
linked to a company.

A company is a plain record field again (`deal.company_id`,
`person.company_id`). It is not the scope.

## Data model

Migration `20261150000000_crm_project_scope.sql` is re-runnable, and RLS is
unchanged (`is_crm_admin` on every CRM table). It adds:

- `project_id uuid` (nullable) on `app_crm_deals`, `app_crm_people` and
  `app_crm_companies`. The FK to `projects(id)` is `on delete set null`, so
  deleting a project never deletes sales data: its records become unfiled.
  Index `(team_id, project_id)` on each.
- A same-team guard, `app_crm_project_same_team()`. It runs as a trigger before
  insert or update of `project_id, team_id` on all three tables, and raises a
  `check_violation` when the project belongs to another team. A project id from
  workspace A can never file a record into workspace B's project view.
- A `project_id` key in the deal event payload
  (`app_crm_deal_event_payload`), right after `deal_id`. See
  [CRM_WORKFLOWS.md](./CRM_WORKFLOWS.md).

Each record's `project_id` is its own. A person's project does not follow their
company's, and a deal's does not follow its contact's or company's. Nothing
cascades. Tasks, notes, reminders and activities have no `project_id`: they
follow their targets (see the resolver rules below).

**Every existing record starts unfiled.** On dev after the migration: 18 live
deals, 1 company, 0 people, none filed. The first load after the change opens
on the first project A–Z, which is empty. Pick "No project" in the bar and use
the bulk move (deals, people) or the Project field (companies) to file them.

## The switcher

The bar above every CRM tab is `CrmScopeBar`, mounted once by `crm/layout.tsx`.

- **Always one project, never "All".** The CRM shows the project last chosen,
  else the first live project A–Z, which is then saved so it stays put. There is
  no all-projects view.
- **Remembered per team.** The choice is stored in the browser, in the
  `crm-prefs` store (`scopeByTeam`, `recentByTeam`), keyed by team so one
  workspace's project never filters another's. Store version 3: a v2 value held
  company ids and is dropped, not reinterpreted. `lastCompanyId` and
  `lastCampaignId` carry forward.
- **Options.** The Select has three groups:
  - "Recent": up to 5 projects, newest first, live only.
  - "Projects": every live project A–Z.
  - "Unfiled": one entry, "No project" (`NO_PROJECT`, `"__none__"`).

  Each option shows its live deal count. "No project" is always offered, so
  unfiled records are never unreachable, and picking it never evicts a recent
  project.
- **Right side of the bar.** On desktop, a chip reads
  "<Project> · N deals · M people". An "Open project" button, shown for a real
  project only, goes to `/projects/<id>?tab=crm`. That lands on the project's
  CRM view when the project has one, else on its first tab, because the project
  page ignores tab keys it does not know. On `/crm/campaigns` and
  `/crm/settings` a one-line hint replaces the chip, desktop only. On mobile the
  Select is full width.
- **Live projects** means the projects `useProjects()` returns: the team's
  projects the viewer can access (RLS `can_access_project`), minus the ones this
  viewer archived. Archiving is per user (`archived_projects`).
- **Self-heal.**
  - Nothing saved yet: the default is saved.
  - Saved project gone (archived, deleted, no longer visible, another
    workspace's id): the bar moves to the first live project and says once,
    "That project is no longer available — showing <name>."
  - Saved project gone and no live projects left: the saved value is cleared.
  - None of this runs while the projects list is refetching, so a project
    created a moment ago is not treated as gone.
- **Loading.** Nothing renders under the provider until the projects list has
  answered, because showing everything for one frame would be the "all" view
  that does not exist. If the list errors, the CRM renders unscoped, which is
  better than a spinner forever. With no projects at all the CRM is unscoped
  (`inScope` always true). That is the only unscoped state.

### Where it lives

- `src/app/(app)/crm/_lib/crm-prefs-store.ts`: `NO_PROJECT`, `scopeByTeam`,
  `recentByTeam`, `setScope(teamId, projectId | null)`.
- `src/app/(app)/crm/_lib/crm-scope.tsx`: `CrmScopeProvider`,
  `useCrmScope()`, `useCrmScopeResolver()`, `useResetOnScopeChange()`,
  `useScopeMismatchNotice()`. The file header carries the drift rule.
- `src/app/(app)/crm/_components/crm-scope-bar.tsx`: `CrmScopeBar` and
  `ScopedEmptyState`.
- The data hooks in `src/features/app-crm/*` are untouched. Caches stay
  team-wide, so switching projects re-renders over warm data and never
  refetches.

`useCrmScope()` returns:

| field | meaning |
|---|---|
| `selection` | the switcher's value: a project id, `NO_PROJECT`, or null (no projects). Use it for keys and comparisons. |
| `projectId` | the real project id, or null under "No project" and when unscoped. A new record is filed under this. |
| `project` | `{ id, name, color }` for titles. Under "No project" it is `{ id: NO_PROJECT, name: "No project" }`. |
| `isScoped`, `isNoProject` | flags for the current view |
| `fixed` | true inside a project's CRM view: pinned, nothing persisted, nothing switches |
| `projects` | the live projects, A–Z (the Project field's options) |
| `recentIds` | recently picked projects, newest first, live only |
| `setProjectId(id)` | switches to a project id or `NO_PROJECT`; a no-op when `fixed` |
| `inScope(projectId)` | true when a record with this `project_id` belongs in the view |

Match with `inScope` or the resolver, never with `projectId === …`: under
"No project" `projectId` is null, and such a comparison shows nothing.

## Per tab

| Tab | Rule |
|---|---|
| Dashboard (/crm/dashboard) | Every panel shows the project's records: the deals table with its status/sort toolbar and CSV export, pipeline-by-stage counts, My reminders, My open tasks and Recent activity. Stages stay the team's pipeline; only the counts change. With no deals in the project it shows `ScopedEmptyState nouns="deals"` with New deal. |
| Deals (/crm/deals) | The board, the table, both StatTiles, closing-in-30 and the Deleted view show deals where `inScope(deal.project_id)`. Status, tag, search and deleted filters stack on top. Stage columns are team config. A new deal's `position` is computed over the real column (every live deal in the stage, other projects' included), never the visible subset. A new deal is filed under the current project. Bulk move is available, and the bulk selection resets on a project switch. |
| People (/crm/people) | Shows people where `inScope(person.project_id)`. Unfiled people appear only under "No project". The Deleted toggle and search stack on top. A new person is filed under the current project, and the company field starts empty. Bulk "Set company" keeps working across companies. Bulk move is available, and the selection resets on a project switch. |
| Companies (/crm/companies) | **Scoped now** (companies carry `project_id`): shows companies where `inScope(company.project_id)`. A new company is filed under the current project. The company-era "Current" chip, the pinned current row and "Focus CRM on this company" are gone. The selection resets on a project switch. There is no bulk move: a company is moved through its form or its drawer. |
| Tasks (/crm/tasks) | A task is shown when any of its targets resolves to the project. Untargeted tasks, and tasks whose targets are all unfiled, appear only under "No project". Status, My tasks, due and search stack on top. The selection resets on a project switch. A task has no Project field: to show it in a project, link it to a deal, person or company in that project. |
| Notes (/crm/notes) | Same target rule as tasks. The All/People/Companies/Deals control stays a kind filter inside the project. Author, search and sort stack on top. Clearing filters leaves the project alone; only the bar changes it. |
| Reminders (/crm/reminders) | Open reminders whose single target resolves to the project. Then the page's own filters apply as before (not done, Mine only, search), and the tiles and Overdue/Today/Upcoming buckets follow. The selection resets on a project switch. There is no create UI here: ReminderQuickAdd lives in the record drawer. |
| Reports (/crm/reports) | Deal, people, company and task figures are the project's. The range and owner filters stack on top. Stages, labels, members and campaign names stay team config. Leads by campaign narrows the lead bars but suppresses cost per lead under a project, because campaign spend has no project dimension. The growth chart's Companies series counts the project's companies. |
| Campaigns (/crm/campaigns) | Workspace-wide and unchanged: campaign rows, the spend ledger, lead counts and cost per lead cover every project. The bar's hint reads "Campaigns are workspace-wide: every project's leads and spend." |
| Settings (/crm/settings) | Unscoped. Access grants, pipeline stages and lead tags are team vocabulary, and the delete-confirmation counts must describe every deal. Hint: "Settings apply to every project." |
| Record drawer and `?m=` deep links (every tab) | A record always opens regardless of the project and never changes it. A record outside the current project shows a notice naming its project (or "no project") with a Switch button; there is no Switch in a pinned project view. The deal, person and company drawers have a Project field (see below). |
| Relations picker, DealQuickCreate, paste capture | The relations picker (`target-picker.tsx`) lists every live record: linking a note to another project's contact is legitimate. A pasted lead that names a company keeps that match (the text is evidence). Otherwise the deal's company defaults to the last one used (`lastCompanyId`), and the scope has no say in the company. |

**Drift rule.** Every list a CRM page renders must pass through `inScope`,
`targetInScope` or `targetsInScope`. These consumers stay team-wide on purpose:

- `record-drawer.tsx`: the record lookup.
- `target-picker.tsx`: the relations picker.
- `paste-deal.tsx`: matching a pasted lead.
- `campaigns/page.tsx`: spend has no project dimension.
- `settings/page.tsx`: delete confirmations count every deal.

**Copy rule.** No UI text mentions a "current company", "focus" or "All
companies". Empty states come from `ScopedEmptyState`:

- Under a project: "No <nouns> in <Project> yet". The default description is
  "Create one in <Project>, or pick another project in the bar above.", and
  New <noun> shows where the page can create.
- Under "No project": "No <nouns> without a project".

## Creating and moving records

- **Create forms (deal, person, company)** carry an editable **Project**
  Select.
  - Options: `scope.projects`. `allowClear` means no project.
  - Default: `scope.projectId`, so null under "No project".
  - The record is inserted with that `project_id`.
- **Company fields go back to their pre-scope defaults.** The deal form
  defaults to the live `lastCompanyId`. The person form starts empty. The
  company is never preselected from the project.
- **Edit forms and the record drawer** carry the same Project field, so a
  record can be filed or moved at any time.
- **Bulk move** on Deals and People moves the selected rows to one project, or
  to no project. Rows that leave the current project leave the view.
- **After every create or edit**, the page calls
  `notify({ recordProjectId: <saved project_id>, noun, verb })` from
  `useScopeMismatchNotice()`. The verb is "created in" (the default) or
  "moved to" for edits and moves. It does nothing when the record is still in
  view. Otherwise it shows, for 6 s:
  - On /crm: "<Noun> created in <Other> — not shown under <Project>." with a
    Switch button.
  - In a pinned project view: "<Noun> created in <Other> — it is in the CRM,
    not in this project's view."

  A move is never blocked. The project is a default, never a constraint.
- **Tasks, notes and reminders** have no Project field. They live where their
  targets live.

## The project's CRM tab (view key `crm`)

"+ View → CRM" on a project shows **the same CRM dashboard as /crm/dashboard**
(pipeline by stage, the deals table with its bulk actions, my reminders, my
open tasks, recent activity, New deal, paste a lead), showing only what is
filed under the project. The dashboard is one component,
`src/app/(app)/crm/_components/crm-dashboard.tsx` (`CrmDashboard`); the
/crm/dashboard page renders it plainly and the tab renders it `embedded`.
The tab itself (`src/app/(app)/projects/[id]/_components/crm-tab.tsx`) only
holds the gates and the provider.

- **The project is the scope.** The tab wraps the dashboard in
  `CrmScopeProvider fixedProjectId={projectId}`: `scope.fixed` is true,
  `setProjectId` is a no-op, nothing is read from or written to the saved
  choice, and neither the drawer notice nor the mismatch toast offers Switch.
  A pinned project missing from the viewer's list (archived by them) shows as
  "this project".
- **Embedded differences.** No page padding and no page header: no title,
  blurb, paste hint, Reports or Open pipeline (the project page frames it).
  The toolbar's New deal and paste capture stay. The links into the CRM that
  remain (All reminders, All tasks, and the empty-state actions such as Set up
  the pipeline, Open the pipeline, Create a task, Add your first person) first
  set the /crm project switcher to this project, so they land on this
  project's pages. The empty state says "Create one in <Project>." without
  pointing at a project bar the tab doesn't have.
- **Paste capture** works as on /crm/dashboard (pastes into inputs and while
  a dialog is open are ignored); a deal made here is filed under the project.
- **Gates** (before the dashboard mounts): the project's workspace must be the
  active one (else "This project is in another workspace"); the CRM app must
  be installed (else an install hint); the viewer must be a CRM member (else
  an explanation); load errors show Retry.
- **No link step.** The company-era picker and `project_views.config
  .company_id` are gone; a leftover `company_id` in a view's config is ignored.

## Resolver rules (tasks, notes, reminders, activities)

`useCrmScopeResolver()` returns `{ ready, error, targetInScope, targetsInScope }`.

- A `deal`, `person` or `company` target resolves to that record's
  `project_id`. Soft-deleted records still resolve, so a task on a deleted deal
  stays in its project. An unknown target (gone, or not loaded) is in no view.
- `targetsInScope(targets)` is true when **any** target matches. A record with
  no targets matches only under "No project".
- Under "No project", a target whose record has `project_id` null matches.
- `ready` is false while scoped and a cache has neither answered nor failed;
  treat it as loading. `error` feeds the page's own error state.
- Unscoped (no projects, or the projects list failed): everything matches.

## Known edges

- **Records a viewer cannot reach from /crm.** A record filed under a project
  the viewer cannot see disappears from their /crm views: it is under no
  project and not under "No project" either. "Cannot see" means a private
  project where the viewer is neither the owner, a member nor a team admin, or
  a project this viewer archived. The record still opens by deep link
  (`?m=<id>`) and through the relations picker. A mismatch toast about such a
  record calls its project "another project", because the name is not in the
  viewer's list.
- The switcher's per-project deal counts cover the listed projects only.
- Deleting a project unfiles its records (`on delete set null`). They move to
  "No project", and the bar self-heals to the first live project with the toast
  above.

## Tests

- **Static.** `cd web && npx tsc --noEmit` and `npm run lint` after every
  package, then `npm run build` once. The layout must not introduce
  `useSearchParams`.
- **Store migration.** In DevTools → Application → localStorage, a v2
  `crm-prefs` value (`scopeByTeam` holding company ids) becomes `version: 3` on
  first load, with `scopeByTeam: {}` and `recentByTeam: {}`. `lastCompanyId`
  and `lastCampaignId` stay intact: New deal still defaults to the last company
  used.
- **Switch and persist.** Pick project A → every scoped tab narrows at once.
  Reload → still A. Switch workspace → that workspace's saved project, else its
  first live project A–Z. Switch back → A.
- **Unfiled.** Pick "No project" → the 18 dev deals and 1 company are there.
  Bulk-move three deals to A → they leave the view. Pick A → there they are.
- **Create and move.**
  - Under A, New deal / New person / New company open with Project = A.
  - The deal's company is the last one used, and the person's company is empty.
  - Save a deal with Project = B → "Deal created in B — not shown under A" with
    a working Switch.
  - Change a record's project in the drawer → "moved to" toast.
  - Clear the Project field → the record lands under "No project".
- **Deep links never re-scope.** Under A, open `/crm/deals?m=<a B deal>` → the
  drawer shows the B notice with Switch, the list stays A's, and closing leaves
  A.
- **Bulk safety.** Select rows on Deals, People, Companies, Tasks or Reminders,
  then switch project → the bulk bar disappears.
- **Board integrity.** Under A, create a deal in a stage that also holds hidden
  B cards. In psql its `position` is the max over every live deal in that
  `stage_id`, not just A's. Dragging under a project saves and does not snap
  back.
- **Project tab.**
  - "+ View → CRM" on project A shows exactly A's deals, people, tasks and
    notes, with no switcher and no Switch buttons.
  - New deal there is filed under A.
  - No title, blurb, paste hint, Reports or Open pipeline show above the
    toolbar; pasting a lead still opens the deal dialog.
  - "All tasks" (in the open-tasks panel) lands on /crm/tasks with A
    selected.
  - A non-member of the CRM sees the explanation.
- **Same-team guard.** Read-only check that the trigger exists:
  `select tgname from pg_trigger where tgname like 'app_crm_%_project_same_team';`
  returns 3 rows. An insert with another team's project id raises
  `check_violation`; test that only on a throwaway database.
- **psql counts** (read-only, `psql "$SUPABASE_DB_URL"` from `web/.env.local`;
  confirm dev sivarq… vs prod txrp… first). For team T and project P:
  - deals:
    `select count(*) from app_crm_deals where team_id=T and project_id=P and deleted_at is null;`
  - people and companies: the same query on `app_crm_people` and
    `app_crm_companies`.
  - tasks (soft-deleted targets included on purpose):
    `select count(distinct t.id) from app_crm_tasks t join app_crm_task_targets tt on tt.task_id=t.id where t.team_id=T and ((tt.target_type='deal' and tt.target_id in (select id from app_crm_deals where project_id=P)) or (tt.target_type='person' and tt.target_id in (select id from app_crm_people where project_id=P)) or (tt.target_type='company' and tt.target_id in (select id from app_crm_companies where project_id=P)));`
  - notes: the same query over `app_crm_notes` / `app_crm_note_targets`.
  - "No project": replace `project_id=P` with `project_id is null`, and add the
    tasks and notes with no targets.
