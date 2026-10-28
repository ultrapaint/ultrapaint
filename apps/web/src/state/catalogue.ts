import type {
  Catalogue,
  ComponentMeta,
} from "@ultrapaint/contracts/catalogue";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import { takesChildren } from "@ultrapaint/design-document/tree";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

interface CatalogueStore {
  catalogue: Catalogue | null;
  load: (refresh?: boolean) => Promise<void>;
  loading: boolean;
}

export const useCatalogue = create<CatalogueStore>((set) => ({
  catalogue: null,
  load: async (refresh = false) => {
    set({ loading: true });
    try {
      if (refresh) {
        set({ catalogue: await api().request("catalogue.get", { refresh }) });
      } else {
        await catalogueData.read();
      }
    } catch (error) {
      reportError(error);
    } finally {
      set({ loading: false });
    }
  },
  loading: false,
}));

/** The components the repository offers, as the server last scanned them. */
const catalogueData = follow({
  apply: (catalogue: Catalogue) => useCatalogue.setState({ catalogue }),
  read: () => api().request("catalogue.get", { refresh: false }),
});

/** The catalogue's entry for an instance: the same export from the same module, else by name. */
export const componentMetaOf = (
  catalogue: Catalogue | null,
  node: InstanceNode
): ComponentMeta | undefined =>
  catalogue?.components.find(
    (c) => c.name === node.component && c.importFrom === node.from
  ) ?? catalogue?.components.find((c) => c.name === node.component);

/** Whether the editor may put something inside a node: a container, or a component that takes children. */
export const holdsChildren = (node: DesignNode): boolean =>
  takesChildren(
    node,
    node.type === "instance"
      ? componentMetaOf(useCatalogue.getState().catalogue, node)
      : undefined
  );
