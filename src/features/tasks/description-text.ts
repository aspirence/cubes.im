/**
 * Task descriptions are stored as HTML (the rich editor's output), with older
 * rows still holding plain text. Anywhere a description is shown as a one-line
 * preview — board cards, exports, digests — it has to be flattened first, or
 * the markup shows up verbatim.
 *
 * Same "does it contain a tag" test the editor uses to decide whether a stored
 * value is HTML or legacy plain text, so both agree on the same rows.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
  "#x2F": "/",
  "#47": "/",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    const key = name.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (ENTITIES[name] !== undefined) return ENTITIES[name];
    // Numeric escapes the table doesn't name (&#8212; and friends).
    const numeric = /^#x([0-9a-f]+)$/i.exec(name)
      ? parseInt(name.slice(2), 16)
      : /^#(\d+)$/.test(name)
        ? Number(name.slice(1))
        : NaN;
    return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : whole;
  });
}

/**
 * Flattens a stored description to readable single-line text.
 *
 * Block-level tags become spaces so "a</p><p>b" doesn't run together as "ab",
 * and script/style contents are dropped rather than surfaced as text.
 */
export function descriptionToText(value: string | null | undefined): string {
  if (!value) return "";
  // Legacy rows hold plain text — nothing to strip, just tidy the whitespace.
  if (!value.includes("<")) return value.replace(/\s+/g, " ").trim();

  return decodeEntities(
    value
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|pre)>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Flattened description, cut to `max` characters with an ellipsis. */
export function descriptionSnippet(
  value: string | null | undefined,
  max = 140,
): string {
  const text = descriptionToText(value);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
