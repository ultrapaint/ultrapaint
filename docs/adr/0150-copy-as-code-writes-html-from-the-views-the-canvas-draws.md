# ADR 0150: Copy as code writes HTML from the views the canvas draws

Status: accepted, 2026-11-25. Follows 0024 (the style system writes classes), 0040 (system
components) and 0041 (app components); the Code tab stays as 0102 has it.

## Context

The Code tab writes a node as JSX: a system component as an import from `@/components/ui`, an
app component as the application's component of its name. That runs only where those components
exist. UP-135 adds **Copy as code** to an element's menu, JSX or HTML, and HTML has to stand on
its own: a static page, an email, another stack, an agent without the repository.

## Decision

- **One writer, two printers.** design-document's code module walks a node once for both
  formats, at the same levels with the same `ClassWriter`, so a node's classes are the same in
  both; each format prints the tree its own way (`className` or `class`, `{/* */}` or `<!-- -->`,
  JSX's escapes or HTML's). `toCode` writes JSX, its imports left out on request; `toHtml`
  writes HTML and needs nothing of the application.
- **An app component's instance is its layers**, as the instance draws them, its properties and
  overrides applied (`instanceLayers`, ADR 0114), where the instance stands, as Detach leaves it.
- **A system component's instance is the markup its own view renders at rest.** The server
  renders the view the canvas draws (system-components' `restingMarkupOf`) with
  `react-dom/server`, without the editor's frame, closed whatever the design opens, its slots
  held in `ed-slot` placeholders and its element marked, and reads the markup back into a tree.
  The writer puts on each `data-slot` element the declarations of its look at rest in the
  instance's variant (the default look, then the project's over it, as the canvas lays them;
  `restingDeclarations`), the instance's own style over its element's, and takes the editor's
  marks (`data-ed-*`, `data-system`) off. React's generated ids take the instance's id as their
  prefix, so two instances in one snippet keep theirs apart.
- **Copy as code is the element's menu's** (ADR 0102): that menu's job is what can be done with
  the element, and taking its code elsewhere is one of those things. Its submenu, "Copy as code ›
  JSX with Tailwind classes / HTML with Tailwind classes", sits beside View code under the same
  rule: not on a board's node, which is generated (ADR 0045), and not on an instance's layer,
  whose code is its main component's. A page's own menu, about the page's file, gets nothing.
  The Code tab keeps its job, reading the node's code, and is unchanged.
- **`code.write` takes the format** (`format: "tsx" | "html"`, `tsx` when left out, and
  `imports`), and answers the language it wrote. The Code tab sends neither.
- **The clipboard is written while the click's gesture holds**: the write opens at once with a
  `ClipboardItem` whose text is the promise of the joined answers, so a browser that asks for the
  gesture keeps it, and a failed answer takes the whole write down.

## Considered options

- **A hand-written HTML template per system component.** Rejected at triage: it drifts from the
  views the canvas draws. Rendering the views makes the markup the canvas's by construction.
- **Rendering in the editor**, which has React already. Rejected: `code.write` is the one place
  code is written for any client, and the editor would need the server's style system anyway.

## Consequences

- The server renders React. It depends on `react` and `react-dom`, its bundle carries Base UI
  (`dist/bin.mjs` from 6.9 MB to 9.3 MB, unminified), and its tsconfig takes the document's types
  (`DOM`), since the views' effects, which never run there, are typed against it.
- The views say their JSX runtime in their own file (`@jsxRuntime automatic`): in development
  the server runs under tsx with its own tsconfig, which tsx applies to the server's files
  alone, so a package's tsconfig does not reach it there. A guard runs them that way
  (`scripts/dev-server.test.ts`).
- At rest means what the canvas shows before anything happens: an overlay is its trigger alone,
  so a dialog without a trigger and a toast draw nothing and are written as a comment that says
  so. Hover, focus and open are behaviour, the JSX component's (UP-135's Out of Scope).
- Only a look's style fields reach the HTML. The layout the default look's stylesheet gives the
  parts beside them (a button's `inline-flex`, a field's column) is CSS of `look.ts`, not data,
  and is not written.
