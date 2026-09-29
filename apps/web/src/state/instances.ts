/**
 * How the previews drew the instances, by node id (`ed:instances`): how each component lays out
 * the children it is given, and whether it keeps its props to itself, so that its box is drawn
 * on a wrapper around it. The Code tab writes instances as they were drawn, and the inspector
 * says when a component had to be wrapped. Node ids are unique across a space, so every frame
 * reports into the one record; what a frame no longer draws is simply never asked for.
 */
import type { InstanceDrawn } from "@ultrapaint/contracts/preview";
import { create } from "zustand";

interface InstancesStore {
  readonly drawn: Readonly<Record<string, InstanceDrawn>>;
  readonly report: (instances: Readonly<Record<string, InstanceDrawn>>) => void;
}

export const useInstances = create<InstancesStore>((set) => ({
  drawn: {},
  report: (instances) => set((s) => ({ drawn: { ...s.drawn, ...instances } })),
}));
