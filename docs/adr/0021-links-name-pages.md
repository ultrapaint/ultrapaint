# ADR 0021: A link names a page, and the prototype shows what can be pressed

Status: accepted, 2026-10-01. Amends 0012 and 0020 (a link was a route).

## Context

A node's `link` was a route. Since 0020 a page's URL is optional and can change, and a link that
named a URL broke with it, silently: nothing said so until the prototype showed "No page" after a
press. A page without a URL could not be linked to at all. Links were set in one place, the last
section of the Design inspector, and nothing on the canvas or in the prototype showed which
elements could be pressed.

## Decision

**A link is one string, in one of four forms** (`@ultrapaint/shared/link`):

- a page file of the canvas, `pricing.page.json`: what the editor writes. It leads to the page at
  whatever URL it serves, or to the page itself when it has none, and in a variant to the
  variant's drawing of it;
- a URL, `/invoices/42`: the page serving it, with its parameters;
- `back`: the previous step of the click-through;
- another site, `https://…`, opened beside the prototype.

**Links follow their page.** Renaming a page rewrites the links naming its file; changing or
taking off its URL rewrites the links naming the old URL to name the page's file. Both are in the
same undo step. Deleting a page says how many links lead to it.

**Links are set where the element is**: the inspector's "Goes to", the element's right-click menu
("Link to"), and a link button in the Vibe toolbar, all with the same choices. A link to a page
that is not there says so in each, and on the selection's tag. A node placed beside the pages has
no link to set.

**The prototype shows what can be pressed**: a switch in its bar keeps the hotspots up, and a
press that lands on nothing linked flashes them, as Figma's prototype does. The preview reports
presses with `ed:pressed`. On the canvas, a link pressed in interact mode brings the frame of the
page it leads to into view instead of changing what the pressed frame shows.

## Consequences

- Links written as routes keep working; the editor only writes page files from now on.
- The code an agent or the Code panel writes turns a page-file link into the URL the page serves.
