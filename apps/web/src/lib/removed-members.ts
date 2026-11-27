/**
 * The instances of a variant member a system component's look takes out (ADR 0161): they keep
 * drawing as they are, and Problems lists them, a member at a time, with the members they can be
 * moved to. Counted on the pages the editor has read and in the app components' trees, as a
 * component's uses are (`component-uses.ts`).
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import {
  type ComponentFile,
  componentDocOf,
  SYSTEM_FROM,
  systemComponentsIn,
} from "@ultrapaint/contracts/components";
import type { DesignNode, DocumentEdit } from "@ultrapaint/contracts/document";
import { walk } from "@ultrapaint/design-document/tree";
import {
  axesOf,
  systemComponentOf,
} from "@ultrapaint/system-components/catalogue";

/** A document the editor has read: a page, or an app component's tree. */
export interface ReadDocument {
  readonly doc: string;
  readonly name: string;
  readonly root: DesignNode | null;
}

/** The instances of one member a look takes out, and where they can go. */
export interface RemovedMember {
  readonly axis: string;
  readonly component: string;
  /** The instances that keep it, by the document they are in. */
  readonly instances: readonly { readonly doc: string; readonly id: string }[];
  readonly member: string;
  /** The documents they are in, by name, in the order first met. */
  readonly places: readonly string[];
  /** The members they can be moved to: those the look offers. */
  readonly to: readonly string[];
}

/** The pages the editor has read, then each app component's tree as a document of its own. */
export const documentsOf = (
  components: readonly ComponentFile[],
  pages: readonly ReadDocument[]
): ReadDocument[] => [
  ...pages,
  ...components.flatMap((c) =>
    c.origin === "app"
      ? [{ doc: componentDocOf(c.name), name: c.name, root: c.tree }]
      : []
  ),
];

/** Every member a project's looks take out that an instance still has, a member each. */
export const removedMembersOf = (
  components: readonly ComponentFile[],
  pages: readonly ReadDocument[]
): RemovedMember[] => {
  const documents = documentsOf(components, pages);
  return systemComponentsIn(components).flatMap((file) => {
    const meta = systemComponentOf(file.name);
    if (!(meta && file.members)) {
      return [];
    }
    return Object.entries(axesOf(meta, file)).flatMap(([axis, a]) =>
      a.removed.flatMap((member): RemovedMember[] => {
        const found = documents.flatMap((d) =>
          d.root
            ? [...walk(d.root)].flatMap((node) =>
                node.type === "instance" &&
                node.from === SYSTEM_FROM &&
                node.component === file.name &&
                node.props?.[axis] === member
                  ? [{ doc: d.doc, id: node.id, name: d.name }]
                  : []
              )
            : []
        );
        return found.length === 0
          ? []
          : [
              {
                axis,
                component: file.name,
                instances: found.map(({ doc, id }) => ({ doc, id })),
                member,
                places: [...new Set(found.map((f) => f.name))],
                to: a.members,
              },
            ];
      })
    );
  });
};

/** The edits that move a member's instances to another, a document's in one edit. */
export const movedTo = (
  removed: RemovedMember,
  member: string
): DocumentEdit[] => {
  const byDoc = new Map<string, string[]>();
  for (const { doc, id } of removed.instances) {
    byDoc.set(doc, [...(byDoc.get(doc) ?? []), id]);
  }
  const props: Record<string, JsonValue> = { [removed.axis]: member };
  return [...byDoc].map(([doc, ids]) => ({
    doc,
    ops: ids.map((id) => ({ id, op: "setProps" as const, props })),
  }));
};
