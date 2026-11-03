---
id: g13
title: Items of one list in different forms
kind: missing
status: open
found: 2026-11-03
source: the new chat's starters, editor redesign (branch redesign)
skill: [references/usability.md, references/content.md]
sections: [chat-starters]
---

**Setup.** The Agents panel's empty thread. The prompts predate the redesign; the redesign pass restyled them (no accordion, icon tiles or descriptions, so all ten choices on screen at once) and lengthened the intro. Neither it nor the lead's review questioned the words or the choices. The person asked for a judgement; the lead scored it 5/10. This finding came from the lead's judgement.

**What happened.** Among sentences, one row was command syntax: `/implement /ask-card`. The
second slash is the page's URL, so the row read like a bug. The group labels didn't share a
form either: "Tidy and polish", "Generate designs", "Implement in code", "From Figma".

**The skill now.**
- `usability.md` ("One thing, one name, one place") covers one action across screens, not the
  items within one list.
- `content.md` has no rule about parallel form.

**Proposed.** In `content.md`: "Items of one list share one form: all sentences, all verbs, or
all nouns. A code value (a route, a command) follows the words, muted and in the code face; it
isn't the item."

**Test.** Lists that mix code values into prose: whether the code is kept apart from the item.

**Result.**
