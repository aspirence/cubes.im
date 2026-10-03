/**
 * The field picker's data model — the thing that turns "sample data" into a
 * clickable tree of `{{steps.s1.contact.email}}` tokens with the example value
 * next to each one.
 *
 * Everything here is pure so the tree the builder draws is exactly the tree the
 * unit tests check. The React side lives in field-picker.tsx.
 *
 * Token shape matches the SQL interpolator (`wf_interpolate` /
 * `wf_resolve_path`): `{{ a.b.0.c }}` is a plain dotted walk of the run context,
 * and the path characters are limited to `[A-Za-z0-9_.]`. A sample key that
 * falls outside that set (a header like "content-type", a column named "Total
 * £") cannot be addressed at all, so the picker shows it but refuses to insert
 * it rather than handing the user a token that silently resolves to "".
 */

/**
 * Where the trigger's own payload is expected to live in the run context.
 * The engine is being built in parallel; if it lands the payload somewhere else
 * this constant is the single place to realign the builder.
 */
export const TRIGGER_TOKEN_ROOT = "trigger";

export type SampleKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface FieldNode {
  /** Full dotted path, i.e. the token body: "steps.s1.rows.0.email". */
  path: string;
  /** Last segment — what the tree row is labelled with. */
  name: string;
  kind: SampleKind;
  /** The example value, shortened for a one-line row. */
  preview: string;
  /** False when some segment of the path cannot be expressed as a token. */
  insertable: boolean;
  children: FieldNode[];
}

export interface FieldSource {
  /** "trigger", or the step_key of an earlier step. */
  key: string;
  label: string;
  /** Token root this source's paths hang off: "trigger" or "steps.s1". */
  root: string;
  sample: unknown;
  /** Shown instead of an empty branch: why there is nothing to map yet. */
  emptyHint?: string;
}

export interface FieldGroup extends FieldSource {
  nodes: FieldNode[];
}

export interface FieldTreeLimits {
  /** How deep to walk nested objects. */
  maxDepth?: number;
  /** How many keys of one object to show. */
  maxKeys?: number;
  /** How many items of a list to expand (the rest are reachable by index anyway). */
  maxArrayItems?: number;
}

const SEGMENT_OK = /^[A-Za-z0-9_]+$/;

export function kindOf(value: unknown): SampleKind {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "object":
      return "object";
    case "number":
      return Number.isFinite(value) ? "number" : "null";
    case "boolean":
      return "boolean";
    default:
      return "string";
  }
}

/**
 * A one-line example of a value. Containers say how big they are rather than
 * dumping their contents, because the tree already shows what is inside.
 */
export function previewValue(value: unknown): string {
  if (value === null || value === undefined) return "empty";
  if (Array.isArray(value)) {
    return value.length === 0 ? "empty list" : `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (typeof value === "object") {
    const n = Object.keys(value as Record<string, unknown>).length;
    return n === 0 ? "no fields" : `${n} field${n === 1 ? "" : "s"}`;
  }
  if (typeof value === "string") {
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (trimmed === "") return "empty text";
    return trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return "empty";
  return String(value);
}

/** The token text for a path, i.e. what gets typed into the field. */
export function tokenFor(path: string): string {
  return `{{${path}}}`;
}

/**
 * Walks a sample payload into tree nodes. Depth/width are capped so a fat
 * webhook body (a lead-gen webhook post can be hundreds of keys) cannot freeze the
 * drawer; the caps are part of the contract with the tests.
 */
export function buildFieldNodes(
  sample: unknown,
  root: string,
  limits: FieldTreeLimits = {},
): FieldNode[] {
  const maxDepth = limits.maxDepth ?? 6;
  const maxKeys = limits.maxKeys ?? 60;
  const maxArrayItems = limits.maxArrayItems ?? 3;
  const rootInsertable = root.split(".").every((s) => SEGMENT_OK.test(s));

  const makeNode = (
    name: string,
    path: string,
    value: unknown,
    depth: number,
    parentInsertable: boolean,
  ): FieldNode => {
    const insertable = parentInsertable && SEGMENT_OK.test(name);
    return {
      path,
      name,
      kind: kindOf(value),
      preview: previewValue(value),
      insertable,
      children: walk(value, path, depth + 1, insertable),
    };
  };

  const walk = (
    value: unknown,
    path: string,
    depth: number,
    parentInsertable: boolean,
  ): FieldNode[] => {
    if (depth >= maxDepth) return [];
    if (Array.isArray(value)) {
      return value
        .slice(0, maxArrayItems)
        .map((item, i) => makeNode(String(i), `${path}.${i}`, item, depth, parentInsertable));
    }
    if (value && typeof value === "object") {
      return Object.entries(value as Record<string, unknown>)
        .slice(0, maxKeys)
        .map(([k, v]) => makeNode(k, `${path}.${k}`, v, depth, parentInsertable));
    }
    return [];
  };

  return walk(sample, root, 0, rootInsertable);
}

/** One group per source (the trigger, then each earlier step), in order. */
export function buildFieldTree(
  sources: FieldSource[],
  limits: FieldTreeLimits = {},
): FieldGroup[] {
  return sources.map((s) => ({ ...s, nodes: buildFieldNodes(s.sample, s.root, limits) }));
}

/** Depth-first lookup by path — used to label a stored token. */
export function findFieldNode(groups: FieldGroup[], path: string): FieldNode | undefined {
  const hunt = (nodes: FieldNode[]): FieldNode | undefined => {
    for (const n of nodes) {
      if (n.path === path) return n;
      if (path.startsWith(`${n.path}.`)) {
        const hit = hunt(n.children);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return hunt(groups.flatMap((g) => g.nodes));
}

/** Every node whose name or path matches a search box, flattened. */
export function searchFieldNodes(groups: FieldGroup[], query: string): FieldNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: FieldNode[] = [];
  const walk = (nodes: FieldNode[]) => {
    for (const n of nodes) {
      if (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)) out.push(n);
      walk(n.children);
    }
  };
  walk(groups.flatMap((g) => g.nodes));
  return out;
}

export interface TokenInsertion {
  value: string;
  /** Where the caret should sit afterwards (just past the inserted token). */
  cursor: number;
}

/**
 * Inserts a token at the caret, replacing any selection. Out-of-range or
 * reversed selections are clamped rather than throwing, because the caret
 * offsets come from a DOM element that may have been re-rendered since.
 */
export function insertToken(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  path: string,
): TokenInsertion {
  const token = tokenFor(path);
  const len = value.length;
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), len) : len);
  const a = clamp(selectionStart);
  const b = clamp(selectionEnd);
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  return { value: value.slice(0, start) + token + value.slice(end), cursor: start + token.length };
}

/** Every `{{path}}` in a template, in order, de-duplicated. */
export function tokensIn(template: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/**
 * A friendly label for a field whose whole value is one token
 * ("Step 1 · email"); anything else (literal text, or text with tokens mixed
 * in) is returned unchanged, because there is no single field to name.
 */
export function describeToken(groups: FieldGroup[], value: string): string {
  const m = /^\s*\{\{\s*([A-Za-z0-9_.]+)\s*\}\}\s*$/.exec(value);
  if (!m) return value;
  const group = groups.find((g) => m[1] === g.root || m[1].startsWith(`${g.root}.`));
  const node = findFieldNode(groups, m[1]);
  if (!node) return value;
  return group ? `${group.label} · ${node.name}` : node.name;
}

/** Tokens in a template that no sample can explain — the builder warns on these. */
export function unknownTokens(groups: FieldGroup[], template: string): string[] {
  return tokensIn(template).filter((p) => !findFieldNode(groups, p));
}
