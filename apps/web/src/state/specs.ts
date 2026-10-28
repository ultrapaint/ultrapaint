/**
 * The component specs of the designs directory (ADR 0029): every preview draws the ones whose look
 * the design owns over their components, and the drafts in their instances' place. Kept up to date
 * from the server, whoever changes a file.
 */
import type {
  ComponentSpec,
  SpecEntry,
  SpecList,
} from "@ultrapaint/contracts/specs";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";
import { follow } from "./server-data.ts";

interface SpecsStore {
  /** Every spec file, read or with its problem. */
  entries: readonly SpecEntry[];
  load: () => Promise<void>;
  loaded: boolean;
  /** The specs that read, which is what the previews draw. */
  specs: readonly ComponentSpec[];
}

const fromEntries = (entries: readonly SpecEntry[]) => ({
  entries,
  loaded: true,
  specs: entries.flatMap((e) => (e.spec ? [e.spec] : [])),
});

export const useSpecs = create<SpecsStore>(() => ({
  entries: [],
  load: () => specsData.read().catch(reportError),
  loaded: false,
  specs: [],
}));

const take = (list: SpecList) => useSpecs.setState(fromEntries(list.specs));

const specsData = follow({
  apply: take,
  on: { specs: take },
  read: () => api().request("specs.list", undefined),
});

/** The spec of a component, by name and module. */
export const specOf = (
  specs: readonly ComponentSpec[],
  component: string,
  from?: string
) =>
  specs.find(
    (s) => s.component === component && (from === undefined || s.from === from)
  ) ?? specs.find((s) => s.component === component);
