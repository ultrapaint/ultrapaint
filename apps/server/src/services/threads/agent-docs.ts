/**
 * What agents are told of the designs, each thing in one paragraph, for every text that tells it:
 * the MCP server's instructions, which every agent that connects reads, the briefing of a thread,
 * and the tasks. A paragraph says what is true whichever way the agent works; how it works with
 * the editor's tools or without them is `agent-ways`. Pure.
 */
import {
  APP_FROM,
  COMPONENTS_DIR,
  type ComponentOrigin,
} from "@ultrapaint/contracts/components";

/** The canvases, and what each holds. */
export const canvasesIn = (
  designsDir: string
) => `Designs live in ${designsDir}, in canvases: a directory with a canvas.json is a canvas
(the designs directory itself when there is only one), and each has its own pages, the URLs they
serve in its prototype and nodes placed beside them — wireframes in one, components in another, a
second version of the application in a third. A link never leaves its canvas, and tools take
\`canvas\` to say which (the designs directory's own is "").`;

/** A page: a document of a canvas, its URL, its variants, and one tree for every width. */
export const PAGES = `A page is a design document, not code: a <name>.page.json file inside its canvas. It may serve a
URL, its route, in the canvas's prototype (/settings/billing, /invoices/:id), which canvas.json
keeps: a screen of the application has one, a sketch or a sheet of components needs none. A page
without one is a draft: the prototype shows only routes, and a link to a draft leads nowhere
until it has one. pricing@bold.page.json is pricing.page.json drawn again for
the variant "bold": it serves the same URL, shown in its place when the prototype is in that
variant; orders@empty.page.json is the orders page in its empty state. A page is one tree for
every width, mobile-first: a node's fields are the smallest screen's, and its \`at\` says what
differs from a breakpoint of the design system up (at.md); its views draw it at other widths.`;

/** The nodes a page is a tree of, in a line, for an agent that reads the rest from the format. */
export const NODES = `Its nodes, each with an id: page, row, column, group, text, image (src assets/<file>: a canvas's own
assets/, else the shared one of the designs directory) and instance, of a system component or an
app component, its children filling its slots.`;

/** A system component's look, as its file keeps it (ADR 0041). */
const SYSTEM_LOOK = `origin "system": the look of a system component, whose behaviour is fixed: "base", "variants"
  (per axis, per member), "states" (hover, focus, active, highlighted, disabled, open, checked,
  invalid) and "variantStates" (per axis, per member, per state: an outline button's hover; it
  wins over the state's, which wins over the member's), each style fields per part (root or a
  data-slot): fill, color, border, radius, padding (one or per side), height, width, gap,
  direction, align, crossAlign, order, fontSize, fontWeight, shadow, opacity; "content" (nodes per
  slot, drawn when an instance gives it none), "hidden" (optional parts left out) and, for Select
  and Menu, "item" ({ tree, label, image }: nodes drawn per item, label and image the ids showing
  them). Without a file it has its default look.`;

/** An app component, as its file keeps it (ADR 0041). */
const APP_COMPONENT = `origin "app": the project's own component, placed with from "${APP_FROM}": "tree" (a node, its
  root the instance), "properties" ([{ name, kind: text|boolean|choice|image, default, members?,
  targets?: [{ node, prop? }] }]: what an instance's props set, a text's text, a node shown, an
  image's src, or a prop of the component the node is; a choice's member overrides a node's fields
  in its at under "<property>=<member>") and "slots" ([{ name, node, default? }]: containers its
  children fill, as a system component's). It cannot take a system component's name or place itself.`;

/** How a component's file of one origin reads. */
export const componentBody = (origin: ComponentOrigin) =>
  origin === "system" ? SYSTEM_LOOK : APP_COMPONENT;

/** The components' files: one envelope, and a body of each origin's. */
export const componentFiles = (
  designsDir: string
) => `Components are files of ${designsDir}/${COMPONENTS_DIR}/, <Name>.component.json, one each:
{ "version": 1, "name", "origin": "system" | "app", "description"?, "category"?, "notes"? }, with
- ${SYSTEM_LOOK}
- ${APP_COMPONENT}`;
