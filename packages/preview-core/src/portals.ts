/**
 * Popups the page opens (a menu, a dialog, a tooltip) are put by their libraries on the
 * document's body: in an iframe that was the page's own, in the editor's page it is the editor's,
 * outside the frame and its stylesheets. What the preview's own code appends to the body is
 * moved into the frame it was drawn for, and taken out of there again when its library removes
 * it from the body.
 *
 * Who appends is told by the stack (`provenance.ts`, `windowCall`). Which frame is the one that
 * last drew or took input.
 */

import type { Provenance } from "./provenance.ts";

const moved = new WeakSet<Node>();
let installed = false;
let target: (() => Element | null) | null = null;

type Inserting = (this: Node, ...args: never[]) => unknown;

/**
 * Sends what the preview's modules append to the body into `frame()`'s portal layer, from now
 * on; `provenance` says whose code appends.
 */
export const routePortals = (
  provenance: Provenance,
  frame: () => Element | null
) => {
  target = frame;
  if (installed || typeof document === "undefined") {
    return;
  }
  installed = true;
  const { body } = document;
  const redirect = (node: Node): Element | null => {
    if (!(node instanceof Element && provenance.windowCall())) {
      return null;
    }
    const into = target?.() ?? null;
    if (into) {
      moved.add(node);
    }
    return into;
  };
  const appendChild = body.appendChild.bind(body);
  const insertBefore = body.insertBefore.bind(body);
  const append = body.append.bind(body);
  const prepend = body.prepend.bind(body);
  const removeChild = body.removeChild.bind(body);
  Object.assign(body, {
    append(...nodes: (Node | string)[]) {
      const element = nodes.length === 1 ? nodes[0] : undefined;
      const into = element instanceof Node ? redirect(element) : null;
      if (into) {
        into.append(element as Node);
        return;
      }
      append(...nodes);
    },
    appendChild<T extends Node>(node: T): T {
      const into = redirect(node);
      return into ? into.appendChild(node) : appendChild(node);
    },
    insertBefore<T extends Node>(node: T, child: Node | null): T {
      const into = redirect(node);
      return into ? into.appendChild(node) : insertBefore(node, child);
    },
    prepend(...nodes: (Node | string)[]) {
      const element = nodes.length === 1 ? nodes[0] : undefined;
      const into = element instanceof Node ? redirect(element) : null;
      if (into) {
        into.append(element as Node);
        return;
      }
      prepend(...nodes);
    },
    removeChild<T extends Node>(node: T): T {
      if (moved.has(node) && node.parentNode !== body) {
        moved.delete(node);
        node.parentNode?.removeChild(node);
        return node;
      }
      return removeChild(node);
    },
  } satisfies Record<string, Inserting | ((...args: never[]) => unknown)>);
};
