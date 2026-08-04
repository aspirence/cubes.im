import type { Json } from "@/types/database";
import type { Block } from "./use-docs";

/**
 * A doc page's `content` jsonb, read and written in two shapes.
 *
 * Pages written before the editor moved to TipTap hold a `Block[]` — one row
 * per paragraph, with the block's type as a string. Pages written since hold
 * `{ html }`. Both stay readable forever: converting every old page in a
 * migration would mean rewriting rows nobody has opened, and getting it wrong
 * once would be unrecoverable. Converting on read costs nothing and is
 * reversible until the moment someone edits, which is the moment they'd notice.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Legacy blocks to HTML.
 *
 * Consecutive list blocks are gathered into one `<ul>`/`<ol>`: the old model
 * stored every bullet as its own top-level block, so a naive one-block-one-list
 * conversion would turn a five-item list into five single-item lists that
 * re-number from 1 and can't be reordered as a unit.
 */
export function blocksToHtml(blocks: Block[]): string {
  const out: string[] = [];
  let i = 0;

  const listRun = (
    type: Block["type"],
    tag: "ul" | "ol",
    attrs: string,
    renderItem: (b: Block) => string,
  ) => {
    const items: string[] = [];
    while (i < blocks.length && blocks[i].type === type) {
      items.push(renderItem(blocks[i]));
      i += 1;
    }
    out.push(`<${tag}${attrs}>${items.join("")}</${tag}>`);
  };

  while (i < blocks.length) {
    const b = blocks[i];
    const text = escapeHtml(b.text ?? "");
    switch (b.type) {
      case "h1":
        out.push(`<h1>${text}</h1>`);
        i += 1;
        break;
      case "h2":
        out.push(`<h2>${text}</h2>`);
        i += 1;
        break;
      case "h3":
        out.push(`<h3>${text}</h3>`);
        i += 1;
        break;
      case "bulleted":
        listRun("bulleted", "ul", "", (x) => `<li><p>${escapeHtml(x.text ?? "")}</p></li>`);
        break;
      case "numbered":
        listRun("numbered", "ol", "", (x) => `<li><p>${escapeHtml(x.text ?? "")}</p></li>`);
        break;
      case "todo":
        // TaskList's serialized shape — data-type on the list, data-checked on
        // each item, which is what @tiptap/extension-list parses back.
        listRun(
          "todo",
          "ul",
          ' data-type="taskList"',
          (x) =>
            `<li data-type="taskItem" data-checked="${x.checked ? "true" : "false"}"><p>${escapeHtml(
              x.text ?? "",
            )}</p></li>`,
        );
        break;
      case "quote":
        out.push(`<blockquote><p>${text}</p></blockquote>`);
        i += 1;
        break;
      case "code":
        out.push(`<pre><code>${text}</code></pre>`);
        i += 1;
        break;
      case "divider":
        out.push("<hr>");
        i += 1;
        break;
      default:
        out.push(text ? `<p>${text}</p>` : "<p></p>");
        i += 1;
        break;
    }
  }

  return out.join("");
}

/** Whatever the column holds, as HTML the editor can load. */
export function pageContentToHtml(content: Json): string {
  if (Array.isArray(content)) {
    const blocks: Block[] = [];
    for (const b of content) {
      if (b && typeof b === "object" && !Array.isArray(b) && "type" in b) {
        blocks.push(b as unknown as Block);
      }
    }
    return blocksToHtml(blocks);
  }
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const html = (content as Record<string, unknown>).html;
    if (typeof html === "string") return html;
  }
  return "";
}

/** What gets written back. New pages are always `{ html }`. */
export function htmlToPageContent(html: string): Json {
  return { html } as unknown as Json;
}
