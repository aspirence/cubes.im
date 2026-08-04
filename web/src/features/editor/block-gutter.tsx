"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "antd";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";

/**
 * Notion's block gutter: hover a block, get a `+` to insert under it and a grip
 * to drag it somewhere else.
 *
 * Written against ProseMirror directly rather than pulling in
 * `@tiptap/extension-drag-handle`. That package needs
 * `@tiptap/extension-collaboration` for one helper, which drags Yjs — an entire
 * CRDT library — into the bundle of every page that renders a task drawer. A
 * drag handle is not worth that, and the primitives it needs are three calls:
 * `posAtCoords` to find the block, `NodeSelection` to select it, and the
 * browser's own drag to move it (ProseMirror already handles the drop).
 */
export function BlockGutter({
  editor,
  containerRef,
}: {
  editor: Editor;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [box, setBox] = useState<{ top: number; left: number; pos: number } | null>(
    null,
  );
  const gutterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMove = (event: MouseEvent) => {
      // Staying put while the pointer is over the gutter itself, or the buttons
      // vanish the moment you reach for them.
      if (
        gutterRef.current &&
        event.target instanceof Node &&
        gutterRef.current.contains(event.target)
      ) {
        return;
      }

      const dom = editor.view.dom as HTMLElement;
      const rect = dom.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left - 48 &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) {
        setBox(null);
        return;
      }

      // Probe a little inside the left edge: pointing at the gutter itself is
      // outside every node, and posAtCoords would return nothing.
      const found = editor.view.posAtCoords({
        left: rect.left + 24,
        top: event.clientY,
      });
      if (!found) {
        setBox(null);
        return;
      }

      // Walk up to the top-level block — the thing a person means by "this
      // block", not the text node the pointer happens to be over.
      const $pos = editor.state.doc.resolve(found.pos);
      const depth = Math.min(1, $pos.depth);
      const blockPos = depth === 0 ? found.pos : $pos.before(depth);
      let node: HTMLElement | null = null;
      try {
        const domAt = editor.view.nodeDOM(blockPos);
        node = domAt instanceof HTMLElement ? domAt : null;
      } catch {
        node = null;
      }
      if (!node) {
        setBox(null);
        return;
      }

      const nodeRect = node.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setBox({
        top: nodeRect.top - containerRect.top,
        left: nodeRect.left - containerRect.left,
        pos: blockPos,
      });
    };

    const onLeave = () => setBox(null);

    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    return () => {
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, containerRef]);

  if (!box) return null;

  /** Selecting the node is what makes the browser drag move the whole block. */
  const selectBlock = () => {
    try {
      const sel = NodeSelection.create(editor.state.doc, box.pos);
      editor.view.dispatch(editor.state.tr.setSelection(sel));
    } catch {
      // Not a selectable node (a text block inside a list item, say) — the
      // grip just does nothing rather than throwing into the console.
    }
  };

  return (
    <div
      ref={gutterRef}
      className="rd-gutter"
      style={{ top: box.top, left: box.left - 46 }}
      contentEditable={false}
      // The gutter sits over the editor; without this a click here would move
      // the caret before the button's own handler runs.
      onMouseDown={(e) => e.preventDefault()}
    >
      <Tooltip title="Insert below">
        <button
          type="button"
          aria-label="Insert a block below"
          className="rd-grip"
          onClick={() => {
            const node = editor.state.doc.nodeAt(box.pos);
            const after = box.pos + (node?.nodeSize ?? 1);
            editor
              .chain()
              .focus()
              // A bare paragraph with "/" in it: the block menu is how anything
              // gets inserted, so open it rather than making the user type the
              // character themselves.
              .insertContentAt(after, { type: "paragraph" })
              .setTextSelection(after + 1)
              .insertContent("/")
              .run();
          }}
        >
          <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 15 }}>
            add
          </span>
        </button>
      </Tooltip>
      <Tooltip title="Drag to move">
        <button
          type="button"
          aria-label="Drag to move this block"
          className="rd-grip rd-grip-drag"
          draggable
          onDragStart={selectBlock}
          onClick={selectBlock}
        >
          <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 15 }}>
            drag_indicator
          </span>
        </button>
      </Tooltip>
    </div>
  );
}
