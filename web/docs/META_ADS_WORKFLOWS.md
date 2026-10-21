# Meta Ads in workflows

Daily numbers from Facebook Ads Manager, as a workflow step. Where the rows go
next is up to each workflow (an HTTP step to Google Apps Script, Zapier, Make, …).

## Connecting (Workflows → Integrations)

- A workspace admin presses **Continue with Facebook**
  (`GET /api/integrations/meta/start` → Facebook dialog → `/api/integrations/meta/callback`).
- With `META_LOGIN_CONFIG_ID` set (Facebook Login for Business, token type "System user")
  the token does not expire. Without it the classic login asks for `ads_read`, and the
  short-lived user token is swapped for a ~60-day one; the page shows when to reconnect.
- The callback stores the identity in `app_meta_connections`, the token in
  `app_meta_secrets` (service role only), and the ad accounts the login can see in
  `app_meta_ad_accounts`, each with an **Use in workflows** switch (migration
  `20261151000000_meta_ads_connections.sql`). Admin routes: `POST /accounts`
  (refresh the list), `PATCH /accounts` (switch one), `POST /disconnect`.
- Facebook rule: while the Meta app is in development mode only people with a role on
  the app can connect; anyone else needs App Review (`ads_read` Advanced Access) and
  Business Verification.

## The step: `meta.get_insights` ("Meta Ads: get insights")

Params: `account_ids` (our account ids; empty = every enabled account), `level`
(account | campaign | adset | ad), `date_preset` (yesterday, today, last_3d/7d/14d/30d —
the N days ending yesterday — this_month, last_month), `metrics`.

Output (`{{steps.<key>.…}}`):

| key | |
|---|---|
| `rows` | `[{ date, account_id, account_name, campaign_id?, campaign_name?, adset_id?, adset_name?, ad_id?, ad_name?, objective?, currency, <metric>… }]` — at most 5,000 kept |
| `row_count` | every row fetched |
| `spend` | `{ <currency>: total }` |
| `date_from` / `date_to` | the widest window read |
| `accounts` | `[{ id, name, rows, error? }]` |
| `errors` | one member-safe message per failed account |

- Days are counted in **each ad account's own timezone** (a scheduled run carries no
  date, so the step works out "yesterday" itself). Facebook revises recent days, so a
  daily re-fetch of "Last 3 days" keeps a destination accurate if it updates by
  date + id rather than appending.
- A later field set to exactly `{{steps.<key>.rows}}` receives the array itself, not
  JSON text (interpolateDeep) — e.g. an HTTP step body `{"rows": "{{steps.meta.rows}}"}`.
- One failing account never fails the others; the step fails only when none could be
  read. A token Facebook rejects marks its connection "Needs reconnecting".
- Client: `src/lib/meta/graph.ts` (Bearer-only token, safe paging, throttle backoff,
  range halving on "reduce the amount of data"); rows: `src/lib/meta/insights.ts`;
  handler: `src/lib/meta/workflow-actions.ts`.

History: this reuses the Graph client of the Marketing app (removed 2026-09-28); its
source is archived in `cubes-db-snapshots/code-archive/meta-ads-2026-09/`.
