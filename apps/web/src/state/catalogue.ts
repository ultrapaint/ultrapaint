import type {
  Catalogue,
  ComponentMeta,
} from "@ultrapaint/contracts/catalogue";
import { appComponentsIn } from "@ultrapaint/contracts/components";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import { appComponentMeta } from "@ultrapaint/design-document/app-components";
import { takesChildren } from "@ultrapaint/design-document/tree";
import { create } from "zustand";
import { useComponents } from "./components.ts";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

interface CatalogueStore {
  /** The system components, then the project's app components (ADR 0041). */
  catalogue: Catalogue | null;
  load: (refresh?: boolean) => Promise<void>;
  loading: boolean;
  /** The catalogue as the server gives it: the system components. */
  system: Catalogue | null;
}

/** The server's catalogue with the app components after the system ones. */
const withApps = (system: Catalogue | null): Catalogue | null =>
  system && {
    ...system,
    components: [
      ...system.components,
      ...appComponentsIn(useComponents.getState().components).map(
        appComponentMeta
      ),
    ],
  };

export const useCatalogue = create<CatalogueStore>((set) => ({
  catalogue: null,
  load: async (refresh = false) => {
    set({ loading: true });
    try {
      if (refresh) {
        const system = await api().request("catalogue.get", { refresh });
        set({ catalogue: withApps(system), system });
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
  system: null,
}));

/** The components the editor offers, as the server last gave them. */
const catalogueData = follow({
  apply: (system: Catalogue) =>
    useCatalogue.setState({ catalogue: withApps(system), system }),
  read: () => api().request("catalogue.get", { refresh: false }),
});

// An app component made, changed or deleted is in the catalogue as soon as its file is.
useComponents.subscribe((now, before) => {
  if (now.components !== before.components) {
    useCatalogue.setState((s) => ({ catalogue: withApps(s.system) }));
  }
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
