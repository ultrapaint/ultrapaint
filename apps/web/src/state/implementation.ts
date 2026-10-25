/**
 * Which designs are implemented, ready, or changed since (ADR 0030): the Pages panel, the
 * inspector and the Components tab read each design's status from here. The server pushes it
 * whenever a design, a binding or a spec changes; a change to the code is seen when the list is
 * read again, which the panels do when they open.
 */
import type {
  ImplementationItem,
  ImplementationList,
} from "@ultrapaint/contracts/implementation";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";

interface ImplementationStore {
  byTarget: Readonly<Record<string, ImplementationItem>>;
  load: () => Promise<void>;
  loaded: boolean;
}

let bound = false;

const indexed = (list: ImplementationList) => ({
  byTarget: Object.fromEntries(list.items.map((i) => [i.target, i])),
  loaded: true,
});

export const useImplementation = create<ImplementationStore>((set) => ({
  byTarget: {},
  load: async () => {
    if (!bound) {
      bound = true;
      api().on("implementation", (list) => set(indexed(list)));
    }
    try {
      set(indexed(await api().request("implementation.list", undefined)));
    } catch (error) {
      reportError(error);
    }
  },
  loaded: false,
}));

/** What a status reads as, in a few words. */
export const statusLabel = (item: ImplementationItem | undefined): string => {
  if (!item) {
    return "";
  }
  switch (item.status) {
    case "draft":
      return "Draft";
    case "ready":
      return "Ready to implement";
    case "implemented":
      return "Implemented";
    default:
      return [
        item.designChanged ? "Design changed" : null,
        item.codeChanged ? "Code changed" : null,
      ]
        .filter(Boolean)
        .join(" · ");
  }
};

/** Runs a change to a binding; what goes wrong is reported. */
export const implementationRequest = async <A>(run: () => Promise<A>) => {
  try {
    return await run();
  } catch (error) {
    reportError(error);
    return null;
  }
};
