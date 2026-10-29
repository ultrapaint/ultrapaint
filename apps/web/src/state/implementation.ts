/**
 * Which designs are implemented, ready, or changed since (ADR 0030): the Pages panel, the
 * inspector and the Components tab read each design's status from here. The server pushes it
 * whenever a design, a binding or a component's file changes; a change to the code is seen when the list is
 * read again, which the panels do when they open.
 */
import type {
  ImplementationItem,
  ImplementationList,
} from "@ultrapaint/contracts/implementation";
import { toast } from "sonner";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

interface ImplementationStore {
  byTarget: Readonly<Record<string, ImplementationItem>>;
  load: () => Promise<void>;
  loaded: boolean;
}

const indexed = (list: ImplementationList) => ({
  byTarget: Object.fromEntries(list.items.map((i) => [i.target, i])),
  loaded: true,
});

export const useImplementation = create<ImplementationStore>(() => ({
  byTarget: {},
  load: () => implementationData.read().catch(reportError),
  loaded: false,
}));

const take = (list: ImplementationList) =>
  useImplementation.setState(indexed(list));

const implementationData = follow({
  apply: take,
  on: { implementation: take },
  read: () => api().request("implementation.list", undefined),
});

const statusWords = (item: ImplementationItem): string => {
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

/**
 * Whether the code draws a design implemented as it is: not while tokens it uses wait for the
 * code (ADR 0028), which the status says alongside.
 */
export const tokensWaiting = (item: ImplementationItem | undefined) =>
  (item?.status === "implemented" || item?.status === "changed") &&
  (item.tokens?.length ?? 0) > 0;

/** What a status reads as, in a few words. */
export const statusLabel = (item: ImplementationItem | undefined): string => {
  if (!item) {
    return "";
  }
  const words = statusWords(item);
  return tokensWaiting(item) ? `${words} · tokens wait for the code` : words;
};

/**
 * The design's values of these tokens written to the code (ADR 0028). What changed on both
 * sides is left for the Sync view, where the user picks.
 */
export const exportTokens = async (names: readonly string[]) => {
  try {
    const { files, written } = await api().request("sync.apply", {
      decisions: [],
      only: "export",
      source: "code",
      tokens: [...names],
    });
    toast.success(
      written === 0
        ? "Nothing was written: they changed in the code as well. Pick which to keep in Sync."
        : `${written} token value${written === 1 ? "" : "s"} written to ${files.join(", ")}.`
    );
  } catch (error) {
    reportError(error);
  }
};
