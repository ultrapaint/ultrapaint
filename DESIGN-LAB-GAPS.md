# Design lab gaps

Each entry is a place where a design made with the ultrapaint skill (`skills/ultrapaint/`) went
wrong, and how the skill could have prevented it. The design lab tests each gap, then changes the
skill. This file only records the gaps; don't edit the skill from here.

Add a gap when a person corrects a design the skill was used for. Record:

- **Kind**:
  - **missing**: the skill has no rule for it.
  - **missed**: the rule exists, but was not applied.
  - **process**: about how the skill is run, not what it says.
- **What happened** (and where).
- **The skill now**: what it already says, quoted from its file.
- **Proposed**: the rule or check the lab should test.
- **Test**: how the lab can tell whether the change works.
- **Status**: `open`, `testing` or `done`, with the lab's result.

## From the editor redesign, 2026-11-03

**Setup.** The lead agent read every reference, wrote `DESIGN.md`, and briefed six parallel agents,
one per area of the editor. The work is on branch `redesign`. The person then reviewed it one
section at a time.

### G1. An empty section drawn as an empty page (missing, open)

- **What happened.** In the Components panel, "In this project" had no components yet. It showed
  the full empty state (icon, title, sentence, button) between full groups, so the heaviest block
  in the panel was the one with nothing in it.
- **The skill now.** `states.md` ("Empty states start something") says the region keeps its place
  and offers one action. It doesn't say how big that should be.
- **Proposed** (for `states.md`). An empty section inside a populated list is one row, shaped like
  the list's rows, with its action. The full empty state (icon, title, sentence, action) is for an
  empty panel or page.
- **Test.** A list with one empty group among full ones. Pass when the empty group is about one
  row tall and isn't among the three heaviest things on a squint.

### G2. Groups as close as their rows (missed, open)

- **What happened.** In the Components panel, the gap between two groups was about the gap
  between rows, so the groups didn't read as separate.
- **The skill now.**
  - `spacing.md` ("Proximity shows the grouping"): "The gap between groups is at least twice the
    gap within one."
  - `patterns/navigation.md` gives padding 16, 24 between groups and 4 within.
- **Why it was missed.** The agents applied the rules they could check in the code: type roles,
  tokens, no blue washes. A rule about the relationship between two gaps needs the rendered
  screen.
- **Proposed.** A measured check instead of a new rule. After rendering, read the computed gaps of
  each list. Fail when the gap between groups is less than twice the gap within one.
- **Test.** Run the measured check and the agent's self-review on the same screens. Compare what
  each catches.

### G3. Every secondary text the same grey (missing, open)

- **What happened.** In the Components panel, all of these were `font-small` in the muted
  colour:
  - group labels;
  - counts;
  - the "Inserts into …" line;
  - descriptions.

  The panel read as names floating in one grey mass. The labels that structure it looked no
  different from the details that qualify a row.
- **The skill now.**
  - `color.md` and `typography.md`: two text colours, foreground and muted.
  - `components.md`: a count is "quiet".
  - Nothing limits how many roles muted text plays in one region, and nothing says a group label
    must outrank its rows' details.
- **Proposed.** A group label outranks the details inside its group, by weight or position (for
  example `font-heading-xsmall`, or a caption-sized label set apart by space), never the same
  small grey as a count. In one region, muted text plays at most two roles.
- **Test.** Lists with labels, counts and descriptions. A judge names the groups from a blurred
  screenshot.

### G4. A hint shown when it says nothing (missing, open)

- **What happened.** The Components panel always showed "Inserts into …" at its top, even with
  nothing selected, when it only named the default target.
- **The skill now.** `restraint.md` cuts what repeats its neighbour. It says nothing about context
  that depends on state.
- **Proposed.** Context that depends on a selection or a mode appears only in that state, beside
  the action it affects (here, a footer shown with a selection).
- **Test.** Panels whose action depends on a selection, drawn in both states.

### G5. Nested surfaces too close in tone (missing, open)

- **What happened.** In the left card, the frame (project, canvas picker, rail) and the panel
  inside it were nearly the same tone. The person asked for "more depth between the surfaces".
- **The fix used.**
  - The frame is a step darker (`rail`).
  - The panel is raised inside it on `sidebar`, flush with the card's edges.
  - The panel has a hairline and a 10px corner only where it meets the frame.
  - The current rail item is raised the same way.
- **The skill now.** `elevation.md` has four levels for page, sunken, raised and overlay. It says
  nothing about a surface nested inside a floating one.
- **Proposed.** A surface nested in another differs from it by at least one tone step (in dark,
  about 0.045 oklch lightness). It is flush with its container's edges, and draws its edge only
  where it meets its container.
- **Test.** Two-level sidebars, in dark and light. Have a person pick between tone steps.

### G6. An inset panel drawing a double edge (missed, open)

- **What happened.** The first raised panel was inset 1px, with its own full border, inside the
  card. That made two hairlines with a 1px gutter between them.
- **The skill now.** `spacing.md`: "One edge is drawn once: never a line and a surface for the
  same group."
- **Why it was missed.** The screens were only looked at whole, at full size, where a 1px gutter
  can't be seen.
- **Proposed.** See P4.
- **Test.** The same screens reviewed whole versus as 2× crops. Count the double edges found.

### G7. A filled field vanishing on a tinted frame (missing, open)

- **What happened.** The canvas picker sat on the rail-toned frame with the fields' usual fill
  (`muted`). The fill was so close to the frame that the picker didn't separate from the frame or
  from the panel below.
- **The fix used.** A translucent fill (`foreground/5`), a hairline ring, and 8px beneath it.
- **The skill now.** `components.md` and `DESIGN.md` describe fields as "filled, borderless at
  rest". Nothing covers a field on a surface other than the one the fill was chosen for.
- **Proposed.** A field's fill contrasts with the surface it sits on. On any other surface, use a
  translucent fill and a hairline.
- **Test.** Fields placed on each surface of a system, checked for measured contrast against
  their ground.

### G8. Dividers off-centre in a bar (process, open)

- **What happened.** The toolbar's vertical dividers hung from the top of the bar. The
  Separator's `data-vertical:self-stretch` overrode `h-5 self-center`. The person caught it, not
  the review.
- **The skill now.** This is a code bug, so no rule applies. The review should have seen it.
- **Proposed.** Check the alignment of every toolbar from a 2× crop, or measure it: a divider's
  vertical centre is its bar's.
- **Test.** As in G6.

### G9. Chrome attached to a canvas object breaks at zoom (missing, open)

- **What happened.** The selected element's toolbar (its name and its actions), attached to the
  selection:
  - covered small elements when zoomed out;
  - drifted off-screen when zoomed in.
- **The fix used** (branch `redesign`, `a647e13`):
  - A name tag with one action stays attached, capped to the element's width, and shrinks below
    a threshold.
  - The element's other controls dock in a fixed bar above the tools, as do a page's and those of
    several elements.
- **The skill now.** No pattern under `patterns/` covers a canvas or chrome that follows an
  object.
- **Proposed.** A canvas-tools pattern for:
  - what stays attached to an object;
  - what docks;
  - how attached chrome behaves at both zoom extremes.
- **Test.** Editor-like pieces with a selection, drawn at three zoom levels.

### P1. The brief replaced the references (process, open)

- **What happened.** The lead compressed the skill into a one-page brief for the six agents, which
  turned judgment into recipes:
  - "Empty states: a muted icon, a one-line title, one muted sentence, one action".
  - "Rows 28px, panel padding 8px".

  Where the brief and the references differed, the agents followed the brief. G1 came straight
  from it.
- **Proposed.** The skill says how to hand design work to other agents: the brief points to the
  references and `DESIGN.md`, and never restates a rule as a recipe without its condition.
- **Test.** The same task briefed both ways, with the gaps counted.

### P2. Each agent judged its own work (process, open)

- **What happened.** Each agent screenshotted its own area and judged it. The checks that are a
  matter of looking (G2, G3, the squint test) passed in self-review and failed with the person.
- **Proposed.** An independent reviewer for each section, as the lab's judge already is (87%
  agreement with the person).
- **Test.** Self-review versus an independent reviewer, both against the person's verdict.

### P3. The final tables check defects, not weight (process, open)

- **What happened.** Each "Before you finish" table lists local defects. None asks whether the
  whole section's ranking is right. `hierarchy.md` has the squint test, but the closing check in
  `SKILL.md` step 6 doesn't require it for each section.
- **Proposed.** End step 6 with a squint for each section: name its three heaviest things. They
  must be what the section is for.
- **Test.** Count the hierarchy findings caught with and without it.

### P4. Whole screens reviewed instead of sections (process, open)

- **What happened.** The lead reviewed whole screens at 1600×1000 and called them good. The
  person found G1–G3 and G5–G8 by looking at one section at a time. This matches the lab's
  earlier finding that sections compared one at a time catch problems that whole screens hide.
- **Proposed.** Review with crops of each section, at 2×.
- **Test.** See G6.

### P5. Compliance claimed without the check (process, open)

- **What happened.** The lead reported that every reference's table held, without running them
  row by row against each section.
- **Proposed.** The check's output lists each row of each table it ran, as pass or fail, with the
  evidence (a measured value or a crop). A claim can't then be made without the run.
- **Test.** Audit the reports for claims that have no matching row.

## The new chat's starters, 2026-11-03

**Setup.** The Agents panel's empty thread, on branch `redesign`. The prompts predate the
redesign. The redesign pass restyled them: it removed the accordion, the icon tiles and the
descriptions, which put all ten choices on screen at once, and it lengthened the intro. Neither
it nor the lead's review questioned the words or the choices. The person asked for a judgement;
the lead scored it 5/10. Of the findings below, G11, G12, G14, G16 and G17 come from rules the
skill has. G10, G13 and G15 come from the lead's own judgement.

### G10. Actions offered where they can't act (missing, open)

- **What happened.** Without anything attached, the chat offered:
  - "Make three variants of the attached element";
  - "Implement the attached element as a component";
  - three Tidy prompts that need a selection.

  About half the list was a dead end in the state the panel opens in. The header's eye ("Follow
  on the canvas") is offered before the agent has done anything to follow.
- **The skill now.**
  - `states.md` derives the states to draw from the content (lists, network, input, deletion),
    but has no row for "acts on a selection".
  - `usability.md` ("Options in view"): "Recent and suggested items lead a search or a picker." It
    doesn't say a suggestion has to fit the moment.
  - G4 is the same blind spot for a hint; this one is for actions.
- **Proposed.**
  - In `states.md`'s table: "Acts on a selection or a context: draw it with nothing selected,
    with one, with several."
  - In `usability.md`: "Suggestions follow the context: what can't act now is left out, not
    offered to fail."
- **Test.** Panels with actions that depend on a selection: count the actions shown that can't
  act in the state drawn.

### G11. Ten equal choices in an empty state (missed, with a missing limit, open)

- **What happened.** Nine prompts and an import, all set the same, in three labelled groups and a
  fourth group of one. On a squint, nothing leads. This screen opens with every new chat, so a
  daily user scrolls past it every time.
- **The skill now.**
  - `states.md`: an empty state comes "with one action that fills it".
  - `hierarchy.md`: the squint test, and one primary action per screen.
  - Both were missed. Neither says how many suggestions a list can hold, and chat panels
    conventionally show several starters, which reads as an exception to "one action".
- **Proposed.**
  - In `states.md`: "Suggestions in an empty state: three or four, chosen for the moment. More
    belong in search or a command."
  - In `hierarchy.md`: "Rows of equal weight are a menu, not a hierarchy. When one choice is the
    likely one, it leads."
- **Test.** Empty chat, search and dashboard states: count the choices shown, and run the squint
  check.

### G12. Instructions as the empty state's header (missed, open)

- **What happened.** "What's next?" (in a chat where nothing has happened yet) over two
  sentences on how to use the panel ("Select something on the canvas, then pick a start or write
  your own"), the longest text on the screen. The redesign made it longer.
- **The skill now.** `restraint.md`:
  - "A sentence explaining how to use a control: Remove it."
  - "An intro, eyebrow or subtitle on a screen whose purpose is plain: Remove it."
- **Proposed.** No new rule. Run restraint's table on copy kept from before, not only on new copy
  (see P6).
- **Test.** Restyle tasks on screens with legacy copy: count instructional sentences left in.

### G13. Items of one list in different forms (missing, open)

- **What happened.** Among sentences, one row was command syntax: `/implement /ask-card`. The
  second slash is the page's URL, so the row read like a bug. The group labels didn't share a
  form either: "Tidy and polish", "Generate designs", "Implement in code", "From Figma".
- **The skill now.**
  - `usability.md` ("One thing, one name, one place") covers one action across screens, not the
    items within one list.
  - `content.md` has no rule about parallel form.
- **Proposed.** In `content.md`: "Items of one list share one form: all sentences, all verbs, or
  all nouns. A code value (a route, a command) follows the words, muted and in the code face; it
  isn't the item."
- **Test.** Lists that mix code values into prose: whether the code is kept apart from the item.

### G14. An action of another kind in a list, in a group of one (missed and missing, open)

- **What happened.** Rows that write a prompt into the composer sat beside "Import a .fig file…",
  which opens a file picker. It had a group of its own whose label, "From Figma", repeats the row.
- **The skill now.** `restraint.md`: "A heading over a group its content already names: Remove
  it." This was missed. Nothing says a list holds one kind of item.
- **Proposed.** In `restraint.md` or `components.md`: "A list holds one kind of item, doing one
  kind of thing. An item that does something else goes where that kind of thing lives (an import
  goes in the attach menu)."
- **Test.** Lists of suggestions with a stray action: whether it is moved, or kept in a group of
  its own.

### G15. Suggestions placed away from where they act (missing, open)

- **What happened.** The starters fill the composer at the bottom of the panel, but they sit at
  its top with half a screen of space between. The click and its effect are far apart.
- **The skill now.**
  - `spacing.md` ("Proximity shows the grouping") covers the gaps between groups.
  - `usability.md` puts what a decision needs beside it.
  - Neither says a control sits next to what it changes.
- **Proposed.** In `layout.md`: "A control sits next to what it changes: suggestions that fill a
  field sit against the field (chat starters just above the composer), and filters sit above the
  list they filter."
- **Test.** Chat and search empty states: the distance from the suggestions to the field they
  fill.

### G16. One fact shown twice on one screen (missed, open)

- **What happened.** The model, "Opus 5.5", appeared in the thread's header and again in the
  composer's model select.
- **The skill now.** `restraint.md`: "A heading, caption or description that repeats what is
  beside it". The word "beside" limits the rule to neighbours, and these two are a panel apart.
- **Proposed.** In `restraint.md`: "…that repeats what the screen already shows, beside it or
  not. The control that sets a value is where it is read."
- **Test.** Screens with a value set in one place and shown in another: whether the duplicate is
  removed.

### G17. An icon alone for an action nobody would guess (missed, open)

- **What happened.** The eye in the thread's header means "Follow on the canvas". An eye reads
  as show or hide.
- **The skill now.** `iconography.md` ("A label by default"): "An icon stands alone only for
  actions everyone recognises", followed by a list that has no eye for follow.
- **Proposed.** No new rule. Iconography's table should catch it: "An icon-only button for an
  action outside the list: give it a label". Today the table checks only for a missing tooltip.
- **Test.** Toolbars with domain actions: icon-only buttons outside the list.

### P6. Copy kept because it was there (process, open)

- **What happened.** The brief asked to redesign "each text". The pass reworked the look and kept
  every prompt, the intro and the group names, apart from typographic fixes. It never asked
  whether each prompt could act in the state the panel opens in (G10). The review looked at the
  pixels, not the words.
- **Proposed.** For each surface, a content pass that reads every text and action against every
  state the surface is in: "is this true and actionable now?" Restraint's and content's tables
  apply to inherited copy as much as to new copy.
- **Test.** Restyle tasks on legacy screens: the share of the legacy copy's problems fixed.

### P7. One rule's fix broke another, unchecked (process, open)

- **What happened.** Restraint's cut (no icon tiles, no descriptions, no accordion) was right on
  its own, but it put all ten choices on screen at once, and the hierarchy got worse (G11).
  Each table was run once, so nothing checked the screen after the fix.
- **Proposed.** After applying a table's fixes, run the squint test (`hierarchy.md`) again on the
  section. A fix that removes structure re-weighs what remains.
- **Test.** Restyle tasks: hierarchy findings before and after a second squint pass.

P2 (each agent judged its own work) and P4 (whole screens instead of sections) applied here
again.
