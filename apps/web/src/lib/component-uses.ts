/**
 * Where a component is placed (ADR 0045): the pages given, with how many of their instances are
 * of it, and the app components whose trees place it. Pure: a component's inspector counts the
 * pages of the canvas open, which the editor has read.
 */
import type { ComponentFile } from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { walk } from "@ultrapaint/design-document/tree";
import type { TokenUse } from "./token-ops.ts";

/** A place a component is used in: a page with how many instances, or an app component's tree. */
export type ComponentUse = Omit<TokenUse, "kind"> & {
  readonly kind: "page" | "component";
};

/** How many instances of the component a tree places, those inside its instances' slots too. */
const instancesIn = (
  root: DesignNode | null,
  name: string,
  from: string
): number => {
  if (!root) {
    return 0;
  }
  let count = 0;
  for (const node of walk(root)) {
    if (
      node.type === "instance" &&
      node.component === name &&
      node.from === from
    ) {
      count += 1;
    }
  }
  return count;
};

/**
 * Where the component `name` (imported from `from`) is used: each page that places it, with how
 * many instances, the most first, then each app component whose tree does.
 */
export const componentUsesOf = (
  name: string,
  from: string,
  given: {
    readonly components: readonly ComponentFile[];
    readonly pages: readonly {
      readonly name: string;
      readonly root: DesignNode | null;
    }[];
  }
): ComponentUse[] => [
  ...given.pages
    .flatMap((page): ComponentUse[] => {
      const count = instancesIn(page.root, name, from);
      return count > 0 ? [{ count, kind: "page", name: page.name }] : [];
    })
    .sort((a, b) => b.count - a.count),
  ...given.components.flatMap((c): ComponentUse[] => {
    const count =
      c.origin === "app" && c.name !== name
        ? instancesIn(c.tree, name, from)
        : 0;
    return count > 0 ? [{ count, kind: "component", name: c.name }] : [];
  }),
];
