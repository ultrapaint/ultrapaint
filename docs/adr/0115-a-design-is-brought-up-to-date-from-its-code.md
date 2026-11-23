# ADR 0115: A design is brought up to date from its code, on the person's prompt

Status: accepted, 2026-11-23. Amends 0030 (no reading code back into designs) and 0102 (Implement
is the Implementation section's one button). Story: UP-110.

## Context

0030 made *code changed* "only a flag: the tool does not redraw the design from it", and ruled
out "reading code back into designs". So a page keeps showing the screen as it was designed, not
as the app now draws it: fixes, follow-ups and other people's commits never reach it, and a
redesign starts from a page the app left behind. A page never linked to its code cannot even show
the flag. None of Ultrapaint's own seven canvases is linked, and `apps/web` moved 68 commits since
they were drawn.

The person settled it on 2026-11-23: a page is updated in place, its history keeping the old
version; where its design changed too, the two sides are reconciled, never one taken whole; the agent reads the code and, where it can, looks at the running screen; the editor
flags and offers, for a page and for a canvas.

## Decision

- **Reading the code back into a design is allowed, for this task.** So is looking at the running
  application to do it. It is still never automatic: the editor flags *Code changed* and offers
  **Update from code**, and an agent works only once the person sends the task (0074). Nothing
  watches the files, redraws, or prompts an agent when code changes.
- **One task request, `UpdateFromCode`**, beside Implement and Adopt, written
  `/update-from-code [canvas | page…]` in the contracts' slash-command catalogue: a canvas (`""`
  for the designs directory's own) names its pages, anything else a page; none names every page
  whose code changed, a page not linked yet only when it or its canvas is named, since every draft
  not built yet is unlinked too. The server's page tasks write its text. Its thread
  is a `design` thread: it writes the designs directory only and reads the code, as a design
  thread may.
- **Which pages it takes:** those whose code changed since they were implemented (*Code
  changed*, with or without *Design changed*), and those not linked yet. A page implemented with
  nothing changed, or whose design alone changed, is left out; a request that leaves out every
  page it names is refused, as `--adopt`'s is.
- **What the agent is told, per page:** its file; for a linked page, the files that implement it,
  which of them changed since, and the design as it was implemented (`_implemented/`); when the
  design changed too, that those changes never reached the code and are reconciled; the widths
  it is drawn at (its frame's and its views', the desktop width without a frame); its states (a
  base page names them; a state is taken on its own when it is behind too); its links and behaviour notes.
  Then: find the files of a page not linked yet, as `--adopt` does; read the
  changed files first; look at the running screen at the widths the page is drawn for where it
  can (a browser, or a view at a width, the design skill's words, through the agent ways), and
  otherwise update from the code alone and say so; rewrite the page in place (same page, same
  URL, the node ids, states, links and behaviour notes that still hold), with the design system's
  components and tokens; leave a page no code draws as it is and name it; mark it implemented
  with the files that draw it.
- **Where the design changed too, both are reconciled, never one taken whole.** The agent sets
  the design's changes since the page was implemented beside the code's (its files' git history
  since then). A change only one side made is kept; where both changed the same thing, the
  history decides what is current (which came later, and what its commit or note says it was
  for); where it cannot tell, it asks the person before it writes. It brings the page to the code
  and marks it implemented, then puts back the design changes kept, so the page reads *Design
  changed* and implementing it builds what is left. Its last message says what was kept, what
  the code had overtaken and what the person decided. The person settled this on 2026-11-23,
  after the first build replaced the design's changes.
- **The old version is the history's.** The rewrite is an agent's turn, so the designs' history
  (0087) keeps the page as it was before it, to restore.
- **Where the editor offers it.** The Code tab's Implementation section has an **Update from code**
  button when the page's code changed, under a line saying the agent reconciles both, and asks
  where it can't tell, when the design changed too; Implement stays beside it (amending 0102's
  one button). A page not linked yet has it in the section's ⋯ menu only, beside *Find its code
  with an agent*: every draft not built yet is unlinked, and a button there would offer a run that
  finds no code. A canvas's menu in the list has *Update its pages from code*; several pages
  picked, *Update N pages from code*. Each drafts the task in a new chat for the person to send
  (`startTask`).
- **Outside the editor**, `update-from-code` is one of the MCP prompts, its argument completed
  from the canvases and the pages, and `handoff`'s `list` already shows the pages whose code
  changed and their files.

## Consequences

- A canvas can be brought back to what the app draws without redrawing it by hand, and the next
  change on either side is flagged again once the page is marked.
- Components (`component:<Name>`) are not updated from their code: another story.
- The editor gains no app runner, mocks or data: the agent sees the running screen with what it
  has.
