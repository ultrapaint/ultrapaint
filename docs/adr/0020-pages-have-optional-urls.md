# ADR 0020: A page is named by its file, and its URL is optional

Status: accepted, 2026-09-30. Amends 0012 (routes no longer come from the file system) and 0019
(the canvases leave the Pages panel).

## Context

A page's path was its route: `settings/billing.page.json` was `/settings/billing`, and the only
way to change a URL was to move the file. That made every page a screen of the application,
which most drawings on a canvas are not: a sketch, a sheet of components, a second take of a
screen. It also made the Pages panel, a route tree, the way to find and manage pages in every
workspace, although routing only matters to the prototype. The canvas and the layers already
show the pages in Design and Vibe.

## Decision

**A page is its file; its URL is optional.** A page is `<name>.page.json`, named after the file
("Billing settings" is `billing-settings.page.json`). The URL it serves in its canvas's prototype
lives in `canvas.json`, in `routes`, keyed by the page's path like `frames`. A page without one is
drawn and edited like any other, but no link and no step of the prototype reaches it. A variant's
page serves its base page's URL. Two pages of a canvas never serve one URL.

- Renaming a page moves its file, and its variants' files, and keeps its URL, so links to it
  stay. Changing the URL is its own action (`pages.setRoute`, `set_page_url`); links name URLs,
  so links to the old one lead nowhere afterwards.
- A duplicate serves no URL. A page copied or moved to another canvas takes its URL along, and is
  refused there when that canvas serves the URL already.
- A `canvas.json` without `routes` was written before this: each page serves the route its path
  names, as 0012 had it, until the first change to the canvas's pages writes the routes out.
  Nothing has to be converted.

**The Pages panel is the prototype's.** It is on the rail in the Prototype workspace only, as a
flat list: the pages that serve a URL, in URL order, then the ones that do not, each marked with a
warning. The prototype can show a page without a URL (the editor's URL then says `?page=<id>`),
with a warning over its bar and a way to give it one.

**The canvases are switched from under the project**, in every workspace: a button with the open
canvas's name opens the list 0019 put above the pages, with the same actions, and the Figma
import.

## Consequences

- Agents name a page by its URL, or by its file when it has none (`read_page`, `apply_operations`,
  `focus`, `set_frame`, `get_screenshot`, node references such as `drafts.page.json#c_1`).
  `create_page` takes a name and an optional URL; `rename_page` takes a name.
- `/implement` asks the user where a page without a URL belongs before writing it; `/components`
  draws its sheets without URLs.
