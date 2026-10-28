/**
 * What the page's code inserts into one of the editor's own elements, put somewhere else: the
 * popups it appends to the body go into its frame (`portals.ts`), the styles it writes in the
 * head are held for the frames and its document's title and meta kept aside (`sandbox.ts`). Both
 * patch the same methods of their element the same way; only where a node goes differs.
 */

/** Where in its parent a node was asked to go: before a child (null: last), or first. */
export type Place = Node | null | "first";

type Nodes = (Node | string)[];

/** The node inserted alone; several at once, or text, go in as asked. */
const single = (nodes: Nodes): Node | null => {
  const [node] = nodes;
  return nodes.length === 1 && node instanceof Node ? node : null;
};

/**
 * Patches `parent`'s `append`, `appendChild`, `insertBefore`, `prepend` and `removeChild`, on the
 * element itself (no other element pays for it): a node inserted alone is offered to
 * `elsewhere`, which puts it somewhere else and returns true, or returns false to have it go in
 * as asked. A node put elsewhere that its owner removes from `parent` (a library takes back what
 * it put there) is taken from where it is instead.
 */
export const redirectInsertions = (
  parent: HTMLElement,
  elsewhere: (node: Node, place: Place) => boolean
) => {
  const moved = new WeakSet<Node>();
  const away = (node: Node, place: Place) => {
    if (!elsewhere(node, place)) {
      return false;
    }
    moved.add(node);
    return true;
  };
  const append = parent.append.bind(parent);
  const appendChild = parent.appendChild.bind(parent);
  const insertBefore = parent.insertBefore.bind(parent);
  const prepend = parent.prepend.bind(parent);
  const removeChild = parent.removeChild.bind(parent);
  Object.assign(parent, {
    append(...nodes: Nodes) {
      const node = single(nodes);
      if (!(node && away(node, null))) {
        append(...nodes);
      }
    },
    appendChild<T extends Node>(node: T): T {
      return away(node, null) ? node : appendChild(node);
    },
    insertBefore<T extends Node>(node: T, child: Node | null): T {
      return away(node, child) ? node : insertBefore(node, child);
    },
    prepend(...nodes: Nodes) {
      const node = single(nodes);
      if (!(node && away(node, "first"))) {
        prepend(...nodes);
      }
    },
    removeChild<T extends Node>(node: T): T {
      if (moved.has(node) && node.parentNode !== parent) {
        moved.delete(node);
        node.parentNode?.removeChild(node);
        return node;
      }
      return removeChild(node);
    },
  });
};
