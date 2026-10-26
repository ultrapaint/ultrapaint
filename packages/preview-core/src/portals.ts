/**
 * Popups the page opens (a menu, a dialog, a tooltip) are put by their libraries on the
 * document's body: in an iframe that was the page's own, in the editor's page it is the editor's,
 * outside the frame and its stylesheets. What the preview's own code appends to the body is
 * moved into the frame it was drawn for, and taken out of there again when its library removes
 * it from the body.
 *
 * Who appends is told by the stack: the preview's modules are served under its base, the
 * editor's are not. Which frame is the one that last drew or took input.
 */

const moved = new WeakSet<Node>();
let installed = false;
let target: (() => Element | null) | null = null;
let base = "";

/** This module's own file, whose frames on the stack are the patch, not who called it. */
const OWN = import.meta.url.split("?")[0] ?? "";

/**
 * Whether the call comes from the preview's own modules: its first caller outside this module.
 * Anything further down the stack does not say: the editor's own React may commit inside a
 * callback of the preview's.
 */
const fromPreview = () => {
  const lines = (new Error("who appends to the body").stack ?? "").split("\n");
  const caller = lines.slice(1).find((line) => !line.includes(OWN)) ?? "";
  return caller.includes(base);
};

type Inserting = (this: Node, ...args: never[]) => unknown;

/**
 * Sends what the preview's modules append to the body into `frame()`'s portal layer, from now
 * on. `previewBase` is the path every module of the preview is served under.
 */
export const routePortals = (
  previewBase: string,
  frame: () => Element | null
) => {
  base = previewBase;
  target = frame;
  if (installed || typeof document === "undefined") {
    return;
  }
  installed = true;
  const { body } = document;
  const redirect = (node: Node): Element | null => {
    if (!(node instanceof Element && fromPreview())) {
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
