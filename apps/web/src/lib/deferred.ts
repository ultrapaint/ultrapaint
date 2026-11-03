/**
 * A component whose code is loaded apart from the editor's first bundle: fetched ahead of time by
 * `preload`, and then drawn at once. React's `lazy` suspends on a component's first draw even when
 * its code is in, and React keeps a fallback it has shown for 300 ms: a panel opened after its code
 * had arrived still showed its fallback that long. Before its code is in, it is `lazy`'s.
 */
import { type ComponentType, createElement, lazy } from "react";

export const deferred = <P extends object>(
  load: () => Promise<ComponentType<P>>
) => {
  let loaded: ComponentType<P> | null = null;
  const preload = () =>
    load().then((component) => {
      loaded = component;
      return component;
    });
  const Lazy = lazy(() =>
    preload().then((component) => ({ default: component }))
  );
  const Component = (props: P) =>
    createElement(loaded ?? (Lazy as ComponentType<P>), props);
  return { Component, preload };
};
