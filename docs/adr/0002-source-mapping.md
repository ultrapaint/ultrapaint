# ADR 0002: Element to source mapping

Status: superseded by 0015, 2026-09-25. Accepted 2026-09-17, confirming D4 and D17.

## Context

React 19 removed `_debugSource`. We need the file, line and column of the JSX that produced a
DOM element, and the component instance that owns it.

## Decision

A Vite `transform` hook with `enforce: "pre"` parses every `.tsx` under the designs directory
and the configured library directories with `@babel/parser` and inserts
`data-ed="<repo-relative file>:<line>:<col>"` on every JSX opening element with magic-string,
returning a high-resolution source map. Column is 0-based, line 1-based, both at the `<`.

The runtime injected into the iframe does not read the DOM attribute alone. It installs a
minimal React DevTools hook to receive fiber roots on every commit and walks the fiber tree.
A component fiber whose `memoizedProps["data-ed"]` is set is a stamped instance; host fibers
are elements; a component that carries the same stamp as its stamped ancestor is a forwarding
wrapper and stays transparent. This yields the "Layers are the DOM" tree with design-system
instances as named nodes, and selection prefers the instance over the host element it renders.

## Consequences

- Works with Vite 8 (rolldown) because it does not touch the React plugin's Babel chain.
- Design-system files are stamped too, so an element inside a component can say where it comes
  from and offer the nearest editable ancestor.
- Stamping is dev-only and never reaches product bundles; the include list is explicit.
