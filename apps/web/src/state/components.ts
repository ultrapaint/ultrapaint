/**
 * The components of the designs directory (ADR 0041): every preview draws the looks of the
 * system components the project owns over them, and the app components in their instances'
 * place. Kept up to date from the server, whoever changes a file.
 */
import type {
  ComponentEntry,
  ComponentFile,
  ComponentList,
} from "@ultrapaint/contracts/components";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

interface ComponentsStore {
  /** The components that read, which is what the previews draw. */
  components: readonly ComponentFile[];
  /** Every component's file, read or with its problem. */
  entries: readonly ComponentEntry[];
  load: () => Promise<void>;
  loaded: boolean;
}

const fromEntries = (entries: readonly ComponentEntry[]) => ({
  components: entries.flatMap((e) => (e.component ? [e.component] : [])),
  entries,
  loaded: true,
});

export const useComponents = create<ComponentsStore>(() => ({
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
