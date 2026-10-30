/**
 * Where a component is used, on its board's inspector, a system component's and an app
 * component's alike.
 */
import { useMemo } from "react";
import { componentUsesOf } from "../lib/component-uses.ts";
import { useComponents } from "../state/components.ts";
import { UsesSection, usePagesRead } from "./token-inspector.tsx";

/** Where a component is used: the pages of the canvas open, and the app components placing it. */
export const ComponentUsedIn = ({
  from,
  name,
}: {
  from: string;
  name: string;
}) => {
  const pages = usePagesRead();
  const components = useComponents((s) => s.components);
  const uses = useMemo(
    () => componentUsesOf(name, from, { components, pages }),
    [name, from, components, pages]
  );
  return (
    <UsesSection
      count={(use) => (use.count > 1 ? String(use.count) : null)}
      uses={uses}
    />
  );
};
