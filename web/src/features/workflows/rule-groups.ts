/**
 * Filter and router configuration — the shapes stored in `workflow_steps.config`
 * and the checks the builder runs before letting a step be saved.
 *
 * Pure, and deliberately tolerant of what is already in the database: the
 * original condition step stored a single `{left, op, right}` comparison that
 * halted the run, so `normalizeConditionConfig` reads that as a one-rule "stop"
 * group. A config that round-trips through normalize → compact must still run
 * on the old engine, which is why the single-rule stop shape keeps its
 * top-level `left/op/right` keys.
 *
 * Contract: docs/AUTOMATION_CLIENT.md §2.1 (filters) and §2.4 (router).
 */

export type FilterOp =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "is_empty"
  | "is_not_empty";

export interface FilterOpDescriptor {
  value: FilterOp;
  label: string;
  /** True when the operator takes no right-hand value. */
  unary?: boolean;
}

export const FILTER_OPS: FilterOpDescriptor[] = [
  { value: "=", label: "is equal to" },
  { value: "!=", label: "is not equal to" },
  { value: ">", label: "is greater than" },
  { value: ">=", label: "is at least" },
  { value: "<", label: "is less than" },
  { value: "<=", label: "is at most" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "is_empty", label: "is empty", unary: true },
  { value: "is_not_empty", label: "is not empty", unary: true },
];

export const filterOp = (op: string): FilterOpDescriptor | undefined =>
  FILTER_OPS.find((o) => o.value === op);

export const isUnaryOp = (op: string): boolean => Boolean(filterOp(op)?.unary);

export type MatchMode = "all" | "any";

export interface Rule {
  left: string;
  op: FilterOp;
  right?: string;
}

/** `filter` skips just this step; `stop` ends the run (the old behaviour). */
export type ConditionMode = "filter" | "stop";

export interface ConditionConfig {
  mode: ConditionMode;
  match: MatchMode;
  rules: Rule[];
}

const asString = (v: unknown): string =>
  v === undefined || v === null ? "" : typeof v === "string" ? v : String(v);

function normalizeRule(raw: unknown): Rule {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const op = filterOp(asString(r.op)) ? (asString(r.op) as FilterOp) : "=";
  return { left: asString(r.left), op, right: isUnaryOp(op) ? undefined : asString(r.right) };
}

/**
 * Reads whatever is stored into a complete rule group. An old single-rule
 * config (`{left, op, right}` with no `rules`) becomes one rule in `stop` mode,
 * which is exactly what the old engine did with it.
 */
export function normalizeConditionConfig(raw: unknown): ConditionConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode: ConditionMode = c.mode === "filter" ? "filter" : "stop";
  const match: MatchMode = c.match === "any" ? "any" : "all";
  if (Array.isArray(c.rules)) {
    const rules = c.rules.map(normalizeRule);
    return { mode, match, rules: rules.length ? rules : [{ left: "", op: "=", right: "" }] };
  }
  // Legacy shape, or a brand-new step with nothing in it yet.
  return { mode, match, rules: [normalizeRule(c)] };
}

/**
 * What gets written back. A single-rule `stop` group also keeps the legacy
 * top-level keys so a workflow stays runnable on an engine that has not been
 * migrated yet — the new engine reads `rules` and ignores them.
 */
export function compactConditionConfig(c: ConditionConfig): Record<string, unknown> {
  const rules = c.rules.map((r) =>
    isUnaryOp(r.op) ? { left: r.left, op: r.op } : { left: r.left, op: r.op, right: r.right ?? "" },
  );
  const out: Record<string, unknown> = { mode: c.mode, match: c.match, rules };
  if (c.mode === "stop" && rules.length === 1) Object.assign(out, rules[0]);
  return out;
}

/** The first problem with a rule group, in the words shown under the editor. */
export function validateRuleGroup(group: { match: MatchMode; rules: Rule[] }): string | null {
  if (!group.rules.length) return "Add at least one rule.";
  for (let i = 0; i < group.rules.length; i++) {
    const r = group.rules[i];
    const where = group.rules.length === 1 ? "The rule" : `Rule ${i + 1}`;
    if (!r.left.trim()) return `${where} needs a value to check — pick one from an earlier step.`;
    if (!filterOp(r.op)) return `${where} has an unknown comparison.`;
    if (!isUnaryOp(r.op) && !(r.right ?? "").trim())
      return `${where} needs something to compare against.`;
  }
  return null;
}

/** "Email contains @gmail.com" — the sentence shown on the canvas card. */
export function describeRule(r: Rule, label?: (token: string) => string): string {
  const left = (label ? label(r.left) : r.left) || "…";
  const op = filterOp(r.op)?.label ?? r.op;
  if (isUnaryOp(r.op)) return `${left} ${op}`;
  return `${left} ${op} ${r.right?.trim() ? r.right : "…"}`;
}

export function describeRuleGroup(
  group: { match: MatchMode; rules: Rule[] },
  label?: (token: string) => string,
): string {
  if (!group.rules.length) return "No rules yet";
  const joiner = group.match === "any" ? " or " : " and ";
  return group.rules.map((r) => describeRule(r, label)).join(joiner);
}

/* ----------------------------------------------------------------- router -- */

/** One level, five routes — Zapier's own default, and where nesting stops paying. */
export const MAX_ROUTES = 5;
/** The route taken when nothing else matched; `advance_workflow_run` looks for this key. */
export const FALLBACK_ROUTE_KEY = "fallback";

export interface Route {
  /** Stored on child steps as `branch_key`; must be a plain identifier. */
  key: string;
  label: string;
  match: MatchMode;
  rules: Rule[];
}

export interface RouterConfig {
  routes: Route[];
}

export const isFallbackRoute = (r: { key: string }): boolean => r.key === FALLBACK_ROUTE_KEY;

/** A safe, unique branch key derived from what the user typed. */
export function routeKeyFor(label: string, taken: string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || "route";
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.includes(`${base}_${i}`)) return `${base}_${i}`;
  return `${base}_${Date.now()}`;
}

export function normalizeRouterConfig(raw: unknown): RouterConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(c.routes) ? c.routes : [];
  const taken: string[] = [];
  const routes: Route[] = list.slice(0, MAX_ROUTES).map((item, i) => {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const label = asString(r.label) || `Route ${i + 1}`;
    const key = /^[a-z0-9_]+$/.test(asString(r.key)) ? asString(r.key) : routeKeyFor(label, taken);
    taken.push(key);
    return {
      key,
      label,
      match: r.match === "any" ? "any" : "all",
      rules: Array.isArray(r.rules) ? r.rules.map(normalizeRule) : [],
    };
  });
  if (!routes.length) {
    return {
      routes: [
        { key: "route_1", label: "Route 1", match: "all", rules: [{ left: "", op: "=", right: "" }] },
      ],
    };
  }
  return { routes };
}

/**
 * Router rules. The fallback route is the one route allowed to have no rules —
 * it is what "everything else" means — and it has to be last, because
 * `advance_workflow_run` takes the first route that matches.
 */
export function validateRouterConfig(c: RouterConfig): string | null {
  if (!c.routes.length) return "A router needs at least one route.";
  if (c.routes.length > MAX_ROUTES) return `A router can have at most ${MAX_ROUTES} routes.`;
  const keys = new Set<string>();
  for (const r of c.routes) {
    if (!r.label.trim()) return "Every route needs a name.";
    if (!/^[a-z0-9_]+$/.test(r.key)) return `Route "${r.label}" has an invalid key.`;
    if (keys.has(r.key)) return `Two routes share the key "${r.key}" — rename one.`;
    keys.add(r.key);
  }
  const fallbackAt = c.routes.findIndex(isFallbackRoute);
  if (fallbackAt >= 0 && fallbackAt !== c.routes.length - 1)
    return "The fallback route has to be last — routes are tried in order.";
  for (const r of c.routes) {
    if (isFallbackRoute(r)) continue;
    const problem = validateRuleGroup(r);
    if (problem) return `${r.label}: ${problem}`;
  }
  return null;
}

/** Whether another route can be added (the fallback counts against the cap). */
export const canAddRoute = (c: RouterConfig): boolean => c.routes.length < MAX_ROUTES;
