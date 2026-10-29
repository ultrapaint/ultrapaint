/**
 * The components of the designs directory (ADR 0041): every preview draws the looks of the
 * system components the project owns over them, and the app components in their instances'
 * place. Kept up to date from the server, whoever changes a file; the catalogue (ADR 0042) is
 * made from them here, as the server makes it for the agents.
 */
import { type Catalogue, metaOf } from "@ultrapaint/contracts/catalogue";
import type {
  ComponentEntry,
  ComponentFile,
  ComponentList,
} from "@ultrapaint/contracts/components";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { takesChildren } from "@ultrapaint/design-document/tree";
import { catalogueOf } from "@ultrapaint/system-components/catalogue";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

interface ComponentsStore {
  /** What a design can place: the system components, then the app components that read. */
  catalogue: Catalogue;
  /** The components that read, which is what the previews draw. */
  components: readonly ComponentFile[];
  /** Every component's file, read or with its problem. */
  entries: readonly ComponentEntry[];
  load: () => Promise<void>;
  loaded: boolean;
}

const fromEntries = (entries: readonly ComponentEntry[]) => {
  const components = entries.flatMap((e) => (e.component ? [e.component] : []));
  return {
    catalogue: catalogueOf(components),
    components,
    entries,
    loaded: true,
  };
};

export const useComponents = create<ComponentsStore>(() => ({
  catalogue: catalogueOf([]),
  components: [],
  entries: [],
  load: () => componentsData.read().catch(reportError),
  loaded: false,
}));

const take = (list: ComponentList) =>
  useComponents.setState(fromEntries(list.components));

const componentsData = follow({
  apply: take,
  on: { components: take },
  read: () => api().request("components.list", undefined),
});

/** An app component's file, by name. */
export const appComponentOf = (
  components: readonly ComponentFile[],
  name: string
) => components.find((c) => c.origin === "app" && c.name === name);

/** Whether the editor may put something inside a node: a container, or a component that takes children. */
export const holdsChildren = (node: DesignNode): boolean =>
  takesChildren(
    node,
    node.type === "instance"
      ? metaOf(useComponents.getState().catalogue, node)
      : undefined
  );
