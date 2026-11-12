# ADR 0086: The open panel's rail item takes it back to where it starts

Status: accepted, 2026-11-12.

## Context

A click on the rail's item for the panel on screen put the panel away, as a second click on a tab
of pen.dev or Figma does. The person clicks it to get back to the panel's start (the chat's list
from a thread, most of all) and lost the panel instead. Putting the left panel away has its own
command and keys.

## Decision

- **The open panel's item takes it back to where it starts** (`showLeftPanelStart`): the chat's
  list from a thread, Changes' lists from a diff, the foundations from the Sync while there is a
  design system to list. Where the panel already starts, the click does nothing.
- **It never puts the panel away.** That is the left panel's own command.

## Consequences

- A view in place of a panel's lists that the rail should lead back from is added to
  `showLeftPanelStart` as it is made.
- The look page's panel follows its board item, not the rail: it is left as it is.
