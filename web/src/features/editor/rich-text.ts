/**
 * Reading back what NotionEditor wrote.
 *
 * Every surface that shows stored rich text today shows a PREVIEW — four
 * clamped lines of a call recap, three expandable rows in a drawer, one line on
 * a campaign card. Those want the words, and mounting a ProseMirror view per
 * row to render them would cost far more than it returns.
 *
 * So there is no HTML renderer here yet, and deliberately no
 * `dangerouslySetInnerHTML`: stored rich text is a database string that
 * anything with an API key can write, and this project has no sanitizer. When a
 * surface genuinely reads a whole note, render it through TipTap's own schema
 * (which drops anything it doesn't define) rather than trusting the string.
 */

/**
 * Rich text as a single line of plain text.
 *
 * Search is the reason this has to exist: matching a query against raw HTML
 * makes "p" and "li" hit every note in the workspace.
 */
export function richTextToPlain(html: string | null | undefined): string {
  if (!html) return "";
  if (!html.includes("<")) return html;

  if (typeof window !== "undefined" && "DOMParser" in window) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Block boundaries are word boundaries — without the separator
    // "one</p><p>two" collapses to "onetwo" and stops matching either word.
    // `summary` is in the list because a toggle's title and its first
    // paragraph are different sentences — without it they run together into a
    // word that matches neither.
    for (const el of doc.body.querySelectorAll(
      "p,div,li,h1,h2,h3,br,tr,summary,blockquote,pre",
    )) {
      el.insertAdjacentText("beforeend", " ");
    }
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
