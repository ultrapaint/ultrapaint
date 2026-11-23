/**
 * The components of the designs directory (ADR 0041): every preview draws the looks of the
 * system components the project owns over them, and the app components in their instances'
 * place. Kept up to date from the server, whoever changes a file; the catalogue (ADR 0042) is
 * made from them here, as the server makes it for the agents.
 */
import { type Catalogue, metaOf } from "@ultrapaint/contracts/catalogue";
import {
  type AppComponentFile,
  type ComponentChange,
  type ComponentEntry,
  type ComponentFile,
  type ComponentList,
  componentsIn,
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
  /** Reads them and follows them from then on; a failed read is reported, and `status` says so. */
  load: () => Promise<void>;
  /**
   * Whether they are read: loading until the first answer, failed while a read has failed and
   * none has landed. Once read, a read that fails keeps what was read.
   */
  status: "failed" | "loading" | "ready";
}

const fromEntries = (entries: readonly ComponentEntry[]) => {
  const components = componentsIn(entries);
  return {
    catalogue: catalogueOf(components),
    components,
    entries,
  };
};

export const useComponents = create<ComponentsStore>(() => ({
  catalogue: catalogueOf([]),
  components: [],
  entries: [],
  load: () => {
    if (useComponents.getState().status === "failed") {
      useComponents.setState({ status: "loading" });
    }
    return componentsData.read().catch((error: unknown) => {
      if (useComponents.getState().status !== "ready") {
        useComponents.setState({ status: "failed" });
      }
      reportError(error);
    });
  },
  status: "loading",
}));

const take = (list: ComponentList) =>
  useComponents.setState({
    ...fromEntries(list.components),
    status: "ready",
  });

const componentsData = follow({
  apply: take,
  on: { components: take },
  read: () => api().request("components.list", undefined),
  whole: ["components"],
});

/** An app component's file, by name; none for a system component's or a name no file has. */
export const appComponentOf = (
  components: readonly ComponentFile[],
  name: string
): AppComponentFile | undefined =>
  components.find(
    (c): c is AppComponentFile => c.origin === "app" && c.name === name
  );

/** Whether the editor may put something inside a node: a container, or a component that takes children. */
export const holdsChildren = (node: DesignNode): boolean =>
  takesChildren(
    node,
    node.type === "instance"
      ? metaOf(useComponents.getState().catalogue, node)
      : undefined
  );

/**
 * Changes a component's file on the server, an app component's or a system component's, on the
 * file as it is there now (ADR 0042), so a change made meanwhile stays; what the server refuses is
 * said. True when it went through.
 */
export const changeFile = async (
  file: Pick<ComponentFile, "name">,
  change: ComponentChange
): Promise<boolean> => {
  try {
    await api().request("components.change", { change, name: file.name });
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
};

/** A name for a new property of `file`: `base`, or `base 2`, `base 3`… while it is taken. */
export const freeName = (file: AppComponentFile, base: string) => {
  const taken = new Set(file.properties.map((p) => p.name));
  let name = base;
  for (let i = 2; taken.has(name); i += 1) {
    name = `${base} ${i}`;
  }
  return name;
};
