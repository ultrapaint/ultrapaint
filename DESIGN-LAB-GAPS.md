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
- **The fix proposed** (not built):
  - A name tag with one action stays attached, capped to the element's width, and shrinks below
    a threshold.
  - The element's other controls dock in a fixed bar above the tools.
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
