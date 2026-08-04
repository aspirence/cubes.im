import { Node, mergeAttributes } from "@tiptap/core";

/**
 * The two block types Notion has that StarterKit doesn't: the callout and the
 * toggle.
 *
 * Both are defined here rather than pulled from a package because both are a
 * dozen lines of schema over nodes ProseMirror already understands, and neither
 * needs a React node view — a callout is a styled container and a toggle is a
 * `<details>`, which the browser has opened and closed on its own since before
 * any of this existed.
 *
 * Serialising the toggle as real `<details>/<summary>` matters beyond the
 * editor: the stored HTML stays meaningful anywhere it is read back, and
 * `richTextToPlain` picks up the summary text without knowing what a toggle is.
 */

export type CalloutTone = "info" | "warn" | "success" | "danger";

export const CALLOUT_TONES: { value: CalloutTone; icon: string; label: string }[] = [
  { value: "info", icon: "lightbulb", label: "Note" },
  { value: "warn", icon: "warning", label: "Warning" },
  { value: "success", icon: "check_circle", label: "Success" },
  { value: "danger", icon: "error", label: "Danger" },
];

/**
 * A tinted block that holds paragraphs — "read this bit".
 *
 * `content: "block+"` rather than "paragraph+" so a callout can hold a list,
 * which is what half of them end up holding.
 */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: "info" as CalloutTone,
        parseHTML: (element) => element.getAttribute("data-tone") ?? "info",
        renderHTML: (attributes) => ({ "data-tone": attributes.tone as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "callout" }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (tone: CalloutTone = "info") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { tone }),
      toggleCallout:
        (tone: CalloutTone = "info") =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { tone }),
    };
  },

  addKeyboardShortcuts() {
    return {
      // A callout is a dead end otherwise: Enter keeps making paragraphs inside
      // it and there is no way back out to the document with the keyboard.
      "Mod-Enter": () => this.editor.commands.exitCode(),
    };
  },
});

/** The clickable line of a toggle. */
export const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  group: "",
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: "summary" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["summary", mergeAttributes(HTMLAttributes), 0];
  },
});

/**
 * A collapsible section: one summary line, then any blocks under it.
 *
 * `open` is stored so a doc reopens the way its author left it, rather than
 * springing every toggle open on load.
 */
export const ToggleBlock = Node.create({
  name: "toggleBlock",
  group: "block",
  content: "toggleSummary block+",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.hasAttribute("open"),
        renderHTML: (attributes) => (attributes.open ? { open: "" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "details" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["details", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setToggleBlock:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { open: true },
              content: [
                { type: "toggleSummary", content: [{ type: "text", text: "Toggle" }] },
                { type: "paragraph" },
              ],
            })
            .run(),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (tone?: CalloutTone) => ReturnType;
      toggleCallout: (tone?: CalloutTone) => ReturnType;
    };
    toggleBlock: {
      setToggleBlock: () => ReturnType;
    };
  }
}
