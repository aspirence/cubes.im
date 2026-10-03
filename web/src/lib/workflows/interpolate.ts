/**
 * The TypeScript twin of wf_resolve_path / wf_interpolate
 * (supabase/migrations/20261012000000_workflows_engine.sql). SQL steps have
 * always had their config interpolated against the run context; app and http
 * steps are executed in Node, so the same substitution has to exist here or
 * `{{steps.previous.email}}` in a step's params would be sent literally.
 *
 * It must stay in lock-step with the SQL, including the odd corners:
 *  - a path is [a-zA-Z0-9_.]+, split on dots, and a numeric segment indexes an
 *    array (`#>` treats "0" as an array subscript — accidental in SQL, relied
 *    on by the field picker);
 *  - a resolved string is inserted unquoted, anything else as compact JSON;
 *  - a path that does not exist becomes the empty string, while a path that
 *    exists and holds JSON null becomes the text "null" (jsonb_typeof of an
 *    existing null is 'null', not SQL NULL).
 *
 * Pure: no imports, safe on both sides of the wire.
 */

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** `context #> string_to_array(path, '.')`, undefined when any segment is missing. */
export function resolvePath(context: unknown, path: string): unknown {
  let node: unknown = context;
  for (const segment of path.split(".")) {
    if (node === null || node === undefined) return undefined;
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(segment)) return undefined;
      node = node[Number(segment)];
    } else if (typeof node === "object") {
      if (!Object.prototype.hasOwnProperty.call(node, segment)) return undefined;
      node = (node as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return node;
}

/**
 * `jsonb::text`, as Postgres writes it — which is NOT what JSON.stringify
 * writes. Postgres puts a space after every `:` and `,`, and it stores an
 * object's keys sorted by length and then bytewise rather than in insertion
 * order. A composite value interpolated into a template therefore has to be
 * rendered this way, or the same step produces different text depending on
 * which half of the engine ran it.
 */
function pgJsonbText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(pgJsonbText).join(", ")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort((a, b) =>
      a.length !== b.length ? a.length - b.length : (a < b ? -1 : a > b ? 1 : 0),
    );
    const parts = keys.map(
      (key) => `${JSON.stringify(key)}: ${pgJsonbText((value as Record<string, unknown>)[key])}`,
    );
    return `{${parts.join(", ")}}`;
  }
  return "";
}

/** How one resolved value is rendered into a template — see the SQL above. */
function render(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return pgJsonbText(value);
  } catch {
    return "";
  }
}

/** Replaces every {{ dotted.path }} in `template` with its value from `context`. */
export function interpolate(template: string, context: unknown): string {
  if (!template || !template.includes("{{")) return template;
  return template.replace(TOKEN, (_match, path: string) => render(resolvePath(context, path)));
}

/**
 * Interpolates every string leaf of a config value, leaving its shape alone —
 * so a step's `headers` object and a JSON `body` can both carry tokens.
 *
 * One deliberate exception to "strings in, strings out": a string that is
 * nothing but a single token whose value is an object or an array resolves to
 * that value, not to its JSON text. Without it `body: "{{trigger}}"` would send
 * a JSON string containing JSON, which is never what someone means.
 */
export function interpolateDeep<T>(value: T, context: unknown): T {
  if (typeof value === "string") {
    const whole = /^\s*\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\s*$/.exec(value);
    if (whole) {
      const resolved = resolvePath(context, whole[1]);
      if (resolved !== undefined && resolved !== null && typeof resolved === "object") {
        return resolved as unknown as T;
      }
    }
    return interpolate(value, context) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateDeep(item, context)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateDeep(v, context);
    }
    return out as unknown as T;
  }
  return value;
}
