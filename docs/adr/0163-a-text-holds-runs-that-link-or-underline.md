# ADR 0163: A text holds runs of its words that link or are underlined

Status: accepted, 2026-11-27. Follows 0015 (design documents and their operations), whose "rich
text is not part of the format yet" it ends for a link and an underline, 0021 (a link names a
page) and 0026 (one node per line). Amends 0148: pasted markup keeps an inline link and an
underline.

## Context

A text was one string, with one set of text fields for all of it, and a `link` the whole node's.
A designer asking for a sentence with a link inside it ("By signing up you accept the terms"),
or for a few words underlined, could not have it. In two weeks of usage logs, across two client
projects, agents worked around it: each link of a sentence became a text node of its own set in
the sentence's style, and an underline became a bottom border under a text squeezed to a line
height of 1, which the off-system check then flagged. The developer found both in the code.
UP-241 asks for links and underlines on some words, and for nothing else.

## Decision

- **A text's runs.** A text gains an optional `runs`: `[{ text, link?, underline? }]`, its words
  in order, each run with the fields it sets; a run with neither is plain words (contracts'
  `TextRun`). A list of strings, so a hand edit of the file keeps them, where ranges over `text`
  break once its words change. A run sets a link and an underline, nothing else: bold, italic, a
  colour and a text style on some words are left out until the logs ask, and the list takes a
  field later without a format change.
- **`text` is the runs' words joined**, written by the operations whenever `runs` is, so every
  reader that knows no runs (`read_page`'s match, the checks, the outline, an older Ultrapaint)
  still reads the words. When the two differ, `runs` win. The operations settle a text's runs
  (design-document's `text-runs`, `settleRuns`): a run of no words goes, neighbours that set the
  same are joined, and runs that set nothing leave a plain text, without `runs`.
- **Setting `text` alone takes the runs off** when it changes the words, and `apply_operations`
  says so in its warnings (`runsDropped`), as it says a field did nothing.
- **A text links as a whole or by its runs, never both**: an anchor holds no other. The
  operations refuse a run's link on a text with a `link`, and the other way round, naming the
  other. An underline is no link and goes with either.
- **Runs are the same at every breakpoint**: `runs` is a fixed field, and a text with runs has no
  `text` at a breakpoint. The operations refuse the one on the other.
- **A run's link is a link** (ADR 0021): the four forms, rewritten when its page is renamed or
  its URL changes, listed by `list_links`, the prototype's hotspots and the briefing's links,
  written as the URL its page serves.
- **Drawn and written inside the text's element.** The renderer draws a run's link as an anchor
  with no `href`, followed when pressed as a node's link is, and its underline under its words;
  the element is keyed by its runs, so an edit in place that changed them is drawn afresh. The
  code writer writes them on one line inside the text's element, as they are spaced: a run's
  link an anchor, its underline the style system's class (Tailwind's `underline`, a `span` when
  it does not link), a text that links as a whole leaving its runs' links out.
- **Edited in place as words.** The frame edits a text with runs as plain words, as before, and
  maps each edit onto the runs from what it changed and where the caret is (`spliceOf`,
  `spliceRuns`), never from the elements the browser left: what is typed inside a run stays in
  it; at the edge between two it joins the one before unless that one links or is underlined and
  the one after does not, so typing on after a link writes plain words; a run whose words are all
  deleted goes. ⌘U underlines the words selected, or takes the underline off when all of them
  have it. ⌘K keeps what was typed and asks the editor where the words selected lead
  (`linkWords`), which opens the inspector's "Goes to" field in a popover by them. Escape gives
  the element back as it was drawn. The inspector's Text field maps its edit onto the runs the
  same way, from the words both keep in order (`splicesOf`).
- **Where a whole text's link was offered**: the inspector's "Goes to" row and the Vibe toolbar's
  link button say that its words link, and the element's menu leaves "Link to" out.
- **Pasted markup keeps them** (amending 0148): an `a` with an `href` becomes a run's link, a `u`,
  an `ins` or an underline style a run's underline, neither warned. Bold, italic and other
  inline styles are still flattened into the words and warned.

## Considered options

- **Ranges over `text`** (`{ start, end, link }`). Smaller, but a hand edit of the words, or an
  agent setting `text`, leaves every range over the wrong words with nothing to say so.
- **A text node per run inside a row.** What agents did: it wraps as boxes, not as a line of
  words, and the code is not what a developer would write.
- **Rich text with every inline style.** Each field a run takes is one more the code writer, the
  editing in place and the paste must keep; the logs asked for links and underlines.

## Consequences

- No page is migrated: a text without runs reads, draws and is written as before.
- An older Ultrapaint reads a page with runs, its schema dropping the field it does not know, and
  shows the words without their links.
- A text's runs at a breakpoint, and runs on an app component's layer override, are not part of
  this.
- Figma import of text runs follows as its own story.
