# ADR 0080: A failed load is said in the empty state's form

Status: accepted, 2026-11-11.

## Context

A panel whose content could not be read said so three ways. Layers: a muted line, "The layers
didn’t load.", over a filled Try again at its left. The Library: a muted line, "The components
didn’t load", with a text Try again at the row's right. The chat: the Library's row, under its
header. The person liked none of them and asked why they differed. Each was a line of 12px muted
text at the top of an empty panel, quieter than the button under or beside it, in a panel that
otherwise said its states (no canvas, no pages yet) centred in it, a muted icon over a title, a
sentence and one action (DESIGN.md, Components).

The red box (DESIGN.md: an error tied to a row, on a 10% red tint) was the other form at hand.
It is for something the person can read and fix: git's words under a commit, a file that is not
a valid page. A read that failed is neither: the server didn't answer, there is nothing to fix
but to ask again, and the whole panel is empty because of it.

## Decision

**A panel whose content didn't load says so where the content would be, in its empty state's
form** (`PanelFailed`, `apps/web/src/components/panel.tsx`, built on `PanelEmpty`):

- centred in the panel's content area, what stays of the panel (its header, a search) in place;
- a muted alert icon (Lucide's `CircleAlert`, the icon a failed chat has in the list) at the
  empty state's 20px, which with the words says it failed: the block takes no red;
- the title in the panel's own words, `font-body-medium` in the foreground, no full stop as an
  empty state's has none: "The layers didn’t load", "The components didn’t load", "The chat
  didn’t load";
- the reason under it in `font-body-small` muted, when one is known, and nothing there when not;
- Try again as the empty state's action is drawn: a small `secondary` button under the words;
- `role="alert"`, so a screen reader says it when it takes the loading rows' place.

Layers, the Library (insert list and navigation) and a chat whose transcript didn't load use it.
The Changes panel keeps its red box with git's words, which the person approved.

**In a file's problem (`FileProblem`), what the file writes is in code and nothing else is.** A
file `JSON.parse` refused is said as one sentence, "The file isn’t JSON: unexpected token `<` in
`ldren": [ <<<<<<< HE`.", the characters the parser quotes and the text around the error in
`font-code`, as a schema message's values and places already were and as the path to fix is. Its
lines used to be split into separate paragraphs at the excerpt's line breaks, all in the body
face. The box stays `font-body` (14/20), whose line height `font-code` (12/20) shares, so a line
with code in it is as high as one without.

## Consequences

- One failed-load form across the panels, the same shape and weight as an empty one: the panel
  reads as in a state, not broken, and the action is as easy to hit as New page.
- No panel holds the reason for a failed read yet: the stores keep only that it failed, and the
  reason goes to the editor's error report. A store that keeps one passes it as `PanelFailed`'s
  children.
- The design-system tokens' failed read (`sync-tokens.tsx`) still has its own line and is the
  next to move to `PanelFailed`.
