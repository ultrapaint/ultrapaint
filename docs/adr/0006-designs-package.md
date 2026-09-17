# ADR 0006: Screens live in a workspace package

Status: superseded by 0011: a designs package still works, but is no longer required. Accepted 2026-09-17. Confirms D2 and D14.

For epicparty the screens live in `products/prime/designs/`, a workspace package named
`@epicparty-prime/designs` that depends on `@epicparty/ui-components`,
`@epicparty-prime/ui-theme`, React and the Vite plugins. Flows are subdirectories; each flow
has a `canvas.json` with frame positions and viewport presets, written formatted. The host CSS
entry (`host.css`) imports the product theme and fonts. Everything is text and reviewable.
