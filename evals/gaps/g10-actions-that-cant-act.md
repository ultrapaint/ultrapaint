---
id: g10
title: Actions offered where they can't act
kind: missing
status: testing
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [references/states.md, references/usability.md]
sections: [chat-starters]
---

**Setup.** The Agents panel's empty thread. The prompts predate the redesign; the redesign pass restyled them (no accordion, icon tiles or descriptions, so all ten choices on screen at once) and lengthened the intro. Neither it nor the lead's review questioned the words or the choices. The person asked for a judgement; the lead scored it 5/10. This finding came from the lead's judgement.

**What happened.** Without anything attached, the chat offered:
- "Make three variants of the attached element";
- "Implement the attached element as a component";
- three Tidy prompts that need a selection.

About half the list was a dead end in the state the panel opens in. The header's eye ("Follow
on the canvas") is offered before the agent has done anything to follow.

**The skill now.**
- `states.md` derives the states to draw from the content (lists, network, input, deletion),
  but has no row for "acts on a selection".
- `usability.md` ("Options in view"): "Recent and suggested items lead a search or a picker." It
  doesn't say a suggestion has to fit the moment.
- G4 is the same blind spot for a hint; this one is for actions.

**Proposed.**
- In `states.md`'s table: "Acts on a selection or a context: draw it with nothing selected,
  with one, with several."
- In `usability.md`: "Suggestions follow the context: what can't act now is left out, not
  offered to fail."

**Test.** Panels with actions that depend on a selection: count the actions shown that can't
act in the state drawn.

**Result.**

- `recall-redesign-1`: 2026-11-03, caught: shipped 2/2, redesign-gaps 2/2 (claude-opus-5-5, effort high; runs/recall-redesign-1/report.md)
- Reading of `recall-redesign-1` (runs/recall-redesign-1/summary.md): the shipped skill caught it 2/2 with an independent reviewer per section: missed through how the redesign was run (P2, P6), not for want of a rule.
