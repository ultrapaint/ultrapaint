# ADR 0016: A Figma file is imported by rules, and mapped by an agent

Status: accepted, 2026-09-28. Extends 0014 and 0015.

## Context

Designs often start in Figma, and a team that adopts this tool mid-project has frames there
already. A `.fig` file is a zip around a kiwi-encoded list of node changes; the format is
undocumented but well read by open-source parsers, and it holds what a page document needs:
auto-layout frames, text with its font, image fills, vector shapes, and instances of components
with their variants and property values.

What it does not hold is which component of *this* repository a Figma component stands for. A
Figma "Button" with `Size` and `Type` variants may be the repository's `Button` with `size` and
`variant` props, a component under another name, or a drawing the repository has no component
for. That is a judgement, and where the names do not settle it, the user's.

## Decision

**The file is read by fixed rules, in a pure package.** `@ultrapaint/figma-import` reads a
`.fig` with `openfig-core` and converts a frame to a page document with no judgement: an
auto-layout frame is a row or column with its gap, padding, alignment and sizing (`fill` for a
child that grows or stretches, `hug` for a frame that fits its content); a free-layout frame is
a group whose children are stacked in reading order, and whose full-size first rectangle
becomes its own fill; text keeps its size, weight, family, line height, colour and alignment,
and reads as a heading when it is short and large; an image fill becomes an image node; a
shape, or a container made only of shapes (an icon), becomes an SVG file and an image node.
Colours the design system has a token for come out as that token; the rest stays CSS. What the
rules cannot carry over is said in warnings: grid layouts, absolute children, mixed text styles,
background images on frames.

**An instance becomes what the mapping says.** The import keeps, per Figma component, one of
three decisions: *component* (replaced by a component of the repository, with rules that turn
the Figma variants and properties into its props and text), *expand* (kept as the layers it is
made of, with the instance's overrides and property values applied: custom), or *skip*. An
instance of a component without a decision is expanded and counted, so a page can be written
before every decision is made, and the count says what is still open.

**The decisions are an agent's, and some are the user's.** The file is uploaded from the Pages
panel (over HTTP: the RPC socket carries JSON, and design files run to tens of megabytes), kept
in the state directory under `imports/`, and a thread opens with `/import-figma`. The agent
reads the file through the editor's MCP server (`read_figma_import`, `read_figma_frame`,
`read_figma_component`), decides with `map_figma_component` — the tool refuses a component the
repository does not have and fills in where it is imported from — and writes frames with
`write_figma_frame`, which makes the page, copies its pictures into the space's assets and sizes
its frame on the canvas as in Figma. Where the names leave a doubt, the agent asks the user
with `ask_user`: a card in the thread with the candidates as options, "custom" and "skip"
among them. The import lists the candidates itself, by name similarity, so the agent and the
user start from the likely answer.

**`ask_user` does not block.** The tool posts the card and returns; the agent ends its turn;
the user's answers are recorded on the card and sent to the agent as the next prompt, one line
per question. The blocking alternative — a tool call that waits for a human — runs into the
tool-call timeout every ACP agent has, and a prompt is what every ACP agent already handles.
The card refuses to send while the agent's turn is still running, so an answer never arrives
mid-turn.

## Consequences

- A new package, `packages/figma-import`, pure and synchronous like `framework-react-vite`,
  tested with `.fig` files built in the test from nodes and encoded the way Figma writes them.
  `openfig-core` is its one dependency; the server does not import it.
- `FigmaImportService` is a project service; the imports move with the state directory when
  an unsaved session is saved.
- The transcript has a `question` item kind, and `threads.answer` is the RPC that answers it.
  `ask_user` is not specific to Figma: `/init` and any other task may use it.
- The page format gains nothing. What it cannot hold — absolute positions inside a frame,
  vectors as vectors, rich text, grids — is approximated and reported, for the agent to mend
  with the tools it already has after looking at the page with `get_screenshot`.
- Library components whose masters are not in the file cannot be expanded; they become empty
  groups, and the import says how many there are.
